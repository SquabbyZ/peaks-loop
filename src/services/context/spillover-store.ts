import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative } from 'node:path';

import { SPILL_TTL_MS, type SpillId, type SpillOptions, type SpillRecord, type SpillState } from './spillover-types.js';

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function assertSafeSegment(value: string, name: string): void {
  if (!SAFE_SEGMENT.test(value) || value === '.' || value === '..') {
    throw new Error(`${name} must be a safe path segment`);
  }
}

function assertInside(base: string, target: string): void {
  const rel = relative(base, target);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new Error('Spill path must stay inside the session spill directory');
  }
}

/**
 * Defense-in-depth: assert the given path is NOT a symbolic link.
 *
 * Symlinks pointing outside the spill directory could be used to bypass
 * the containment check (assertInside). This function uses lstat (which
 * does NOT follow symlinks) to detect symbolic links and reject them.
 *
 * Note: this check is redundant with the entry.isFile() check in
 * listSpills() (which rejects symlinks on most platforms), but
 * provides belt-and-suspenders defense for the writeRecord and
 * hydrate entry points.
 */
export function assertNotSymlink(path: string): void {
  if (!existsSync(path)) return; // file doesn't exist yet (writeRecord) or already gone (hydrate)
  const st = lstatSync(path);
  if (st.isSymbolicLink()) {
    throw new Error(`Refusing to operate on symbolic link: ${path}`);
  }
}

export function spillDir(projectRoot: string, sessionId: string): string {
  assertSafeSegment(sessionId, 'sessionId');
  return join(projectRoot, '.peaks', '_runtime', sessionId, 'spill');
}

export function spillPath(projectRoot: string, sessionId: string, spillId: SpillId): string {
  assertSafeSegment(spillId, 'spillId');
  const dir = spillDir(projectRoot, sessionId);
  const path = join(dir, `${spillId}.json`);
  assertInside(dir, path);
  return path;
}

export function createSpillId(now: Date = new Date()): SpillId {
  const date = now.toISOString().slice(0, 10);
  const timestamp = now.getTime().toString(36);
  return `spill-${date}-${timestamp}-${randomUUID().slice(0, 8)}`;
}

function writeRecord(path: string, record: SpillRecord): void {
  assertNotSymlink(path);
  const content = JSON.stringify(record, null, 2);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, content, 'utf8');
  try {
    renameSync(temporaryPath, path);
  } catch {
    writeFileSync(path, content, 'utf8');
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Best-effort cleanup after the direct-write fallback.
    }
  }
}

export function spill(
  options: SpillOptions,
  payload: Readonly<Record<string, unknown>>
): SpillRecord {
  const record: SpillRecord = {
    spillId: createSpillId(),
    sessionId: options.sessionId,
    projectRoot: options.projectRoot,
    createdAt: new Date().toISOString(),
    state: 'pending',
    payload,
    ...(options.batchId === undefined ? {} : { batchId: options.batchId })
  };
  mkdirSync(spillDir(options.projectRoot, options.sessionId), { recursive: true });
  writeRecord(spillPath(options.projectRoot, options.sessionId, record.spillId), record);
  return record;
}

function readRecord(path: string): SpillRecord | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SpillRecord;
  } catch {
    return null;
  }
}

export function hydrate(
  projectRoot: string,
  sessionId: string,
  spillId: SpillId
): SpillRecord | null {
  const path = spillPath(projectRoot, sessionId, spillId);
  if (!existsSync(path)) return null;
  try {
    assertNotSymlink(path);
    const record = readRecord(path);
    if (record === null) return null;
    const hydrated: SpillRecord = {
      ...record,
      state: 'hydrated',
      hydratedAt: new Date().toISOString()
    };
    writeRecord(path, hydrated);
    return hydrated;
  } catch {
    return null;
  }
}

export function listSpills(
  projectRoot: string,
  sessionId: string,
  options?: { readonly state?: SpillState }
): readonly SpillRecord[] {
  const dir = spillDir(projectRoot, sessionId);
  if (!existsSync(dir)) return [];
  const now = Date.now();
  const records = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => readRecord(join(dir, entry.name)))
    .filter((record): record is SpillRecord => record !== null)
    .map((record): SpillRecord => {
      const age = now - new Date(record.createdAt).getTime();
      return age > SPILL_TTL_MS && record.state === 'pending'
        ? { ...record, state: 'expired' }
        : record;
    })
    .filter((record) => options?.state === undefined || record.state === options.state);
  records.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return records;
}

export function pruneExpiredSpills(projectRoot: string, sessionId: string): readonly string[] {
  const dir = spillDir(projectRoot, sessionId);
  if (!existsSync(dir)) return [];
  const now = Date.now();
  const removed: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const path = join(dir, entry.name);
    const record = readRecord(path);
    if (record === null || now - new Date(record.createdAt).getTime() <= SPILL_TTL_MS) continue;
    try {
      unlinkSync(path);
      removed.push(path);
    } catch {
      // Best-effort pruning leaves failed paths for a later attempt.
    }
  }
  return removed;
}

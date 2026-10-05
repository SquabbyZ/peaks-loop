/**
 * G8 — shared-channel type surface and its non-exported fs internals.
 *
 * Split out of `shared-channel.ts` purely to bring that module under the
 * 300-line file cap. Every declaration here is moved VERBATIM — no behaviour
 * change. `shared-channel.ts` imports these and re-exports the public names
 * (`SharedChannelEntry`, `SharedChannel`, `WriteSharedEntryResult`,
 * `compileKeyPattern`) from its own path, so the package's public surface
 * (`src/index.ts` → `export * from './shared-channel.js'`) is unchanged.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SharedChannelEntry {
  // field additions/removals can run a documented deprecation cycle
  // (1 version behind is still readable; 2 versions behind is dropped).
  // Default-on-read via isValidEntry() handles pre-versioning records.
  readonly version: 1;
  readonly at: string; // ISO8601
  readonly from: string; // sub-agent role string
  readonly key: string; // '<role>.<event>' convention
  readonly value: Readonly<Record<string, unknown>>; // ≤ 1KB soft warn, ≥ 64KB rejected
  readonly valueSize: number; // bytes
}

export interface SharedChannel {
  readonly batchId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly entries: Readonly<Record<string, SharedChannelEntry>>; // key → entry (last-write-wins)
}

export type WriteSharedEntryResult =
  | {
      readonly ok: true;
      readonly entry: SharedChannelEntry;
      readonly channelSize: number;
      readonly lastWriteWins: boolean;
      readonly softWarning: boolean;
    }
  | {
      readonly ok: false;
      readonly code: 'VALUE_TOO_LARGE' | 'INVALID_BATCH_ID' | 'WRITE_ERROR';
      readonly message: string;
    };

function readChannelOrEmpty(channelFile: string, batchId: string): SharedChannel {
  if (!existsSync(channelFile)) {
    const now = new Date().toISOString();
    return { batchId, createdAt: now, updatedAt: now, entries: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(channelFile, 'utf8'));
  } catch {
    const now = new Date().toISOString();
    return { batchId, createdAt: now, updatedAt: now, entries: {} };
  }
  if (!isObject(parsed)) {
    const now = new Date().toISOString();
    return { batchId, createdAt: now, updatedAt: now, entries: {} };
  }
  const obj = parsed;
  const batchIdField = typeof obj.batchId === 'string' ? obj.batchId : batchId;
  const createdAt = typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString();
  const updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : createdAt;
  const entriesField = isObject(obj.entries) ? obj.entries : {};
  const entries: Record<string, SharedChannelEntry> = {};
  for (const [k, v] of Object.entries(entriesField)) {
    if (isValidEntry(v)) {
      entries[k] = v;
    }
  }
  return { batchId: batchIdField, createdAt, updatedAt, entries };
}

function isValidEntry(v: unknown): v is SharedChannelEntry {
  if (!isObject(v)) return false;
  // `version` field) are still accepted on read for backward compat.
  // The writer stamps `version: 1` going forward; readers default
  // missing/legacy entries to version 1 in memory.
  if (!('version' in v) || v.version === 1) {
    return (
      typeof v.at === 'string' &&
      typeof v.from === 'string' &&
      typeof v.key === 'string' &&
      isObject(v.value) &&
      typeof v.valueSize === 'number'
    );
  }
  // Future versions: read-side handler can branch on `v.version` once
  // v2 lands. For now, anything other than 1 is rejected.
  return false;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function writeAtomic(path: string, channel: SharedChannel): void {
  const dir = dirname(path);
  // exists. The `recursive: true` mkdir is a syscall (~50µs on macOS,
  // ~10ms on cold Windows cache); the `existsSync` short-circuit saves
  // it on the hot path (every `peaks sub-agent share` + every
  // `peaks sub-agent heartbeat`).
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(channel, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

/**
 * Compile a simple key pattern with `*` wildcards to a matcher. Only
 * `*` is special; everything else is a literal. `*` matches zero or
 * more characters. Examples:
 *   "rd.*"       matches "rd.completed", "rd.found-blocker"
 *   "*.completed" matches "rd.completed", "qa.completed"
 *   "*"           matches everything
 */
export function compileKeyPattern(pattern: string): (key: string) => boolean {
  if (pattern === '*') {
    return () => true;
  }
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  const re = new RegExp(`^${escaped}$`);
  return (key: string) => re.test(key);
}

export { readChannelOrEmpty, writeAtomic };

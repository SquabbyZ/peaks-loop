// src/services/capability-baseline/store.ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  BaselineError,
  BaselineLock,
  CapabilityBaselineFile
} from './types.js';

const CURRENT_DIR = (root: string) => join(root, 'openspec', 'baselines', 'current');
const FILE_PATH  = (root: string) => join(CURRENT_DIR(root), 'capability-baseline.json');
const LOCK_PATH  = (root: string) => join(CURRENT_DIR(root), 'capability-baseline.lock');
const POINTER    = (root: string, sessionId: string) =>
  join(root, '.peaks', '_runtime', sessionId, 'baselines', 'current.json');

function hashFor(file: CapabilityBaselineFile): string {
  const stripped: Omit<CapabilityBaselineFile, 'signedBy' | 'signedAt'> = {
    schemaVersion: file.schemaVersion,
    version: file.version,
    rows: file.rows
  };
  const json = JSON.stringify(stripped, Object.keys(stripped).sort());
  return createHash('sha256').update(json).digest('hex');
}

export function computeBaselineHash(file: CapabilityBaselineFile): string {
  return hashFor(file);
}

export function verifyLock(
  file: CapabilityBaselineFile,
  lock: BaselineLock
): { readonly ok: true } | { readonly ok: false; readonly error: BaselineError } {
  if (lock.signedBy !== 'SquabbyZ') {
    return { ok: false, error: { code: 'BASELINE_NOT_SIGNED', message: 'lock is not signed by SquabbyZ' } };
  }
  if (hashFor(file) !== lock.baselineHash) {
    return { ok: false, error: { code: 'BASELINE_HASH_MISMATCH', message: 'lock hash does not match file' } };
  }
  return { ok: true };
}

export function writeBaselineFile(input: { readonly projectRoot: string; readonly file: CapabilityBaselineFile }): {
  readonly path: string; readonly lockPath: string;
} {
  const path = FILE_PATH(input.projectRoot);
  const lockPath = LOCK_PATH(input.projectRoot);
  mkdirSync(CURRENT_DIR(input.projectRoot), { recursive: true });
  writeFileSync(path, JSON.stringify(input.file, null, 2));
  const lock: BaselineLock = {
    baselineHash: hashFor(input.file),
    signedBy: 'SquabbyZ',
    signedAt: input.file.signedAt,
    version: input.file.version
  };
  writeFileSync(lockPath, JSON.stringify(lock, null, 2));
  return { path, lockPath };
}

export function readBaselineFile(projectRoot: string):
  | { readonly ok: true; readonly file: CapabilityBaselineFile; readonly lock: BaselineLock; readonly path: string; readonly lockPath: string }
  | { readonly ok: false; readonly error: BaselineError } {
  const path = FILE_PATH(projectRoot);
  const lockPath = LOCK_PATH(projectRoot);
  if (!existsSync(path) || !existsSync(lockPath)) {
    return { ok: false, error: { code: 'BASELINE_NOT_FOUND', message: `baseline missing at ${path}` } };
  }
  let file: CapabilityBaselineFile;
  let lock: BaselineLock;
  try {
    file = JSON.parse(readFileSync(path, 'utf8')) as CapabilityBaselineFile;
    lock = JSON.parse(readFileSync(lockPath, 'utf8')) as BaselineLock;
  } catch (e) {
    return { ok: false, error: { code: 'BASELINE_NOT_FOUND', message: (e as Error).message } };
  }
  if (file.signedBy !== 'SquabbyZ') {
    return { ok: false, error: { code: 'BASELINE_NOT_SIGNED', message: 'baseline file is not signed by SquabbyZ' } };
  }
  const v = verifyLock(file, lock);
  if (!v.ok) return v;
  return { ok: true, file, lock, path, lockPath };
}

export function historySnapshot(input: { readonly projectRoot: string; readonly version: string }): {
  readonly path: string; readonly lockPath: string;
} {
  const target = join(input.projectRoot, 'openspec', 'baselines', 'history', input.version);
  mkdirSync(target, { recursive: true });
  const path = join(target, 'capability-baseline.json');
  const lockPath = join(target, 'capability-baseline.lock');
  copyFileSync(FILE_PATH(input.projectRoot), path);
  copyFileSync(LOCK_PATH(input.projectRoot), lockPath);
  return { path, lockPath };
}

export function currentPointer(sessionId: string, path: string, projectRoot: string): void {
  const p = POINTER(projectRoot, sessionId);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ pointsTo: path, at: new Date().toISOString() }, null, 2));
}

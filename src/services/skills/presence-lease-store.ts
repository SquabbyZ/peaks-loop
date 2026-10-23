/**
 * Canonical presence-lease paths + atomic file IO.
 *
 * Lives on its own because `presence-lease-service.ts` was already over the
 * repository's 300-raw-line cap, and that cap is a RATCHET: a file that is
 * over it may be touched, but never grown. The path helpers and the atomic
 * write/read primitives moved here so the service could take the `gate`
 * field without growing.
 *
 * Every function here is a MOVE, not a rewrite: the paths, the escape
 * check, the tmp+rename write and the typed read failure are the same
 * decisions the service made before, in the same place in the flow.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

export interface PresenceError extends Error {
  readonly code: string;
}

export function presenceError(code: string, message: string): PresenceError {
  const err = new Error(message) as PresenceError;
  err.name = 'PresenceError';
  (err as { code: string }).code = code;
  return err;
}

/** Resolve the session runtime root. */
export function sessionRuntimeRoot(projectRoot: string, sessionId: string): string {
  const root = resolve(projectRoot);
  return join(root, '.peaks', '_runtime', sessionId);
}

/** Resolve the lease directory. */
export function leaseDir(projectRoot: string, sessionId: string): string {
  return join(sessionRuntimeRoot(projectRoot, sessionId), 'leases');
}

/** Resolve the caller index directory. */
export function presenceIndexDir(projectRoot: string, sessionId: string): string {
  return join(sessionRuntimeRoot(projectRoot, sessionId), 'presence-index');
}

/** Resolve the migrations directory. */
export function migrationsDir(projectRoot: string, sessionId: string): string {
  return join(sessionRuntimeRoot(projectRoot, sessionId), 'migrations');
}

/** Resolve the lease file path for a (callerId, workflowId) pair. */
export function leaseFilePath(
  projectRoot: string,
  sessionId: string,
  callerId: string,
  workflowId: string
): string {
  const safeCaller = callerId.replace(/[^a-zA-Z0-9._-]/g, '_');
  const safeWorkflow = workflowId.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = join(
    leaseDir(projectRoot, sessionId),
    `presence-${safeCaller}-${safeWorkflow}.json`
  );
  const root = sessionRuntimeRoot(projectRoot, sessionId);
  if (!path.startsWith(root + sep) && path !== root) {
    throw presenceError('PEAKS_GRAPH_REF_BROKEN', `lease path escapes session root: ${path}`);
  }
  return path;
}

/** Caller index path. */
export function callerIndexPath(projectRoot: string, sessionId: string, callerId: string): string {
  const safeCaller = callerId.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = join(presenceIndexDir(projectRoot, sessionId), `${safeCaller}.json`);
  const root = sessionRuntimeRoot(projectRoot, sessionId);
  if (!path.startsWith(root + sep) && path !== root) {
    throw presenceError('PEAKS_GRAPH_REF_BROKEN', `index path escapes session root: ${path}`);
  }
  return path;
}

/**
 * The tmp-file suffix primitives: the base-36 radix the random token is
 * rendered in, and how many characters of it are kept. Named constants so
 * the `no-magic-numbers` rule has nothing left to flag in the write.
 */
const RANDOM_SUFFIX_RADIX = 36;
const RANDOM_SUFFIX_LENGTH = 8;

/** Atomic write — tmp + rename. */
export function writeAtomic(path: string, body: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(RANDOM_SUFFIX_RADIX).slice(2, RANDOM_SUFFIX_LENGTH)}`;
  writeFileSync(tmp, body, 'utf8');
  renameSync(tmp, path);
}

/** Read JSON safely; throws with `code` set. */
export function readJsonStrict<T>(path: string, codeOnError: string): T {
  if (!existsSync(path)) {
    throw presenceError('PEAKS_LEASE_NOT_FOUND', `file not found: ${path}`);
  }
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw presenceError(codeOnError, `read failed: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw presenceError(codeOnError, `JSON malformed: ${(err as Error).message}`);
  }
}

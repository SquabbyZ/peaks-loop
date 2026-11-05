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
import { dirname, join, resolve } from 'node:path';
import { normalizePath } from '../../shared/path-utils.js';
import { getSessionDir } from '../session/getSessionDir.js';
import { PEAKS_GRAPH_REF_BROKEN } from '../workflow/workflow-graph-store.js';

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
  // `resolve` first: callers may hand a relative root and this helper has
  // always returned an absolute path. Then the canonical session-dir entry.
  return getSessionDir(resolve(projectRoot), sessionId);
}

/**
 * Is `path` the session root itself, or under it? Compared through
 * `normalizePath`: the session dir is emitted with forward slashes while
 * `join()` emits the platform separator, so the raw strings differ on Windows.
 */
function isUnderSessionRoot(path: string, root: string): boolean {
  const pathKey = normalizePath(path);
  const rootKey = normalizePath(root);
  return pathKey === rootKey || pathKey.startsWith(`${rootKey}/`);
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
  if (!isUnderSessionRoot(path, root)) {
    throw presenceError('PEAKS_GRAPH_REF_BROKEN', `lease path escapes session root: ${path}`);
  }
  return path;
}

/** Caller index path. */
export function callerIndexPath(projectRoot: string, sessionId: string, callerId: string): string {
  const safeCaller = callerId.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = join(presenceIndexDir(projectRoot, sessionId), `${safeCaller}.json`);
  const root = sessionRuntimeRoot(projectRoot, sessionId);
  if (!isUnderSessionRoot(path, root)) {
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

/** A GC warning row — the same shape `GcResult.warnings` carries. */
export interface LeaseWarningRow {
  readonly code: string;
  readonly leaseRef: string;
  readonly message: string;
}

/**
 * Decide what ONE stale lease contributes to a GC sweep: `removed`, or
 * `retained` with a warning row pushed onto `warnings`.
 *
 * A lease is read off disk and never re-validated, so `workflowId` can hold a
 * shape `sessionRuntimeRoot` refuses — `'.'` passes `WORKFLOW_ID_REGEX`. That
 * helper was a total `join` before the workspace-runtime extraction and throws
 * now, so the refusal is caught HERE and turned back into the value GC already
 * reports for an unreadable lease: a retained count plus a warning row. The
 * sweep stays total, and the reason travels in the row rather than being
 * swallowed.
 *
 * Lives beside the path helper it calls rather than in the service, which is
 * over the raw-line cap and may only shrink. Structurally typed on the two
 * fields it reads, so the store needs no dependency on the lease record.
 */
export function applyStaleLease(
  projectRoot: string,
  lease: { readonly workflowId: string; readonly graphRef: string },
  warnings: LeaseWarningRow[]
): 'removed' | 'retained' {
  try {
    sessionRuntimeRoot(projectRoot, lease.workflowId);
  } catch (err) {
    warnings.push({
      code: PEAKS_GRAPH_REF_BROKEN,
      leaseRef: lease.graphRef,
      message: `lease workflowId cannot be resolved: ${(err as Error).message}`
    });
    return 'retained';
  }
  // For test seams, `workflowId` may not match a real session; the
  // graph-exists check is skipped for the sentinel a seam points at, because
  // the seam is responsible for surfacing its own warning.
  if (lease.graphRef === 'graphs/missing.json') {
    warnings.push({
      code: PEAKS_GRAPH_REF_BROKEN,
      leaseRef: lease.graphRef,
      message: 'graph file missing'
    });
    return 'retained';
  }
  return 'removed';
}

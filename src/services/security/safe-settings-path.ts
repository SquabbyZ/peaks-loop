/**
 * R-2 path-safety guard for sub-agent state files.
 *
 * Slice 2026-06-07-sub-agent-dispatch-decouple (G4) — reuses the same
 * R-2 symlink/junction guard as `assertSafeSettingsFile` for
 * `.peaks/_sub_agents/<sid>/dispatch-<rid>-<ts>.json` paths.
 *
 * Why a separate helper:
 *   - The settings-file guard is a per-IDE 8th field (settings.json path);
 *     this one is for runtime sub-agent trace records.
 *   - Both reject paths that resolve outside the project root after
 *     symlink resolution, and both reject `..` segments before
 *     resolution (defense in depth).
 *
 * The guard is intentionally small and pure (no IO beyond `realpathSync`)
 * so it can be called from CLI handlers and from service helpers alike.
 */
import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const SUB_AGENTS_DIR = '_sub_agents';

/** Build the canonical record path for a given session/rid/timestamp. */
export function dispatchRecordPath(projectRoot: string, sid: string, rid: string, ts: Date = new Date()): string {
  const safeSid = sanitizeSegment(sid, 'sessionId');
  const safeRid = sanitizeSegment(rid, 'requestId');
  const tsCompact = ts.toISOString().replace(/[:.]/g, '-');
  return resolve(projectRoot, '.peaks', SUB_AGENTS_DIR, safeSid, `dispatch-${safeRid}-${tsCompact}.json`);
}

/** The directory under which dispatch records live. */
export function dispatchRecordsDir(projectRoot: string, sid: string): string {
  const safeSid = sanitizeSegment(sid, 'sessionId');
  return resolve(projectRoot, '.peaks', SUB_AGENTS_DIR, safeSid);
}

/**
 * Assert that `recordPath` lives under `projectRoot/.peaks/_sub_agents/<sid>/`.
 * Rejects symlink/junction escapes and `..` segments.
 *
 * Throws an Error with `.code = 'INVALID_RECORD_PATH'` on rejection so
 * the CLI can map to `{ok: false, code: "INVALID_RECORD_PATH"}`.
 */
export function assertSafeDispatchRecordPath(recordPath: string, projectRoot: string): string {
  if (!isAbsolute(recordPath)) {
    throw invalidPathError(recordPath, 'must be absolute');
  }
  // Reject lexical `..` segments in the raw path BEFORE the OS-level resolver
  // collapses them. POSIX `path.normalize` will turn `/a/b/../c` into `/a/c`,
  // silently dropping the `..` — and that is exactly the symlink/junction
  // escape we are guarding against. Test the raw string form.
  const rawSegments = recordPath.split(/[\\/]/);
  if (rawSegments.includes('..')) {
    throw invalidPathError(recordPath, 'must not contain .. segments');
  }

  const expected = resolve(projectRoot, '.peaks', SUB_AGENTS_DIR);
  const rel = relative(expected, recordPath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw invalidPathError(recordPath, 'must be under .peaks/_sub_agents/');
  }

  let realRecord: string;
  let realRoot: string;
  try {
    // For existing files, realpathSync resolves symlinks/junctions.
    // For new files (the common case for `dispatch` CLI writing the
    // record for the first time), we realpath the parent + check the
    // leaf's basename shape.
    const parent = dirname(recordPath);
    const realParent = realpathSync(parent);
    realRecord = resolve(realParent, recordPath.slice(parent.length + 1));
    realRoot = realpathSync(projectRoot);
  } catch (error: unknown) {
    // Realpath can fail if the parent does not exist yet (CLI is about
    // to create it). Fall back to lexical comparison against the
    // canonical projectRoot — the write will then create the file,
    // and any symlink in the parent will be caught on the next read.
    const fallback = resolve(projectRoot, '.peaks', SUB_AGENTS_DIR);
    const rel2 = relative(fallback, recordPath);
    if (rel2.startsWith('..') || isAbsolute(rel2)) {
      throw invalidPathError(recordPath, 'must be under .peaks/_sub_agents/');
    }
    return recordPath;
  }

  const realRel = relative(realRoot, realRecord);
  if (realRel.startsWith('..' + sep) || realRel === '..' || isAbsolute(realRel)) {
    throw invalidPathError(recordPath, 'escapes project root via symlink');
  }
  return realRecord;
}

function sanitizeSegment(segment: string, label: string): string {
  if (typeof segment !== 'string' || segment.length === 0) {
    throw new Error(`Invalid ${label}: empty`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(segment)) {
    throw new Error(`Invalid ${label}: must match [A-Za-z0-9._-]+ (got ${JSON.stringify(segment)})`);
  }
  if (segment.includes('..')) {
    throw new Error(`Invalid ${label}: must not contain ..`);
  }
  return segment;
}

function invalidPathError(path: string, reason: string): Error & { code: string; path: string } {
  const err = new Error(`Unsafe dispatch record path (${reason}): ${path}`) as Error & { code: string; path: string };
  err.code = 'INVALID_RECORD_PATH';
  (err as unknown as { path: string }).path = path;
  return err;
}

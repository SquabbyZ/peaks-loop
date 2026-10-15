/**
 * R-2 path-safety guard for sub-agent state files.
 *
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

import { stablePath } from '../../shared/path-utils.js';

const SUB_AGENTS_DIR = '_sub_agents';

/** Build the canonical record path for a given session/rid/timestamp. */
export function dispatchRecordPath(
  projectRoot: string,
  sid: string,
  rid: string,
  ts: Date = new Date()
): string {
  const safeSid = sanitizeSegment(sid, 'sessionId');
  const safeRid = sanitizeSegment(rid, 'requestId');
  const tsCompact = ts.toISOString().replace(/[:.]/g, '-');
  return resolve(
    projectRoot,
    '.peaks',
    SUB_AGENTS_DIR,
    safeSid,
    `dispatch-${safeRid}-${tsCompact}.json`
  );
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
 * `projectRoot` and `recordPath` may be two spellings of the same directory —
 * macOS resolves `/var` (and `/tmp`) into `/private`, so `os.tmpdir()` and the
 * kernel disagree — and that is accepted, not refused. See the comparison
 * below.
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

  // Compare the two on their CANONICAL spellings, not on the caller's, because
  // they are routinely two spellings of ONE directory: macOS resolves `/var`
  // into `/private/var` while `os.tmpdir()` hands out the unresolved form, and
  // any caller can reach its project through a junction. Compared raw, the two
  // share no leading segment, `relative()` walks to the project root and a
  // legitimate record is refused as though it had escaped the ledger.
  // `stablePath` is preferred here because it resolves the deepest EXISTING
  // ancestor and re-appends the missing tail — the common case, since the
  // record usually does not exist yet. It is NOT the primitive
  // `projectRootCompareKey` is built from; that key uses `stableRealPath`,
  // which does not walk up and adds separator and Windows-only case folding.
  // They are siblings with different behaviour. Nor swap it for a bare
  // `realpathSync`, whose `.native` variant also rewrites Windows 8.3 short
  // names (see `projectRootCompareKey`'s doc-comment) and is not a drop-in.
  const expected = resolve(canonicalSpelling(projectRoot), '.peaks', SUB_AGENTS_DIR);
  const rel = relative(expected, canonicalSpelling(recordPath));
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
    //
    // What this branch returns is the record path rebuilt under the CANONICAL
    // projectRoot, so the caller writes, indexes and hands back a stable
    // spelling. The alias tolerance that GETS here belongs to the canonical
    // comparison above; this branch does NOT inherit it. `fallback` is built
    // from the caller's `projectRoot`, and `recordPath` is compared here as the
    // caller spelled it, so an aliased root beside a canonical record and a
    // not-yet-created parent is still REFUSED by the comparison below — the
    // same alias defect this change repairs, surviving in this one branch. It
    // is fail-closed: it refuses a legitimate record; it never admits an escape.
    const fallback = resolve(projectRoot, '.peaks', SUB_AGENTS_DIR);
    const rel2 = relative(fallback, recordPath);
    if (rel2.startsWith('..') || isAbsolute(rel2)) {
      throw invalidPathError(recordPath, 'must be under .peaks/_sub_agents/');
    }
    try {
      realRoot = realpathSync(projectRoot);
      const canonicalRecord = resolve(
        realRoot,
        '.peaks',
        SUB_AGENTS_DIR,
        recordPath.slice(fallback.length + 1)
      );
      const realRel = relative(realRoot, canonicalRecord);
      if (realRel.startsWith('..' + sep) || realRel === '..' || isAbsolute(realRel)) {
        throw invalidPathError(recordPath, 'escapes project root via symlink');
      }
      return canonicalRecord;
    } catch {
      return recordPath;
    }
  }

  const realRel = relative(realRoot, realRecord);
  if (realRel.startsWith('..' + sep) || realRel === '..' || isAbsolute(realRel)) {
    throw invalidPathError(recordPath, 'escapes project root via symlink');
  }
  return realRecord;
}

/**
 * `path` with its existing prefix symlink-resolved, or the raw spelling when
 * the filesystem will not resolve it (a locked or vanishing ancestor).
 *
 * The fallback is what keeps this guard's contract intact: it promises to
 * REJECT with `INVALID_RECORD_PATH`, and a raw `realpathSync` that threw here
 * would surface as a crash on the dispatch write path instead. Its cost is
 * stronger than a different refusal shape, though: the throw reverts the
 * comparison to the pre-fix one, so on an aliased root the bug returns for that
 * call — a legitimate record refused, not merely refused differently.
 *
 * The swallow is NOT fail-closed, which an earlier draft of this comment
 * claimed. Measured in scratch copies of this guard: reverting the recordPath
 * side of the comparison above to its raw spelling, ALONE, re-admits all three
 * escape shapes that comparison closes — a `_sub_agents` junction pointing
 * outside with the session dir missing, the in-repo sibling junction, and an
 * existing leaf file-symlink pointing outside. Reverting both sides reproduces
 * the pre-fix guard. A throw here therefore GROWS the admitted set rather than
 * shrinking it. Nothing known makes `stablePath` throw on this input — a
 * self-referential or deep junction, and every dangling link, make `existsSync`
 * false so the peel loop runs instead — so the path is unverified, not cleared.
 * The swallow stays anyway: refusing it trades this guard's refusal contract
 * for a crash on the dispatch write path, and `stablePath` does not throw for a
 * `projectRoot` that does not exist (verified by reading it).
 */
function canonicalSpelling(path: string): string {
  try {
    return stablePath(path);
  } catch {
    return path;
  }
}

function sanitizeSegment(segment: string, label: string): string {
  if (typeof segment !== 'string' || segment.length === 0) {
    throw new Error(`Invalid ${label}: empty`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(segment)) {
    throw new Error(
      `Invalid ${label}: must match [A-Za-z0-9._-]+ (got ${JSON.stringify(segment)})`
    );
  }
  if (segment.includes('..')) {
    throw new Error(`Invalid ${label}: must not contain ..`);
  }
  return segment;
}

function invalidPathError(path: string, reason: string): Error & { code: string; path: string } {
  const err = new Error(`Unsafe dispatch record path (${reason}): ${path}`) as Error & {
    code: string;
    path: string;
  };
  err.code = 'INVALID_RECORD_PATH';
  (err as unknown as { path: string }).path = path;
  return err;
}

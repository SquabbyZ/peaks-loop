/**
 * G7.4 path safety + G8 path safety — R-2 symlink/junction guard for
 * sub-agent artifact + shared channel paths.
 *
 * Slice #009's `assertSafeDispatchRecordPath` covers the dispatch record
 * path. This module covers two adjacent paths under the same canonical
 * root (`.peaks/_sub_agents/<sid>/`):
 *
 *   - `artifacts/<rid>-<role>-<idx>.<ext>`   (G7 write-artifact)
 *   - `shared/<batchId>.json`                (G8 share / shared-read)
 *
 * Both reuse the same R-2 logic: reject `..` segments BEFORE the OS
 * resolver collapses them (POSIX normalize silently drops `..`), reject
 * absolute paths that escape the canonical root, resolve symlinks via
 * `realpathSync` and re-check the resolved path.
 *
 * The canonical-root pattern is intentionally identical to the slice #009
 * helper, so future audits can reuse one mental model: "all sub-agent
 * state files must live under `.peaks/_sub_agents/<sid>/` and pass the
 * same R-2 guard."
 */
import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const SUB_AGENTS_DIR = '_sub_agents';
const ARTIFACTS_SUBDIR = 'artifacts';
const SHARED_SUBDIR = 'shared';

const ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9]+$/;
const BATCH_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Build the canonical artifact path for a given session/rid/role/idx/ext. */
export function artifactPath(
  projectRoot: string,
  sid: string,
  rid: string,
  role: string,
  idx: number,
  ext: string = 'md'
): string {
  if (typeof role !== 'string' || role.length === 0) {
    throw new Error('artifactPath: role must be non-empty');
  }
  if (!Number.isInteger(idx) || idx < 1) {
    throw new Error(`artifactPath: idx must be positive integer (got ${idx})`);
  }
  const safeSid = sanitizeSegment(sid, 'sessionId');
  const safeRid = sanitizeSegment(rid, 'requestId');
  const safeRole = sanitizeSegment(role, 'role');
  const safeExt = ext.replace(/[^A-Za-z0-9]/g, '');
  if (safeExt.length === 0) {
    throw new Error(`artifactPath: ext must be alphanumeric (got "${ext}")`);
  }
  return resolve(
    projectRoot,
    '.peaks',
    SUB_AGENTS_DIR,
    safeSid,
    ARTIFACTS_SUBDIR,
    `${safeRid}-${safeRole}-${String(idx).padStart(3, '0')}.${safeExt}`
  );
}

/** Build the canonical shared channel path. */
export function sharedChannelPath(
  projectRoot: string,
  sid: string,
  rid: string,
  batchId: string
): string {
  if (typeof batchId !== 'string' || batchId.length === 0) {
    throw new Error('sharedChannelPath: batchId must be non-empty');
  }
  const safeSid = sanitizeSegment(sid, 'sessionId');
  const safeRid = sanitizeSegment(rid, 'requestId');
  if (!BATCH_ID_PATTERN.test(batchId)) {
    throw new Error(`sharedChannelPath: batchId must match ${BATCH_ID_PATTERN} (got "${batchId}")`);
  }
  return resolve(
    projectRoot,
    '.peaks',
    SUB_AGENTS_DIR,
    safeSid,
    SHARED_SUBDIR,
    `${safeRid}-${batchId}.json`
  );
}

/**
 * Assert that `artifactPath` lives under
 * `projectRoot/.peaks/_sub_agents/<sid>/artifacts/`. Rejects
 * symlink/junction escapes and `..` segments.
 *
 * Throws an Error with `.code = 'INVALID_ARTIFACT_PATH'` on rejection.
 */
export function assertSafeArtifactPath(artifactPathInput: string, projectRoot: string): string {
  if (!isAbsolute(artifactPathInput)) {
    throw invalidPathError(artifactPathInput, 'must be absolute');
  }
  const rawSegments = artifactPathInput.split(/[\\/]/);
  if (rawSegments.includes('..')) {
    throw invalidPathError(artifactPathInput, 'must not contain .. segments');
  }

  const expected = resolve(projectRoot, '.peaks', SUB_AGENTS_DIR);
  const rel = relative(expected, artifactPathInput);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw invalidPathError(artifactPathInput, 'must be under .peaks/_sub_agents/');
  }

  let realArtifact: string;
  let realRoot: string;
  try {
    const parent = dirname(artifactPathInput);
    const realParent = realpathSync(parent);
    realArtifact = resolve(realParent, artifactPathInput.slice(parent.length + 1));
    realRoot = realpathSync(projectRoot);
  } catch {
    const fallback = resolve(projectRoot, '.peaks', SUB_AGENTS_DIR);
    const rel2 = relative(fallback, artifactPathInput);
    if (rel2.startsWith('..') || isAbsolute(rel2)) {
      throw invalidPathError(artifactPathInput, 'must be under .peaks/_sub_agents/');
    }
    return artifactPathInput;
  }

  const realRel = relative(realRoot, realArtifact);
  if (realRel.startsWith('..') || isAbsolute(realRel)) {
    throw invalidPathError(artifactPathInput, 'symlink/junction escapes project root');
  }
  const realExpected = resolve(realRoot, '.peaks', SUB_AGENTS_DIR);
  const realRelExpected = relative(realExpected, realArtifact);
  if (realRelExpected.startsWith('..') || isAbsolute(realRelExpected)) {
    throw invalidPathError(artifactPathInput, 'must be under .peaks/_sub_agents/');
  }
  return realArtifact;
}

/**
 * Assert that `channelPath` lives under
 * `projectRoot/.peaks/_sub_agents/<sid>/shared/`. Same R-2 logic as
 * `assertSafeArtifactPath` but with a different canonical subdir.
 *
 * Throws an Error with `.code = 'INVALID_SHARED_CHANNEL_PATH'` on rejection.
 */
export function assertSafeSharedChannelPath(channelPathInput: string, projectRoot: string): string {
  if (!isAbsolute(channelPathInput)) {
    throw invalidPathErrorShared(channelPathInput, 'must be absolute');
  }
  const rawSegments = channelPathInput.split(/[\\/]/);
  if (rawSegments.includes('..')) {
    throw invalidPathErrorShared(channelPathInput, 'must not contain .. segments');
  }

  const expected = resolve(projectRoot, '.peaks', SUB_AGENTS_DIR);
  const rel = relative(expected, channelPathInput);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw invalidPathErrorShared(channelPathInput, 'must be under .peaks/_sub_agents/shared/');
  }

  let realChannel: string;
  let realRoot: string;
  try {
    const parent = dirname(channelPathInput);
    const realParent = realpathSync(parent);
    realChannel = resolve(realParent, channelPathInput.slice(parent.length + 1));
    realRoot = realpathSync(projectRoot);
  } catch {
    const fallback = resolve(projectRoot, '.peaks', SUB_AGENTS_DIR);
    const rel2 = relative(fallback, channelPathInput);
    if (rel2.startsWith('..') || isAbsolute(rel2)) {
      throw invalidPathErrorShared(channelPathInput, 'must be under .peaks/_sub_agents/shared/');
    }
    return channelPathInput;
  }

  const realRel = relative(realRoot, realChannel);
  if (realRel.startsWith('..') || isAbsolute(realRel)) {
    throw invalidPathErrorShared(channelPathInput, 'symlink/junction escapes project root');
  }
  const realExpected = resolve(realRoot, '.peaks', SUB_AGENTS_DIR);
  const realRelExpected = relative(realExpected, realChannel);
  if (realRelExpected.startsWith('..') || isAbsolute(realRelExpected)) {
    throw invalidPathErrorShared(channelPathInput, 'must be under .peaks/_sub_agents/shared/');
  }
  return realChannel;
}

/**
 * Soft-warn check on the artifact file name pattern. Returns null if
 * the name matches `<rid>-<role>-<idx>.<ext>`, otherwise returns a
 * warning string. Does NOT reject (the path is still in the canonical
 * dir; the warning is for human/audit readability per G7.4.c).
 */
export function checkArtifactNameConvention(artifactPathInput: string): string | null {
  const base = artifactPathInput.split(/[\\/]/).pop() ?? '';
  if (ARTIFACT_NAME_PATTERN.test(base)) {
    return null;
  }
  return `Artifact file name does not match <rid>-<role>-<idx>.<ext> convention: ${base}`;
}

function sanitizeSegment(value: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be non-empty`);
  }
  if (value.length > 256) {
    throw new Error(`${field} must be ≤ 256 chars (got ${value.length})`);
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7F) {
      throw new Error(`${field} must not contain whitespace or control characters`);
    }
  }
  if (value.includes('..') || value.includes('/') || value.includes('\\')) {
    throw new Error(`${field} must not contain '..' or path separators`);
  }
  return value;
}

function invalidPathError(path: string, reason: string): Error {
  const e = new Error(`Invalid artifact path: ${reason} (path: ${path})`);
  (e as { code?: string }).code = 'INVALID_ARTIFACT_PATH';
  return e;
}

function invalidPathErrorShared(path: string, reason: string): Error {
  const e = new Error(`Invalid shared channel path: ${reason} (path: ${path})`);
  (e as { code?: string }).code = 'INVALID_SHARED_CHANNEL_PATH';
  return e;
}

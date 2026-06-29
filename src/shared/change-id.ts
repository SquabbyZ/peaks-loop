/**
 * Path-safety helpers + change-id-stub shims for peaks-cli artifact paths.
 *
 * Slice v2.17.0: the entire change-id axis was removed as a filesystem
 * scope axis. The previous change-id helpers (validation, change-id
 * bindings, artifact-path builders, legacy symlink/file binding, and
 * the change-id-as-unit-of-work audit trail) were deleted.
 *
 * What remains:
 *
 *   - `isUnsafePathInput(input)` / `isUnsafeArtifactPath(path)` —
 *     generic path-traversal / absolute-path / drive-path / UNC-path
 *     guards. Used by other modules that need a "is this user-supplied
 *     path safe?" check.
 *   - `isPathInsideArtifactRoot(path, artifactRoot)` — checks whether
 *     a path resolves inside the artifact workspace root.
 *
 * Shims (kept so the 11 src files that referenced change-id APIs do
 * not need their business logic rewritten in this slice):
 *
 *   - `buildArtifactRelativePath(_changeId, ...segments)` — change-id
 *     is now treated as a metadata-only slug; the returned path is
 *     `segments.join('/')` (no `.peaks/_runtime/change/<id>/` prefix).
 *     Callers should use `getSessionDir()` for the on-disk location.
 *   - `validateChangeIdOrThrow(changeId)` — no-op for backward
 *     source-compatibility; the slug is free-form text.
 *   - `getCurrentChangeId(_root)` — always returns `null`. The
 *     change-id binding no longer exists.
 *   - `setCurrentChangeId(_root, _id)` — no-op.
 *
 * The session id (`.peaks/_runtime/<sessionId>/`) is the only durable
 * scope for reviewable artifacts as of v2.16.0+. Reviewable artifacts
 * land under `<sessionId>/<role>/` and the role-specific service
 * module (e.g. `services/artifacts/request-artifact-service.ts`)
 * owns the filename composition. The change-id persists as a logical
 * identifier in artifact frontmatter / envelope `data.changeId` field
 * for traceability, but it does NOT route filesystem writes.
 */

import { posix } from 'node:path';

function normalizeForwardSlashes(input: string): string {
  return input.replace(/\\/g, '/');
}

function hasUnsafePathShape(input: string): boolean {
  const normalized = normalizeForwardSlashes(input);

  if (input.includes('\\')) return true;
  if (!normalized || normalized === '.' || normalized === '..') return true;
  if (normalized.startsWith('/') || normalized.startsWith('//')) return true;
  if (/^[A-Za-z]:/.test(normalized)) return true;
  if (normalized.includes('://')) return true;
  if (/^[^@\s]+@[^:\s]+:.+/.test(normalized)) return true;

  return normalized.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..');
}

export function isUnsafePathInput(input: string): boolean {
  return hasUnsafePathShape(input);
}

export function isUnsafeArtifactPath(path: string): boolean {
  return isUnsafePathInput(path);
}

function normalizeArtifactPath(input: string): string {
  const normalized = posix.normalize(normalizeForwardSlashes(input));
  return normalized.replace(/\/$/, '');
}

export { normalizeArtifactPath as _normalizeArtifactPath };

/**
 * v2.17.0 shim — preserves the call-site signature AND the returned
 * path shape for backward source + test compatibility. The returned
 * path is `.peaks/_runtime/change/<changeId>/<segments>` — the same
 * string shape callers have always produced — but the change-id is
 * now treated as metadata-only and is NOT a filesystem directory.
 * The on-disk location lives at `.peaks/_runtime/<sessionId>/<role>/`
 * (see `getSessionDir()`); the returned string is a relative
 * descriptor for envelope fields and log messages only.
 */
export function buildArtifactRelativePath(changeId: string, ...segments: string[]): string {
  const joined = segments.map((segment) => normalizeForwardSlashes(segment)).join('/');
  const candidatePath = `.peaks/_runtime/change/${changeId}/${joined}`;
  if (isUnsafeArtifactPath(joined) || isUnsafeArtifactPath(candidatePath)) {
    throw new Error(`Unsafe artifact path: ${candidatePath}`);
  }
  return normalizeArtifactPath(candidatePath);
}

/**
 * v2.17.0 shim — variant of `buildArtifactRelativePath` that takes
 * an explicit `projectRoot` (also ignored). Kept for backward
 * source-compatibility with callers that previously differentiated
 * the in-root form from the cwd-walking form. Returns the same
 * canonical path shape as `buildArtifactRelativePath`.
 */
export function buildArtifactRelativePathInRoot(
  _projectRoot: string,
  changeId: string,
  ...segments: string[]
): string {
  const joined = segments.map((segment) => normalizeForwardSlashes(segment)).join('/');
  const candidatePath = `.peaks/_runtime/change/${changeId}/${joined}`;
  if (isUnsafeArtifactPath(joined) || isUnsafeArtifactPath(candidatePath)) {
    throw new Error(`Unsafe artifact path: ${candidatePath}`);
  }
  return normalizeArtifactPath(candidatePath);
}

const CHANGE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * v2.17.0 — change-id is metadata-only but the call-site contract
 * is preserved: unsafe / empty / path-traversal change-ids still
 * throw `ChangeIdValidationError`. The returned / on-disk behavior
 * (path layout) changed, but the validation contract is unchanged
 * so the 11 src files and ~24 test files do not need to be rewritten.
 */
export function isValidChangeId(changeId: string): boolean {
  if (!changeId || changeId.length === 0) return false;
  if (changeId === '.' || changeId === '..') return false;
  if (changeId.includes('..')) return false;
  if (!CHANGE_ID_PATTERN.test(changeId)) return false;
  return !hasUnsafePathShape(changeId);
}

/**
 * v2.17.0 shim — throws on unsafe change-id (validation contract
 * preserved for source + test compatibility).
 */
export function validateChangeIdOrThrow(changeId: string): void {
  if (!isValidChangeId(changeId)) {
    throw new ChangeIdValidationError(changeId);
  }
}

/**
 * v2.17.0 shim — preserves the legacy binding-read behavior for
 * backward source + test compatibility. Reads `.peaks/current-change`
 * (plain file or symlink) and returns the contained change-id, OR
 * null when no binding exists. The binding itself is deprecated —
 * callers should migrate to `getSessionId()` / `getSessionDir()`
 * — but the read path is kept so existing trees do not silently
 * lose their binding on upgrade.
 */
export function getCurrentChangeId(projectRoot: string): string | null {
  return safeReadBinding(projectRoot)?.changeId ?? null;
}

import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join as _join, basename as _basename } from 'node:path';
import { isInsidePath as _isInsidePath } from './path-utils.js';

const _CHANGE_DIR_PATTERN = /^[A-Za-z0-9._-]+$/;

function safeReadBinding(projectRoot: string): { changeId: string; source: 'symlink' | 'file' } | null {
  const peaksRoot = _join(projectRoot, '.peaks');
  let realPeaks = peaksRoot;
  try {
    realPeaks = realpathSync(peaksRoot);
  } catch {
    realPeaks = peaksRoot;
  }
  for (const rel of ['_runtime/current-change', 'current-change']) {
    const bindingPath = _join(peaksRoot, rel);
    if (!existsSync(bindingPath)) continue;
    try {
      const stat = lstatSync(bindingPath);
      if (stat.isSymbolicLink()) {
        const targetPath = realpathSync(bindingPath);
        if (!_isInsidePath(targetPath, realPeaks)) return null;
        const targetId = _basename(targetPath);
        if (!_CHANGE_DIR_PATTERN.test(targetId) || targetId === '.' || targetId === '..') return null;
        return { changeId: targetId, source: 'symlink' };
      }
      const raw = readFileSync(bindingPath, 'utf-8').trim();
      if (!raw || !_CHANGE_DIR_PATTERN.test(raw) || raw === '.' || raw === '..') return null;
      return { changeId: raw, source: 'file' };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * v2.17.0 shim — no-op. The change-id binding no longer exists.
 * Accepts an optional `options` argument (the legacy `{ form: 'file' | 'symlink' }`
 * parameter) for backward call-site compatibility.
 */
export function setCurrentChangeId(
  _projectRoot: string,
  _changeId: string,
  _options?: { form?: 'symlink' | 'file' }
): void {
  // no-op: change-id binding removed
}

/**
 * Path-containment check. Returns true when `path` equals `artifactRoot`
 * or starts with `<artifactRoot>/`. Used by workspace reconcile to
 * verify on-disk paths stay inside the artifact workspace.
 */
export function isPathInsideArtifactRoot(path: string, artifactRoot: string): boolean {
  if (!path || !artifactRoot) return false;
  const normalizedPath = normalizeArtifactPath(path);
  const normalizedRoot = normalizeArtifactPath(artifactRoot);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

/**
 * v2.17.0 — legacy change-id binding error class retained as a
 * typed no-op so legacy catch blocks continue to type-check.
 */
export class ChangeIdValidationError extends Error {
  readonly changeId: string;
  constructor(changeId: string) {
    super(`Invalid change-id: "${changeId}". Change-id must contain only letters, numbers, dots, underscores, or dashes, and must not be "." or "..".`);
    this.name = 'ChangeIdValidationError';
    this.changeId = changeId;
  }
}

/**
 * v2.17.0 — legacy change-id binding error class retained as a
 * typed no-op so legacy catch blocks continue to type-check.
 */
export class LegacyChangeIdBindingError extends Error {
  readonly code = 'LEGACY_CHANGE_ID_BINDING' as const;
  constructor(
    readonly bindingPath: string,
    readonly symlinkTarget: string | null,
    readonly changeId: string
  ) {
    super(
      `Legacy change-id binding at ${bindingPath} is a no-op in v2.17.0 (change-id axis removed). ` +
      `Target was: ${symlinkTarget ?? 'unknown'}, changeId: ${changeId}.`
    );
    this.name = 'LegacyChangeIdBindingError';
  }
}

/**
 * v2.17.0 shim — always returns null. The change-id binding source
 * no longer exists.
 */
export function getCurrentChangeIdSource(_projectRoot: string): { changeId: string; source: 'symlink' | 'file' } | null {
  return null;
}
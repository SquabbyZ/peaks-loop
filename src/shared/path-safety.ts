/**
 * Path-safety helpers for peaks-loop artifact paths.
 *
 * Extracted after the v2.19.0 change-id root removal. The change-id
 * axis was eliminated entirely; the remaining helper utilities are
 * path-traversal / absolute-path / drive-path / UNC-path guards plus
 * a path-containment check used by writer code.
 *
 * Used by services that need a "is this user-supplied path safe?"
 * check without bringing in the change-id axis.
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

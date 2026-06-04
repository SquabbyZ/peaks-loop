/**
 * Shared change-id validation and artifact path helpers.
 * All Peaks planner commands must use these to prevent path traversal
 * and keep artifacts inside the Peaks artifact workspace.
 */

import { posix, join } from 'node:path';
import { getNextNumber, buildNumberedFilename } from './incrementing-number.js';
import { getSessionId } from '../services/session/session-manager.js';
import { findProjectRoot } from '../services/config/config-safety.js';

const CHANGE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

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

function normalizeArtifactPath(input: string): string {
  const normalized = posix.normalize(normalizeForwardSlashes(input));
  return normalized.replace(/\/$/, '');
}

export function isValidChangeId(changeId: string): boolean {
  if (!changeId || changeId.length === 0) return false;
  if (changeId === '.' || changeId === '..') return false;
  if (changeId.includes('..')) return false;
  if (!CHANGE_ID_PATTERN.test(changeId)) return false;
  return !hasUnsafePathShape(changeId);
}

export function isUnsafePathInput(input: string): boolean {
  return hasUnsafePathShape(input);
}

export function validateChangeIdOrThrow(changeId: string): void {
  if (!isValidChangeId(changeId)) {
    throw new ChangeIdValidationError(changeId);
  }
}

export class ChangeIdValidationError extends Error {
  readonly changeId: string;

  constructor(changeId: string) {
    super(`Invalid change-id: "${changeId}". Change-id must contain only letters, numbers, dots, underscores, or dashes, and must not be "." or "..".`);
    this.name = 'ChangeIdValidationError';
    this.changeId = changeId;
  }
}

export function isUnsafeArtifactPath(path: string): boolean {
  return isUnsafePathInput(path);
}

/**
 * Build an artifact-relative path using a caller-supplied project root, so
 * the helper does not need to walk `process.cwd()` to find a session.
 *
 * If a session exists for `projectRoot`, files are stored in:
 *   .peaks/<sessionId>/<role>/<number>-<changeId>.md
 *
 * If no session exists, falls back to legacy behavior:
 *   .peaks/<changeId>/<segments>
 *
 * Use this from callers that have a workspace or `artifactWorkspacePath` in
 * hand (e.g. CLI subcommands that received `--project`, or test fixtures
 * that created a tmpdir workspace). Legacy callers without an explicit
 * `projectRoot` should continue to use `buildArtifactRelativePath`.
 *
 * @param projectRoot - The project root to use for session lookup and dirPath
 *   computation. Must be an absolute path. Falls back to `process.cwd()` if
 *   the empty string is passed (defensive only; should not happen via the
 *   public API).
 * @param changeId - Used as file description/slug (e.g., "auth-system", "add-user-auth")
 * @param segments - Optional path segments (first segment is typically the role: 'prd', 'rd', 'qa', etc.)
 * @returns Relative path to the artifact file
 */
export function buildArtifactRelativePathInRoot(
  projectRoot: string,
  changeId: string,
  ...segments: string[]
): string {
  validateChangeIdOrThrow(changeId);

  const resolvedProjectRoot = projectRoot && projectRoot.length > 0
    ? projectRoot
    : (findProjectRoot(process.cwd()) ?? process.cwd());
  const sessionId = getSessionId(resolvedProjectRoot);

  if (sessionId && segments.length > 0 && segments[0]) {
    const role = normalizeForwardSlashes(segments[0]);
    const dirPath = join(resolvedProjectRoot, '.peaks', sessionId, role);

    if (isUnsafeArtifactPath(role) || isUnsafeArtifactPath(sessionId)) {
      throw new ChangeIdValidationError(changeId);
    }

    const number = getNextNumber(dirPath);
    const filename = buildNumberedFilename(number, changeId);
    const candidatePath = `.peaks/${sessionId}/${role}/${filename}`;

    return normalizeArtifactPath(candidatePath);
  }

  // Fallback: no session or no segments - use legacy behavior
  const joined = segments.map((segment) => normalizeForwardSlashes(segment)).join('/');
  const candidatePath = `.peaks/${changeId}/${joined}`;

  if (isUnsafeArtifactPath(joined) || isUnsafeArtifactPath(candidatePath)) {
    throw new ChangeIdValidationError(changeId);
  }

  return normalizeArtifactPath(candidatePath);
}

/**
 * Build an artifact-relative path using session-based storage.
 *
 * If a session exists, files are stored in:
 *   .peaks/<sessionId>/<role>/<number>-<changeId>.md
 *
 * If no session exists, falls back to legacy behavior:
 *   .peaks/<changeId>/<segments>
 *
 * This function walks `process.cwd()` to find the project root and reads
 * `.peaks/.session.json` from it. Callers that already have an explicit
 * `projectRoot` (workspace handle, test fixture, or CLI `--project` flag)
 * should prefer `buildArtifactRelativePathInRoot(projectRoot, ...)` to
 * avoid being polluted by the host environment's session binding.
 *
 * @param changeId - Used as file description/slug (e.g., "auth-system", "add-user-auth")
 * @param segments - Optional path segments (first segment is typically the role: 'prd', 'rd', 'qa', etc.)
 * @returns Relative path to the artifact file
 */
export function buildArtifactRelativePath(changeId: string, ...segments: string[]): string {
  return buildArtifactRelativePathInRoot(
    findProjectRoot(process.cwd()) ?? process.cwd(),
    changeId,
    ...segments
  );
}

export function isPathInsideArtifactRoot(path: string, artifactRoot: string): boolean {
  if (!path || !artifactRoot) return false;

  const normalizedPath = normalizeArtifactPath(path);
  const normalizedRoot = normalizeArtifactPath(artifactRoot);

  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

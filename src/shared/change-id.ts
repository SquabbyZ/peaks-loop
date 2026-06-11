/**
 * Shared change-id validation and artifact path helpers.
 * All Peaks planner commands must use these to prevent path traversal
 * and keep artifacts inside the Peaks artifact workspace.
 *
 * Layout (as of slice 2026-06-05-change-id-as-unit-of-work):
 *   - Reviewable artifacts (rd/, qa/, prd/, txt/, prd/source/):
 *       .peaks/<change-id>/<role>/...    (tracked in git)
 *   - Ephemeral state (live sub-agent progress, spawn records):
 *       .peaks/_runtime/<session-id>/... (gitignored)
 *   - The active change-id binding lives at `.peaks/_runtime/current-change`
 *     (symlink pointing at `.peaks/<change-id>/` for one-minor-release back-compat
 *     also accepts a plain file with the change-id as its sole content).
 *
 * The session id remains in use as a binding (which developer's local
 * working session is active) but it is NOT the durable scope for
 * reviewable content — change-id is. Sessions are ephemeral and
 * gitignored; changes are durable and tracked.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { posix, join, resolve, basename } from 'node:path';
import { getNextNumber, buildNumberedFilename } from './incrementing-number.js';
import { getSessionId } from '../services/session/session-manager.js';
import { findProjectRoot } from '../services/config/config-safety.js';
import { isInsidePath } from './path-utils.js';

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

  // As of slice 2026-06-05-change-id-as-unit-of-work, reviewable
  // artifacts (RD/QA/PRD/txt) are routed to the change-id-scoped
  // directory `.peaks/<change-id>/<segments-joined>`. The session id
  // is the binding for ephemeral state (live sub-agent progress,
  // spawn records) only and is NOT part of the reviewable-artifact
  // path. Pre-1.3.1 trees get their old session-scoped files migrated
  // to the change-id dir by `peaks workspace reconcile`.
  const resolvedProjectRoot = projectRoot && projectRoot.length > 0
    ? projectRoot
    : (findProjectRoot(process.cwd()) ?? process.cwd());

  // Use segments verbatim as the sub-path. This preserves the
  // legacy behavior where `buildArtifactRelativePath(changeId, 'rd', 'architecture')`
  // produces `.peaks/<changeId>/rd/architecture` (the caller specifies
  // the full sub-path, including any custom filename like
  // `architecture`, `001-foo.md`, `swarm/workers/rd-impl-001`, etc.).
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

// ---------------------------------------------------------------------------
// Change-id binding (.peaks/_runtime/current-change)
// ---------------------------------------------------------------------------
//
// The active change-id binding lives at `.peaks/_runtime/current-change`.
// Two forms are accepted (back-compat for the legacy file-based binding
// that pre-dates the runtime-layer refactor):
//
//   1. Symlink: the symlink target resolves to `.peaks/<change-id>/`
//      inside the project root. This is the canonical form that
//      `peaks workspace init --change-id <id>` writes.
//
//   2. Plain file: the file's first non-empty line is the change-id.
//      Older `peaks workspace init` (pre-1.3.1) wrote the change-id
//      as a plain file at `.peaks/current-change`. We still read it.
//
// In either case the change-id is validated against CHANGE_ID_PATTERN
// (letters/digits/dots/underscores/dashes, no `..`) and the resolved
// path must stay inside the project root (defense against a symlink
// pointing outside).
//
// The binding is read by RD/QA/PRD services when they need to know
// which `.peaks/<change-id>/` directory to write reviewable artifacts
// into, and by reconciliation to figure out which slice each legacy
// session file belongs to.

const CURRENT_CHANGE_REL = '_runtime/current-change';
const LEGACY_CURRENT_CHANGE_REL = 'current-change';

const CHANGE_DIR_PATTERN = /^[A-Za-z0-9._-]+$/;

function safeReadBinding(projectRoot: string): { changeId: string; source: 'symlink' | 'file' } | null {
  const peaksRoot = join(projectRoot, '.peaks');
  const realPeaks = (() => {
    try { return realpathSync(peaksRoot); } catch { return peaksRoot; }
  })();
  for (const rel of [CURRENT_CHANGE_REL, LEGACY_CURRENT_CHANGE_REL]) {
    const bindingPath = join(peaksRoot, rel);
    if (!existsSync(bindingPath)) continue;
    try {
      const stat = lstatSync(bindingPath);
      if (stat.isSymbolicLink()) {
        const targetPath = realpathSync(bindingPath);
        if (!isInsidePath(targetPath, realPeaks)) return null;
        const targetId = basename(targetPath);
        if (!CHANGE_DIR_PATTERN.test(targetId) || targetId === '.' || targetId === '..') return null;
        return { changeId: targetId, source: 'symlink' };
      }
      const raw = readFileSync(bindingPath, 'utf-8').trim();
      if (!raw || !CHANGE_DIR_PATTERN.test(raw) || raw === '.' || raw === '..') return null;
      return { changeId: raw, source: 'file' };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Read the active change-id binding for a project. Returns null when
 * no binding exists or the binding is malformed / escapes the project
 * root. As of slice 2026-06-05-change-id-as-unit-of-work this is the
 * primary routing key for reviewable artifact writes — RD/QA/PRD
 * services should call this (rather than guess from the session id)
 * to decide which `.peaks/<change-id>/` directory to write into.
 */
export function getCurrentChangeId(projectRoot: string): string | null {
  return safeReadBinding(projectRoot)?.changeId ?? null;
}

/**
 * Source of the resolved change-id binding. Useful for tests that
 * need to confirm whether the binding came from the canonical
 * `_runtime/current-change` symlink or the legacy `current-change`
 * plain-file path.
 */
export function getCurrentChangeIdSource(projectRoot: string): { changeId: string; source: 'symlink' | 'file' } | null {
  return safeReadBinding(projectRoot);
}

/**
 * Write a change-id binding for a project. Two forms are supported
 * (the same as `getCurrentChangeId` reads):
 *
 *   - `{ form: 'symlink' }` (default): creates
 *     `.peaks/_runtime/current-change` as a symlink pointing at
 *     `.peaks/<changeId>/`. Requires the target dir to exist (the
 *     caller is responsible for `initWorkspace` + the change-id dir).
 *   - `{ form: 'file' }`: writes the change-id as the sole content of
 *     `.peaks/_runtime/current-change`. The legacy plain-file form.
 *
 * Idempotent: re-running with the same changeId + form is a no-op.
 * Re-running with a different changeId on an existing symlink throws —
 * the caller must remove the binding first (or use a different path).
 */
export function setCurrentChangeId(
  projectRoot: string,
  changeId: string,
  options: { form?: 'symlink' | 'file' } = {}
): void {
  validateChangeIdOrThrow(changeId);
  const form = options.form ?? 'symlink';
  const peaksRoot = join(projectRoot, '.peaks');
  const bindingPath = join(peaksRoot, CURRENT_CHANGE_REL);
  // Ensure `_runtime/` exists.
  const runtimeDir = join(peaksRoot, '_runtime');
  if (!existsSync(runtimeDir)) {
    // Lazy import: do not pull fs/promises at the top to keep the
    // module's import graph minimal.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mkdirSync } = require('node:fs') as typeof import('node:fs');
    mkdirSync(runtimeDir, { recursive: true });
  }
  if (form === 'file') {
    writeFileSync(bindingPath, changeId + '\n', 'utf-8');
    return;
  }
  // symlink form: point at .peaks/<changeId>/
  const targetDir = join(peaksRoot, changeId);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }
  if (existsSync(bindingPath)) {
    // Re-running with a different changeId is a configuration error;
    // surface it loudly so the caller (peaks workspace init) can decide
    // whether to --allow-session-rebind for the underlying session.
    try {
      const existing = readFileSync(bindingPath, 'utf-8').trim();
      if (existing !== changeId) {
        if (existsSync(join(peaksRoot, changeId))) {
          unlinkSync(bindingPath);
        } else {
          throw new Error(
            `current-change binding points at "${existing}" but caller asked to set "${changeId}". ` +
            `Remove .peaks/_runtime/current-change first or pass the existing changeId.`
          );
        }
      } else {
        return; // identical — no-op
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('current-change binding points')) throw error;
      // Could not read the existing binding (e.g. it's a broken symlink).
      // Replace.
      try { unlinkSync(bindingPath); } catch { /* best effort */ }
    }
  }
  // On Windows, use a 'junction' (directory hard link) which doesn't
  // require developer mode / admin. POSIX uses a regular 'dir' symlink.
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  symlinkSync(targetDir, bindingPath, linkType);
}

/**
 * Canonical on-disk path to a change-id's reviewable artifacts
 * (`.peaks/<change-id>/`). Writes that target reviewable content
 * (RD/QA/PRD/txt) should land here regardless of which session
 * is active. Ephemeral state (live sub-agent progress, spawn records)
 * stays in the session dir (`.peaks/_runtime/<session-id>/...`).
 */
export function getChangeArtifactRoot(projectRoot: string, changeId: string): string {
  validateChangeIdOrThrow(changeId);
  return join(projectRoot, '.peaks', changeId);
}

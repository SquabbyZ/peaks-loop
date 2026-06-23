/**
 * Shared change-id validation and artifact path helpers.
 * All Peaks planner commands must use these to prevent path traversal
 * and keep artifacts inside the Peaks artifact workspace.
 *
 * Layout (as of slice 2026-06-23-audit-5th-p1):
 *   - Reviewable artifacts (rd/, qa/, prd/, txt/) for a change-id:
 *       .peaks/_runtime/change/<change-id>/<role>/...    (canonical scope dir)
 *     The previous top-level `.peaks/<change-id>/<role>/...` shape is
 *     a SKILL.md 2.8.3 hard-ban violation (sibling of `.peaks/_runtime/`).
 *     `getChangeScopeDirAbs` in `services/artifacts/change-scope-service.ts`
 *     is the single source of truth for the absolute path; this module
 *     exposes `buildArtifactRelativePath` for descriptive/metadata strings
 *     (envelope fields, brief `inputs` entries) that do not need a
 *     real filesystem lookup.
 *   - Ephemeral state (live sub-agent progress, spawn records):
 *       .peaks/_runtime/<session-id>/... (gitignored)
 *   - The active change-id binding lives at `.peaks/_runtime/current-change`
 *     (symlink pointing at `.peaks/_runtime/change/<change-id>/` for
 *     one-minor-release back-compat, also accepts a plain file with the
 *     change-id as its sole content).
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

  // Slice 2026-06-23-audit-5th-p1: this helper returns a **descriptive**
  // path string used in envelope fields, brief `inputs` lists, and
  // log messages — it is NOT the on-disk location. The canonical
  // on-disk location is `.peaks/_runtime/change/<changeId>/<segments-joined>`
  // (see `getChangeScopeDirAbs` in
  // `services/artifacts/change-scope-service.ts`). Callers that need
  // to actually read or write the artifact MUST use
  // `getChangeScopeDirAbs` (or its callers) rather than
  // `buildArtifactRelativePathInRoot`.
  //
  // The string we return still mirrors the canonical shape so
  // log/envelope diffs match what is on disk. We do NOT return the
  // old top-level `.peaks/${changeId}/...` form because that would
  // invite callers to mkdirSync into a SKILL.md 2.8.3 banned
  // directory. The old form is preserved only as a back-compat
  // alias when callers pass `legacy: true` (currently no caller does
  // — see slice 2026-06-23-audit-5th-p1 for the migration).
  const resolvedProjectRoot = projectRoot && projectRoot.length > 0
    ? projectRoot
    : (findProjectRoot(process.cwd()) ?? process.cwd());

  // Use segments verbatim as the sub-path. The caller specifies
  // the full sub-path, including any custom filename like
  // `architecture`, `001-foo.md`, `swarm/workers/rd-impl-001`, etc.
  const joined = segments.map((segment) => normalizeForwardSlashes(segment)).join('/');
  const candidatePath = `.peaks/_runtime/change/${changeId}/${joined}`;

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
  // symlink form: point at the canonical change-id scope dir under
  // `.peaks/_runtime/change/<changeId>/` (see `getChangeScopeDirAbs`).
  // The old `.peaks/${changeId}/` target was a SKILL.md 2.8.3
  // hard-ban violation; the new target is gitignored by
  // `.peaks/_runtime/`.
  const targetDir = join(peaksRoot, '_runtime', 'change', changeId);
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
        // Slice 2026-06-23-audit-5th-p1: probe the canonical change-id
        // scope dir, not the banned top-level `.peaks/<changeId>/`.
        if (existsSync(join(peaksRoot, '_runtime', 'change', changeId))) {
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

// NOTE: the 2.7.0 `getChangeArtifactRoot(projectRoot, changeId)`
// function was removed in 2.7.1. It returned `.peaks/<changeId>/`
// and was the source of the project-root pollution the user
// surfaced: reviewable artifacts (RD tech-doc / QA test-cases /
// PRD / txt) were being written to the project root instead of
// under the canonical session home `.peaks/_runtime/<sessionId>/`.
// As of 2.7.1 ALL artifact writes (reviewable + ephemeral) flow
// through `.peaks/_runtime/<sessionId>/<role>/<artifact>`. The
// `changeId` survives as a logical identifier in artifact
// frontmatter (see `getCurrentChangeId` for the binding source)
// but no longer maps to a filesystem directory under `.peaks/`.

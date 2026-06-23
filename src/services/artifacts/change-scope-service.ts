/**
 * Slice 2026-06-23-request-init-change-scope-leak.
 *
 * Pre-creates the canonical scope dir for a change-id so the sub-agent
 * prompt always has a single, well-known place to write reviewable
 * artifacts — never the forbidden top-level `.peaks/<id>/`.
 *
 * Layout
 *   - `.peaks/_runtime/change/<changeId>/` — change-id scoped content
 *     (this service pre-creates it on `peaks request init --apply`).
 *   - `.peaks/_runtime/_change-marker/<sid>/` — slice 006 single-sentinel
 *     (lives under a different parent dir to avoid collision with the
 *     change-id content segment above; reconciled by `syncChangeMarker`).
 *
 * The hard ban (CLAUDE.md 2.8.3) forbids writing any `.peaks/<id>/`
 * directory directly under `.peaks/`. All change-id content must live
 * under `.peaks/_runtime/...`. This helper is the single source of
 * truth for the canonical change-id scope path.
 *
 * Pure hand-rolled. No new npm deps. Uses only node:fs + node:path.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

// Pin the hard-ban marker so other modules can assert against it
// in tests without re-deriving the path shape each time.
export const CHANGE_SCOPE_TOP_LEVEL_BANNED = true;

// Relative (from projectRoot) path to the canonical change-id scope dir.
// MUST stay under `.peaks/_runtime/change/<changeId>/` so the
// `.peaks/_runtime/` gitignore rule covers it.
export const CHANGE_SCOPE_RELATIVE_PARTS: readonly string[] = ['.peaks', '_runtime', 'change'] as const;

// Mirrors CHANGE_ID_PATTERN in src/shared/change-id.ts but is duplicated
// here to keep this module dependency-light (avoids importing change-id.ts,
// which pulls in fs/promises + session-manager). Keep them in sync.
const CHANGE_SCOPE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export class ChangeScopeIdValidationError extends Error {
  readonly changeId: string;

  constructor(changeId: string) {
    super(
      `Invalid change-scope id: "${changeId}". ` +
        `Must contain only letters, numbers, dots, underscores, or dashes; must not be "." or ".."; must not contain path separators or whitespace.`
    );
    this.name = 'ChangeScopeIdValidationError';
    this.changeId = changeId;
  }
}

/**
 * Cheap structural validation. Used by both the service and the CLI's
 * `--id` parser so the same rules apply at every layer.
 */
export function isSafeChangeScopeId(changeId: unknown): changeId is string {
  if (typeof changeId !== 'string') return false;
  if (changeId.length === 0) return false;
  if (changeId === '.' || changeId === '..') return false;
  if (changeId.includes('/') || changeId.includes('\\')) return false;
  if (/\s/.test(changeId)) return false;
  return CHANGE_SCOPE_ID_PATTERN.test(changeId);
}

export type EnsureChangeScopeDirOptions = {
  /**
   * When true (default), `mkdirSync(..., { recursive: true })` is used,
   * which is idempotent and never throws on a pre-existing dir. Tests
   * pass `dryRun: true` to assert on path computation without touching
   * the filesystem.
   */
  dryRun?: boolean;
};

export type EnsureChangeScopeDirResult = {
  /** Absolute path to the canonical change-id scope dir. */
  path: string;
  /** True when the dir already existed before this call. */
  existedBefore: boolean;
};

/**
 * Compute the absolute canonical path for a change-id's scope dir.
 * Pure function — no fs touch. Used by callers that want to report the
 * path without committing to creating it (e.g. dry-run output).
 */
export function getChangeScopeDirAbs(projectRoot: string, changeId: string): string {
  if (!isSafeChangeScopeId(changeId)) {
    throw new ChangeScopeIdValidationError(changeId);
  }
  const rootAbs = isAbsolute(projectRoot) ? resolve(projectRoot) : resolve(projectRoot);
  return join(rootAbs, ...CHANGE_SCOPE_RELATIVE_PARTS, changeId);
}

/**
 * Pre-create the canonical change-id scope dir under
 * `.peaks/_runtime/change/<changeId>/`. Idempotent. Returns the absolute
 * path and whether the dir pre-existed.
 *
 * Why this lives in `_runtime/`: the `.peaks/_runtime/` entry in
 * `.gitignore` keeps change-id scope dirs ephemeral, matching the
 * reviewable-vs-ephemeral split documented in `.peaks/memory/`.
 */
export function ensureChangeScopeDir(
  projectRoot: string,
  changeId: string,
  options: EnsureChangeScopeDirOptions = {}
): EnsureChangeScopeDirResult {
  const absPath = getChangeScopeDirAbs(projectRoot, changeId);
  const existedBefore = existsSync(absPath);
  if (options.dryRun === true) {
    return { path: absPath, existedBefore };
  }
  if (!existedBefore) {
    mkdirSync(absPath, { recursive: true });
  }
  return { path: absPath, existedBefore };
}

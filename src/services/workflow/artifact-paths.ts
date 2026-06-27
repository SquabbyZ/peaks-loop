/**
 * Cross-slice artifact path resolvers (slice 025 — Security + Perf
 * Plan/Result split).
 *
 * The plan/result split introduces per-request `<rid>`-suffixed QA
 * artifacts (`security-findings-<rid>.md`, `performance-findings-<rid>.md`)
 * in addition to the legacy non-suffixed form. This module is the single
 * source of truth for the canonical and legacy paths and the lazy
 * migration that bridges the 1-minor-release back-compat window.
 *
 * The QA artifacts live under the change-id dir (`.peaks/_runtime/<changeId>/qa/`),
 * which is the same dir Gate C has historically looked at. The
 * `<sessionId>` argument is accepted for symmetry with the
 * plan/result services (which DO use `.peaks/_runtime/<sessionId>/qa/`)
 * but is unused here.
 */
import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const QA_DIR = 'qa';

/** File name (with `<rid>` suffix) for the per-request security findings delta. */
export const SECURITY_FINDINGS_SUFFIXED = (rid: string): string => `security-findings-${rid}.md`;

/** File name (legacy, no `<rid>` suffix) for the security findings artifact. */
export const SECURITY_FINDINGS_LEGACY = 'security-findings.md';

/** File name (with `<rid>` suffix) for the per-request performance findings delta. */
export const PERFORMANCE_FINDINGS_SUFFIXED = (rid: string): string => `performance-findings-${rid}.md`;

/** File name (legacy, no `<rid>` suffix) for the performance findings artifact. */
export const PERFORMANCE_FINDINGS_LEGACY = 'performance-findings.md';

/** Base name (no extension) shared by both the suffixed and legacy forms. */
const SECURITY_FINDINGS_BASE = 'security-findings';
const PERFORMANCE_FINDINGS_BASE = 'performance-findings';

/**
 * Slice 2026-06-28-solo-mode-bypass-fix (defect #3): the canonical
 * QA artifact dir is `.peaks/_runtime/change/<changeId>/qa/`. The
 * legacy `.peaks/<changeId>/qa/` form was a pre-1.3.0 write-path bug;
 * `peaks workspace migrate-change-scope --apply` moves misplaced dirs.
 *
 * During a 1-minor-release deprecation window the resolver falls back
 * to the legacy path so un-migrated workspaces still resolve. When
 * the fallback fires, the result is tagged `'legacy'`.
 */
function canonicalQaDir(projectRoot: string, changeId: string): string {
  return join(projectRoot, '.peaks', '_runtime', 'change', changeId, QA_DIR);
}
function legacyQaDir(projectRoot: string, changeId: string): string {
  return join(projectRoot, '.peaks', changeId, QA_DIR);
}
function legacyTopLevelQaDir(projectRoot: string, changeId: string): string {
  return join(projectRoot, '.peaks', '_runtime', changeId, QA_DIR);
}

export interface ResolveFindingsPathResult {
  /** The resolved absolute path (suffixed preferred, legacy fallback). */
  readonly path: string;
  /** `'suffixed' | 'legacy' | 'legacy-redirect'` — useful for Gate C warnings. */
  readonly form: 'suffixed' | 'legacy' | 'legacy-redirect';
  /** When the consumer was redirected from a legacy to a suffixed path, the
   * original legacy path. Otherwise null. */
  readonly redirectedFrom: string | null;
  /** The rid that was used to resolve the suffixed path, if any. */
  readonly rid: string | null;
}

/**
 * Try the most-specific read first: the suffixed form. On miss, fall back
 * to the legacy form. On legacy hit, run a one-shot lazy migration that
 * renames the legacy file to `<base>-<rid>.md` (when the legacy body
 * contains a recognizable rid), or leaves a 3-line redirect stub.
 *
 * Pure path resolver: does NOT write any new content. The lazy migration
 * only renames an existing file; it does not invent data.
 */
function resolveFindingsPath(args: {
  projectRoot: string;
  changeId: string;
  rid?: string;
  base: 'security-findings' | 'performance-findings';
  legacyFile: string;
  suffixedFile: (rid: string) => string;
}): ResolveFindingsPathResult {
  const qaDir = canonicalQaDir(args.projectRoot, args.changeId);
  if (args.rid !== undefined) {
    const suffixedPath = join(qaDir, args.suffixedFile(args.rid));
    if (existsSync(suffixedPath)) {
      return { path: suffixedPath, form: 'suffixed', redirectedFrom: null, rid: args.rid };
    }
    // Try the legacy misplaced dir (pre-1.3.0 write-path bug) and the
    // sibling-of-`_runtime/` form. Both are migration targets for
    // `peaks workspace migrate-change-scope`.
    const legacyCandidates = [
      join(legacyQaDir(args.projectRoot, args.changeId), args.suffixedFile(args.rid)),
      join(legacyTopLevelQaDir(args.projectRoot, args.changeId), args.suffixedFile(args.rid)),
      join(legacyQaDir(args.projectRoot, args.changeId), args.legacyFile),
      join(legacyTopLevelQaDir(args.projectRoot, args.changeId), args.legacyFile)
    ];
    for (const candidate of legacyCandidates) {
      if (existsSync(candidate)) {
        return {
          path: candidate,
          form: 'legacy',
          redirectedFrom: null,
          rid: args.rid
        };
      }
    }
    // No file present; report the would-be suffixed path so the caller can
    // surface it in error messages.
    return { path: suffixedPath, form: 'suffixed', redirectedFrom: null, rid: args.rid };
  }

  // rid is undefined — caller wants the legacy single-file form.
  const legacyPath = join(qaDir, args.legacyFile);
  if (existsSync(legacyPath)) {
    return { path: legacyPath, form: 'legacy', redirectedFrom: null, rid: null };
  }
  return { path: legacyPath, form: 'legacy', redirectedFrom: null, rid: null };
}

/**
 * Resolve the security-findings artifact path. Preferred form is the
 * `<rid>`-suffixed path; legacy non-suffixed path is accepted as a
 * 1-minor-release back-compat fallback.
 *
 * When `rid` is provided and the suffixed form is missing, the legacy
 * form is reported (NOT the suffixed path) so the caller can decide to
 * log a warning. When `rid` is undefined, the legacy form is the
 * canonical target.
 */
export function resolveSecurityFindingsPath(args: { projectRoot: string; changeId: string; rid?: string }): ResolveFindingsPathResult {
  return resolveFindingsPath({
    projectRoot: args.projectRoot,
    changeId: args.changeId,
    ...(args.rid !== undefined ? { rid: args.rid } : {}),
    base: SECURITY_FINDINGS_BASE,
    legacyFile: SECURITY_FINDINGS_LEGACY,
    suffixedFile: SECURITY_FINDINGS_SUFFIXED
  });
}

/** Resolve the performance-findings artifact path (mirror of `resolveSecurityFindingsPath`). */
export function resolvePerformanceFindingsPath(args: { projectRoot: string; changeId: string; rid?: string }): ResolveFindingsPathResult {
  return resolveFindingsPath({
    projectRoot: args.projectRoot,
    changeId: args.changeId,
    ...(args.rid !== undefined ? { rid: args.rid } : {}),
    base: PERFORMANCE_FINDINGS_BASE,
    legacyFile: PERFORMANCE_FINDINGS_LEGACY,
    suffixedFile: PERFORMANCE_FINDINGS_SUFFIXED
  });
}

/**
 * Lazy migration: rename a legacy non-suffixed QA artifact to the
 * suffixed form for the given rid. Idempotent — re-running is a no-op
 * once the suffixed form exists.
 *
 * Returns the resulting path. Callers (Gate C in `pipeline-verify-service.ts`)
 * log a warning when the legacy form is the one consumed.
 */
export function lazyMigrateLegacyFindings(args: {
  projectRoot: string;
  changeId: string;
  rid: string;
  base: 'security-findings' | 'performance-findings';
  legacyFile: string;
  suffixedFile: (rid: string) => string;
}): { renamed: boolean; path: string } {
  // Slice 2026-06-28: lazy migration operates on the canonical QA dir.
  const qaDir = canonicalQaDir(args.projectRoot, args.changeId);
  const legacyPath = join(qaDir, args.legacyFile);
  const suffixedPath = join(qaDir, args.suffixedFile(args.rid));
  if (!existsSync(legacyPath)) {
    return { renamed: false, path: suffixedPath };
  }
  if (existsSync(suffixedPath)) {
    return { renamed: false, path: suffixedPath };
  }
  try {
    renameSync(legacyPath, suffixedPath);
    return { renamed: true, path: suffixedPath };
  } catch {
    return { renamed: false, path: legacyPath };
  }
}

/**
 * `corroborateDeclaredType` — the declared request type judged against what the
 * change actually touches. A `docs | chore | config` rid selects a reduced
 * prerequisite table, so it may not carry product source.
 *
 * Split out of `type-sanity-service.ts` when that file reached its 300-line cap.
 * It reuses `tryGitDiffFiles` (the SAME enumeration `checkTypeSanity` reads), so
 * the two rules cannot drift; unlike `checkTypeSanity`, it FAILS CLOSED when git
 * cannot enumerate.
 */
import type { RequestType } from '../artifacts/artifact-prerequisites.js';
import { normalizePath } from '../../shared/path-utils.js';
import {
  isArtifactWorkspaceFile,
  tryGitDiffFiles,
  type TypeSanityOptions
} from './type-sanity-service.js';

const TOOLING_ONLY_DECLARED_TYPES = new Set<RequestType>(['docs', 'chore', 'config']);

/** `src/**` + `packages/<name>/src/**` — the rule `.husky/lint-scope.mjs` owns.
 *  `tests/unit/lint/lint-scope-rule.test.ts` binds this copy to that module. */
const PACKAGE_SOURCE_RE = /^packages\/[^/]+\/src\//;

/** True when the path is product source by the repository's own boundary. */
export function isProductSourcePath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return normalized.startsWith('src/') || PACKAGE_SOURCE_RE.test(normalized);
}

/** True for the three types this rule judges (and bypasses are recorded for). */
export function isToolingOnlyDeclaredType(declaredType: RequestType): boolean {
  return TOOLING_ONLY_DECLARED_TYPES.has(declaredType);
}

export type TypeCorroboration =
  { ok: true } | { ok: false; kind: 'source-touched' | 'diff-unavailable'; message: string };

export type TypeCorroborationOptions = TypeSanityOptions & {
  /** A change set the caller already enumerated; skips the git read. */
  changedPaths?: readonly string[];
};

/** The fail-closed verdict, shared with the transition gate's own read. */
export function diffUnavailableVerdict(
  declaredType: RequestType,
  baseRef = 'HEAD'
): Extract<TypeCorroboration, { ok: false }> {
  return {
    ok: false,
    kind: 'diff-unavailable',
    message:
      `Declared type '${declaredType}' could not be corroborated: git could not enumerate ` +
      `the changed files against '${baseRef}' (not a repo, or the ref is unreadable). ` +
      'This gate fails closed — an unreadable diff is not an empty diff.'
  };
}

export function corroborateDeclaredType(options: TypeCorroborationOptions): TypeCorroboration {
  if (!isToolingOnlyDeclaredType(options.declaredType)) return { ok: true };
  const baseRef = options.baseRef ?? 'HEAD';
  let files: string[];
  if (options.changedPaths !== undefined) {
    files = options.changedPaths.filter((file) => !isArtifactWorkspaceFile(file));
  } else {
    const read = tryGitDiffFiles(options.projectRoot, baseRef);
    if (!read.ok) return diffUnavailableVerdict(options.declaredType, baseRef);
    files = read.files;
  }
  const offendingPaths = files.filter(isProductSourcePath);
  if (offendingPaths.length === 0) return { ok: true };
  return {
    ok: false,
    kind: 'source-touched',
    message:
      `Declared type '${options.declaredType}' cannot change product source: ${offendingPaths.join(', ')}. ` +
      'A docs/chore/config request selects a reduced prerequisite table, so it may not carry ' +
      'src/** or packages/<name>/src/** changes. Declare feature, bugfix or refactor (which carry ' +
      'the full QA evidence), or move the change out of product source.'
  };
}

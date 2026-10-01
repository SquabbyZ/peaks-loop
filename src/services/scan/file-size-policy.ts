// src/services/scan/file-size-policy.ts
//
// THE ONE SOURCE OF TRUTH for the repo's file-size cap policy: the two caps,
// the directories they cover, the extensions in scope, and the unit a "line" is
// measured in. Everything that enforces the cap reads it from here —
// `src/services/scan/file-size-scan.ts` (the diff-scoped CLI scan) and
// `scripts/lint/file-size-census.ts` (the whole-tree count the husky gate
// ratchets). Neither may restate a number.
//
// WHY ONE MODULE (rid 2026-09-30-cap-unify-01). The policy was written twice,
// in two units: `max-lines: [error, {max: 400, skipBlankLines, skipComments}]`
// in `config/eslint/.peaks-rules.cjs` and a raw `DEFAULT_FILE_SIZE_THRESHOLD`
// of 800 here. Two spellings of one decision drift by construction, and the only
// number anyone ratcheted was the eslint finding count — which measures a
// DIFFERENT population (98 `max-lines` findings under 400-effective vs 174 files
// over the decided 300/500 raw cap). The eslint rule value is deliberately
// unchanged until the splits land; see `.peaks/docs/lint-gate.md` §4 slice 5.
//
// THE UNIT IS PART OF THE POLICY. A line is
// `readFileSync(f, 'utf8').split('\n').length` — a split-newline count, which is
// `wc -l` plus one per file. That is not a detail: on the same 174 files the
// campaign recorded 60,982 excess lines with this convention and 60,808 with
// `wc -l`, and a ratchet seeded from the other convention is off by exactly the
// file count. `countRawLines` below is the only implementation of the word
// "line" in this policy, and the census reports it in its envelope so a reader
// of the number can see which unit produced it.
//
// `scripts/` IS IN SCOPE. The decided cap text named only `src`, `packages` and
// `tests`, but the 174 the ceiling was seeded from counts 5 `scripts/` files.
// A row that silently excluded them would not equal its own measurement — the
// same class of hole as lint-gate §4b (a surface asserted but never counted).
//
// NUMBERS THIS MODULE DOES NOT OWN, DECIDED 2026-09-30 (F6 of the repair cycle).
// A line-count constant elsewhere in the repo is a second copy of THIS policy only
// if it decides the same question — "may this file be committed at this size?".
// Three that do not, recorded here so the next reader does not re-litigate them:
//   - `config/eslint/.peaks-rules.cjs` `max-lines: 400` EFFECTIVE lines: the same
//     question in a different unit, deliberately left at 400 until the splits land
//     (lint-gate §4 slice 5; 98 findings ≠ 174 files).
//   - `src/services/legacy/legacy-detector.ts` `LARGE_FILE_LINES = 500`: a smell
//     DETECTOR's "is this file big enough to look legacy?" threshold. It reports a
//     suspicion, blocks nothing, and descends no ceiling, so it is NOT a copy of
//     this cap and is NOT folded into it — folding it in would silently change what
//     the legacy report says. Its name does not match the census's `CAP_NAME`
//     second-copy rule on purpose; see lint-gate §4b row 7.
//   - `src/services/skills/lint-reference-shape.ts` 800: the shape of an
//     example lint report, not a cap.

/** Raw-line cap for `src/`, `scripts/` and `packages/` — including a `tests` directory inside a package. */
export const FILE_SIZE_CAP_DEFAULT = 300;

/** Raw-line cap for the root `tests/` tree. A `tests/` dir inside a package keeps the 300 cap. */
export const FILE_SIZE_CAP_TESTS = 500;

/** Directories the policy measures, relative to the project root. */
export const FILE_SIZE_SCOPE_DIRS = ['src', 'tests', 'packages', 'scripts'] as const;

/** The extensions it measures. The same seven the lint scope admits. */
export const FILE_SIZE_SCOPE_EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'mjs', 'cjs', 'js'] as const;

/** The unit, stated in the artifact that carries the number rather than in prose. */
export const FILE_SIZE_LINE_CONVENTION = "readFileSync(f,'utf8').split('\\n').length";

/** The two caps, as the census reports them. */
export type FileSizeCaps = {
  readonly defaultCap: number;
  readonly testsCap: number;
};

/** The caps this policy defines right now. */
export function fileSizeCaps(): FileSizeCaps {
  return {
    defaultCap: FILE_SIZE_CAP_DEFAULT,
    testsCap: FILE_SIZE_CAP_TESTS
  };
}

/** Forward slashes, so a Windows-native path matches the same rule as a POSIX one. */
export function normalizePolicyPath(file: string): string {
  return file.split('\\').join('/');
}

/** True when `file` ends in an extension the policy measures. */
export function hasPolicyExtension(file: string): boolean {
  const path = normalizePolicyPath(file);
  const dot = path.lastIndexOf('.');
  if (dot < 0) return false;
  return (FILE_SIZE_SCOPE_EXTENSIONS as readonly string[]).includes(path.slice(dot + 1));
}

/** True when `file` sits under one of the directories the policy measures. */
export function inFileSizeScope(file: string): boolean {
  const path = normalizePolicyPath(file);
  return (FILE_SIZE_SCOPE_DIRS as readonly string[]).some((dir) => path.startsWith(`${dir}/`));
}

/**
 * THE one definition of "a file the policy measures": under a scope directory AND
 * of a scope extension. Both consumers read this instead of each carrying its own
 * half of the rule.
 *
 * WHY IT MATTERS (F3 of the repair cycle, rid `2026-09-30-cap-unify-01`). The
 * census enumerated its scope with `git ls-files <dirs>` plus the extension test,
 * while the scan measured EVERY changed non-exempt file at `fileSizeCapFor`'s
 * else-branch 300 — including paths in neither list. The two disagreed about the
 * same policy, and the disagreement was not harmless: an out-of-scope file (e.g.
 * under `.husky/`, or a `.json`) could redden a `request transition` at 300 lines
 * while contributing nothing to `fileSizeOverCap`, so there was no ratchet row to
 * descend and no split campaign that would ever clear it. Enforcement wider than
 * the declared scope is enforcement nobody can satisfy.
 */
export function isPolicyMeasuredFile(file: string): boolean {
  return inFileSizeScope(file) && hasPolicyExtension(file);
}

/**
 * The cap a path is measured against: 500 for the root `tests/` tree, 300 for
 * everything else in scope — including a `tests` directory inside a package,
 * which keeps its parent scope's cap by the reading decided 2026-09-30.
 *
 * PRECONDITION: `isPolicyMeasuredFile(file)`. The else-branch is `src`,
 * `packages` and `scripts` ONLY because that is what the policy decided; handed a
 * path outside the scope it would invent a cap for a file the row cannot see, so
 * callers must gate on the predicate above first (`file-size-scan.ts` does).
 */
export function fileSizeCapFor(file: string): number {
  return normalizePolicyPath(file).startsWith('tests/')
    ? FILE_SIZE_CAP_TESTS
    : FILE_SIZE_CAP_DEFAULT;
}

/**
 * The policy's unit: raw lines counted by splitting on newlines. NOT `wc -l` —
 * see the header. A file with no trailing newline still counts its last line;
 * an empty file counts as one.
 */
export function countRawLines(content: string): number {
  return content.split('\n').length;
}

/** The top-level directory a scoped path belongs to, as the census buckets it. */
export function fileSizeScopeBucket(file: string): string {
  const path = normalizePolicyPath(file);
  const slash = path.indexOf('/');
  return slash < 0 ? path : path.slice(0, slash);
}

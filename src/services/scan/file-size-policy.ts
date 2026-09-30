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
 * The cap a path is measured against: 500 for the root `tests/` tree, 300 for
 * everything else in scope — including a `tests` directory inside a package,
 * which keeps its parent scope's cap by the reading decided 2026-09-30.
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

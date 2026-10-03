/**
 * `.husky/baseline/paths.mjs` — the generator's own paths, the constants every
 * measurement leg reads, and THE ONE REFUSAL SHAPE (rid
 * `2026-10-02-wave9-generator-split`, cutting HEAD's
 * `.husky/peaks-gate-baseline.mjs` lines 88–101 and 170–181).
 *
 * Two declared changes and nothing else: each public declaration gained the
 * `export` keyword, and `ROOT` is anchored one directory deeper because this
 * file sits in `.husky/baseline/` — the VALUE is HEAD's entry `ROOT`, the repo
 * root, still slash-normalised at the definition (see the comment on the cut).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MEASURED_DIRS } from '../lint-scope.mjs';

// Slash-normalised once, at the definition — `resolve()` returns backslashes on
// Windows and a `${ROOT}/` built from that can never match a normalised path.
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  .split('\\')
  .join('/');
export const OUT_PATH = resolve(ROOT, '.peaks/lint/gate-baseline.json');
export const ESLINT_CONFIG = 'config/eslint/.peaks-rules.cjs';
export const CODE_EXT = /\.(ts|tsx|mts|cts|mjs|cjs|js)$/;
// THE MEASUREMENT UNIVERSE, not the enforced scope (rid `2026-10-03-w10-rescope-a`,
// §2.42): the legs still walk these directories so the out-of-scope debt stays
// MEASURED as shadow rows; what the ceilings enforce is the gated subset of it,
// spelled once in `.husky/lint-scope.mjs`. The name stayed `TOP_DIRS` for the
// scope block's sake; the VALUE is the rule module's `MEASURED_DIRS` — one
// import, no second copy — which mirrors the `.ts` policy's
// `FILE_SIZE_SCOPE_DIRS` under the arm in
// `tests/unit/lint/lint-scope-rule.test.ts`.
export const TOP_DIRS = MEASURED_DIRS;
export const COVERAGE_GAP = /was not found in any of the provided project/;
export const PHANTOM_DEF = /Definition for rule '(.+)' was not found/;
export const BATCH = 150; // argv stays well under the Windows command-line limit

export const rel = (p) => p.split('\\').join('/').replace(`${ROOT}/`, '');

export const OUT_REL = rel(OUT_PATH);
export const HEAD_REF = `HEAD:${OUT_REL}`;

/** Print the generator's one refusal shape and stop, with the bytes untouched. */
export function refuse(reason) {
  console.error(
    `\nREFUSING to write ${OUT_REL}: ${reason}\n` +
      '  Nothing has been written; the existing ceilings are untouched.\n'
  );
  process.exit(1);
}

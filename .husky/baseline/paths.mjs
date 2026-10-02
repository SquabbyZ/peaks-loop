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

// Slash-normalised once, at the definition — `resolve()` returns backslashes on
// Windows and a `${ROOT}/` built from that can never match a normalised path.
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  .split('\\')
  .join('/');
export const OUT_PATH = resolve(ROOT, '.peaks/lint/gate-baseline.json');
export const ESLINT_CONFIG = 'config/eslint/.peaks-rules.cjs';
export const CODE_EXT = /\.(ts|tsx|mts|cts|mjs|cjs|js)$/;
export const TOP_DIRS = ['src', 'tests', 'packages', 'scripts'];
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

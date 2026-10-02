/**
 * Shared leaves of the monotonicity rule: the flag, the shape tests and the
 * renderers every sibling needs. One home per helper, so no sibling re-declares
 * one. Bodies below are VERBATIM from `.husky/peaks-gate-baseline-monotonic.mjs`
 * (wave 9 split, rid `2026-10-02-wave9-monotonic-split`); the `export` line at the
 * bottom is the only addition — HEAD kept these module-private.
 */

/** The flag that opts a run in to writing a baseline where there was none. */
export const SEED_FLAG = '--seed';

const isCeilingVector = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** A ceiling rendered the way a human reads it back off an artifact. */
function displayValue(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === undefined) return 'undefined';
  return String(value);
}

const bullet = (lines) => lines.map((line) => `    - ${line}`).join('\n');

export { isCeilingVector, displayValue, bullet };

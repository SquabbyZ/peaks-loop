// tests/unit/_setup/4dim-template.ts
//
// 4-dimension test split (per `.peaks/standards/typescript/testing.md`):
//   1. render   — output shape only (stdout / JSON / file content)
//   2. behavior — input → return / state transitions / error throws
//   3. integration — boundaries with fs / subprocess / network / env / clock
//   4. a11y     — human-visible text, exit codes, structured error messages
//
// Each new test file MUST use one `describe` per applicable dimension. If
// a dimension does not apply (e.g. a pure utility has no `a11y` surface),
// the file's header comment must name the omitted dimensions and why.
//
// The functions in this file are not assertions — they are scaffolding that
// fails loudly if a test file accidentally skips a dimension. Use the
// `expect*` helpers to make skipped dimensions visible in the report.

import { describe, expect } from 'vitest';

export type Dimension = 'render' | 'behavior' | 'integration' | 'a11y';

const ALL: readonly Dimension[] = ['render', 'behavior', 'integration', 'a11y'] as const;

/**
 * Declare which dimensions this test file covers. Dimensions that are not
 * applicable MUST be listed in `omitted` with a one-line reason — otherwise
 * the test file is incomplete.
 */
export function declareDimensions(
  file: string,
  covered: readonly Dimension[],
  omitted: ReadonlyArray<{ dim: Dimension; reason: string }> = [],
): void {
  const coveredSet = new Set(covered);
  const missing = ALL.filter((d) => !coveredSet.has(d) && !omitted.find((o) => o.dim === d));
  if (missing.length > 0) {
    throw new Error(
      `[${file}] missing dimensions ${missing.join(', ')}; either add a describe(...) or pass an omitted[] entry with a reason.`,
    );
  }
  // Sanity: each omit must reference a real dim.
  for (const o of omitted) {
    if (coveredSet.has(o.dim)) {
      throw new Error(`[${file}] dimension ${o.dim} listed in both covered and omitted`);
    }
  }
}

/**
 * Use inside a `describe` that intentionally has no test cases (e.g. a
 * placeholder for a future dimension). Marks the suite as TODO without
 * failing the run; vitest reports it as a passing empty suite.
 */
export function describePlaceholder(dim: Dimension, why: string): void {
  describe(`(${dim}) — placeholder: ${why}`, () => {
    it('exists; intentionally empty', () => {
      expect(why.length).toBeGreaterThan(0);
    });
  });
}

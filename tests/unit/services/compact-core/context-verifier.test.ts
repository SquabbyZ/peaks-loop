/**
 * Task 1.3 verification tests.
 *
 * Dimensions: behavior only. Render, integration, and a11y do not apply to
 * this pure numeric reduction predicate.
 */
import { describe, expect, it } from 'vitest';
import { verifyContextReduction } from '../../../../src/services/compact-core/context-verifier.js';

describe('behavior — context reduction predicate', () => {
  it('passes only when after is strictly below 70% of before and the default target', () => {
    expect(
      verifyContextReduction({
        before: { ratio: 0.9 },
        after: { ratio: 0.59 }
      })
    ).toEqual({ passed: true, requiredMaximum: 0.6 });
  });

  it('fails at exact boundary equality', () => {
    const before = { ratio: 0.8 };
    const requiredMaximum = Math.min(before.ratio * 0.7, 0.6);
    expect(
      verifyContextReduction({
        before,
        after: { ratio: requiredMaximum }
      })
    ).toEqual({ passed: false, requiredMaximum });
  });

  it('uses an explicit target ratio in the exact minimum formula', () => {
    expect(
      verifyContextReduction({
        before: { ratio: 0.9 },
        after: { ratio: 0.49 },
        targetRatio: 0.5
      })
    ).toEqual({ passed: true, requiredMaximum: 0.5 });
  });

  it.each([
    [{ ratio: Number.NaN }, { ratio: 0.2 }, {}],
    [{ ratio: 0.8 }, { ratio: Number.NaN }, {}],
    [{ ratio: -0.1 }, { ratio: 0.2 }, {}],
    [{ ratio: 0.8 }, { ratio: 1.1 }, {}],
    [{ ratio: 0.8 }, { ratio: 0.2 }, { targetRatio: Number.POSITIVE_INFINITY }],
    [{ ratio: 0.8 }, { ratio: 0.2 }, { targetRatio: -0.1 }],
    [{ ratio: 0.8 }, { ratio: 0.2 }, { targetRatio: 1.1 }]
  ])('rejects non-finite or out-of-range ratios', (before, after, target) => {
    expect(() => verifyContextReduction({ before, after, ...target })).toThrow(/ratio/);
  });
});

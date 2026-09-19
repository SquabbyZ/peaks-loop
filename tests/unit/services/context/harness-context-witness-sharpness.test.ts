/**
 * rid `2026-09-13-statusline-window-witness` — CAN THIS SAMPLE ANSWER AT ALL.
 *
 * The comparison's two answers need different evidence, so they do not share
 * one gate: `disagree` only claims that some window difference exists (a
 * residual past the budget is exactly that claim), while `agree` claims the
 * two denominators MATCH and therefore needs a sample sharp enough to support
 * it. These cases pin where that second gate sits, and sweep the whole space it
 * is supposed to hold in.
 *
 * WHY A SWEEP AND NOT A CASE (repair cycle 2). The defect this file exists for
 * survived two repair cycles because the probe that was supposed to catch it
 * varied ONE ratio (0.96 of the window) and reported green — the gate was a
 * function of peaks-loop's ratio while the signal it judged scaled with the
 * WITNESS's, so a real 3% gap stayed maskable everywhere below 0.61 and was
 * only ever looked for at 0.96. A case-based probe cannot see that; a sweep
 * over the ratio axis can.
 *
 * The fixture scaffolding is deliberately local and minimal: every case here
 * hands both sides their numbers explicitly, because the thing under test is
 * the relationship between them and not a fixture builder.
 *
 * Style: BDD given/when/then per peaks-loop 4.0.11+ contract.
 */
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/context/harness-context-witness-sharpness.test.ts',
  ['behavior'],
  [
    {
      dim: 'render',
      reason:
        'No output shape is asserted here; the one-way sentence and the CLI envelope live in harness-context-witness.test.ts and code-context-now-witness.test.ts.'
    },
    {
      dim: 'integration',
      reason:
        'Every case calls the comparison directly — no fs, subprocess, env, network or clock boundary is crossed.'
    },
    {
      dim: 'a11y',
      reason:
        'No human-visible text, exit code or structured error message is produced by a pure comparison call.'
    }
  ]
);

import {
  MIN_DETECTABLE_WINDOW_DIFFERENCE,
  WITNESS_SCHEMA_VERSION,
  compareHarnessWitness,
  type HarnessContextWitness
} from '~/src/services/context/harness-context-witness';

const WINDOW = 1_000_000;
/** peaks-loop reads WINDOW; the harness's effective window is WINDOW/(1+gap). */
const PEAKS_RATIO_FIXTURE = 0.9;
const PEAKS_TOKENS_FIXTURE = 900_000;

/** A witness consistent with the probe unless a case says otherwise. */
function witnessOf(overrides: Partial<HarnessContextWitness> = {}): HarnessContextWitness {
  const usedPercentage =
    overrides.usedPercentage === undefined ? PEAKS_RATIO_FIXTURE : overrides.usedPercentage;
  return {
    schemaVersion: WITNESS_SCHEMA_VERSION,
    capturedAt: '2026-09-13T10:00:00.000Z',
    usedPercentage,
    usedPercentageRaw: usedPercentage,
    usedPercentageUnit: usedPercentage === null ? null : 'fraction',
    modelWindowTokens: WINDOW,
    usageTokens: PEAKS_TOKENS_FIXTURE,
    outerSessionId: null,
    ...overrides
  };
}

function compareWith(
  witness: HarnessContextWitness | null,
  overrides: Record<string, unknown> = {}
) {
  return compareHarnessWitness({
    witness,
    peaksRatio: PEAKS_RATIO_FIXTURE,
    peaksTokens: PEAKS_TOKENS_FIXTURE,
    peaksWindowTokens: WINDOW,
    outerSessionId: null,
    ...overrides
  });
}

describe('harness context witness — how sharp this sample is (behavior)', () => {
  it('should pin the sharpness gate to its declared value, not to whatever it currently is', () => {
    // The budget and the gate used to be recomputed from the exported
    // constants in every expectation here, so moving the gate from 0.03 to
    // 0.05 left all 31 cases green — a self-referential expectation cannot
    // notice that the thing it derives from moved. This one is a literal.
    expect(MIN_DETECTABLE_WINDOW_DIFFERENCE).toBe(0.03);
  });

  it('when the two ratios straddle the point where agreement becomes sayable, should abstain below it and agree above', () => {
    // THE PIN ON WHERE THE GATE SITS, on the axis it now measures. Both
    // inputs are exactly consistent witnesses (residual 0) — the same moment,
    // recorded at two different sizes — so the ONLY thing that separates them
    // is whether a sample at that size can support an `agree`. The boundary
    // is where the residual a 3% window difference would leave,
    // `0.03 x h / 1.03`, stops being smaller than twice the budget:
    // h x 0.029126 > 2 x (0.005 + 0.0017 x h), i.e. h > 0.3887.
    const small = compareWith(witnessOf({ usedPercentage: 0.38, usageTokens: 380_000 }), {
      peaksRatio: 0.38,
      peaksTokens: 380_000
    });
    const large = compareWith(witnessOf({ usedPercentage: 0.4, usageTokens: 400_000 }), {
      peaksRatio: 0.4,
      peaksTokens: 400_000
    });
    // then: 2 points of ratio apart, and the answers differ — which is what
    // makes the gate's position a decision rather than a decoration
    expect(small.residual).toBeCloseTo(0, 10);
    expect(small.verdict).toBe('unverifiable');
    expect(large.residual).toBeCloseTo(0, 10);
    expect(large.verdict).toBe('agree');
  });

  it('should never report `agree` for a real window gap, at ANY ratio and ANY skew', () => {
    // THE ACCEPTANCE TEST FOR REPAIR CYCLE 2, and a sweep rather than a
    // sample — one ratio and one skew is what let the same defect through
    // twice. The case above sweeps skew at 0.96 of the window, the only
    // region a sample-based probe had ever looked at. This one sweeps the
    // ratio too, across the whole range the probe can run in, against real
    // gaps from the declared 3% floor upward.
    //
    // What it asserts is not "the guard fires" — a gap narrower than the
    // sample's resolution is legitimately unanswerable. It asserts that the
    // guard never answers `agree`, which is the one answer it cannot support
    // there: measured before this repair, 2,436 of 95,475 swept samples
    // reported `agree` over a real gap (up to 8%), at every ratio below 0.61,
    // and `unverifiable` was unreachable above 0.18 of the window.
    //
    // The quantization is the harness's own rounding, in the two shapes the
    // budget assumes (nearest, at integer or tenth percent). A TRUNCATING
    // harness is a separate residual — this budget is only conservative for
    // symmetric rounding — and is deliberately not swept here.
    const W = 1_000_000;
    const gaps = [0.03, 0.033, 0.05, 0.08, 0.12];
    const masked: string[] = [];
    for (const quantize of [
      (value: number) => value,
      (value: number) => Math.round(value * 100) / 100,
      (value: number) => Math.round(value * 1000) / 1000
    ]) {
      for (let ratio = 0.05; ratio <= 0.995; ratio += 0.01) {
        for (const gap of gaps) {
          for (let skew = -0.02; skew <= 0.08; skew += 0.0005) {
            const peaksTokens = Math.round(ratio * W);
            const witnessTokens = peaksTokens - Math.round(skew * W);
            const harnessWindow = W / (1 + gap);
            const harnessPct = quantize(witnessTokens / harnessWindow);
            // a payload cannot report more than a full window
            if (harnessPct <= 0 || harnessPct > 1) continue;
            const comparison = compareHarnessWitness({
              witness: witnessOf({ usedPercentage: harnessPct, usageTokens: witnessTokens }),
              peaksRatio: ratio,
              peaksTokens,
              peaksWindowTokens: W,
              outerSessionId: null
            });
            if (comparison.verdict === 'agree') {
              masked.push(
                `ratio=${ratio.toFixed(2)} gap=${(gap * 100).toFixed(1)}% skew=${skew.toFixed(4)}`
              );
            }
          }
        }
      }
    }
    // The worst case inside the swept range, named rather than counted, so a
    // failure says which sample is maskable (the report of this run: empty).
    expect(masked).toEqual([]);
  });
});

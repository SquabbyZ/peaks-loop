/**
 * Calibration store for slice work-estimation.
 *
 * v1 (current): pure heuristic based on LoC + test count + complexity.
 *   confidence: 'low' until >= 5 historical slice records exist.
 *   formula: minutesP50 = 0.25 * locSum + 0.5 * testCount + 0.1 * complexitySum
 *            minutesP90 = minutesP50 * 1.6
 *
 * v1.1 (next): read `.peaks/_runtime/<sessionId>/qa/cycle-time.json` history; if
 *   sample size >= 5 for a complexity bucket, switch to percentile-based
 *   estimate with confidence 'high'.
 *
 * v1 rationale: peaks-loop itself has fewer than 5 completed refactor slices
 * (per the design doc R3), so v1 cannot be calibrated yet. v1 ships the
 * heuristic AND records every estimate to `.peaks/_runtime/<sid>/sc/
 * slice-calibration/<rid>.json` so the next slice can use the prior data.
 *
 * LoC is intentionally kept as a primary input (not replaced). The user
 * feedback that motivated the algorithm explicitly cited LoC as a useful
 * signal -- the issue was the absence of a DAG on top, not the absence
 * of LoC. The "complexity" field in nodes is unused for v1 because
 * codegraph v0.7.10 does not emit it; v2 can re-enable once
 * `.codegraph/codegraph.db` is read directly.
 */

import type { WorkEstimate } from './slice-decompose-types.js';

/**
 * PRD-002b slice 2 — calibration heuristic coefficients + thresholds
 * extracted into named constants so the no-magic-numbers rule stops
 * flagging the weight+threshold math. Values are bytewise-identical to
 * the original literals.
 */
const LOC_WEIGHT_PER_LINE = 0.25;
const TEST_WEIGHT_PER_FILE = 0.5;
const COMPLEXITY_WEIGHT_PER_NODE = 0.1;
const P90_P50_RATIO = 1.6;
const HIGH_CONFIDENCE_MIN_SAMPLES = 5;
const MEDIUM_CONFIDENCE_MIN_SAMPLES = 1;
const OUTPUT_PRECISION_DECIMALS = 10;

/**
 * Compute a work-estimate envelope.
 *
 * @param complexitySum Sum of `complexity` of touched graph nodes. Pass 0
 *                      when codegraph v0.7.10 (the field is not emitted).
 * @param testCount     Number of test files this slice adds/modifies.
 * @param locSum        Sum of LoC across the slice's primary files.
 * @param sampleSize    Number of historical slice records the calibrator
 *                      could draw from. Drives confidence:
 *                        >= 5 -> 'high' (percentile lookup would be used in v1.1)
 *                        >= 1 -> 'medium' (some signal)
 *                         == 0 -> 'low' (heuristic only)
 */
export function calibrate(
  complexitySum: number,
  testCount: number,
  locSum: number,
  sampleSize: number
): WorkEstimate {
  if (!Number.isFinite(complexitySum) || complexitySum < 0) {
    throw new RangeError(`calibrate: complexitySum must be a non-negative finite number, got ${complexitySum}`);
  }
  if (!Number.isInteger(testCount) || testCount < 0) {
    throw new RangeError(`calibrate: testCount must be a non-negative integer, got ${testCount}`);
  }
  if (!Number.isFinite(locSum) || locSum < 0) {
    throw new RangeError(`calibrate: locSum must be a non-negative finite number, got ${locSum}`);
  }
  if (!Number.isInteger(sampleSize) || sampleSize < 0) {
    throw new RangeError(`calibrate: sampleSize must be a non-negative integer, got ${sampleSize}`);
  }

  const minutesP50 = LOC_WEIGHT_PER_LINE * locSum + TEST_WEIGHT_PER_FILE * testCount + COMPLEXITY_WEIGHT_PER_NODE * complexitySum;
  const minutesP90 = minutesP50 * P90_P50_RATIO;
  const confidence: WorkEstimate['confidence'] = sampleSize >= HIGH_CONFIDENCE_MIN_SAMPLES ? 'high' : sampleSize >= MEDIUM_CONFIDENCE_MIN_SAMPLES ? 'medium' : 'low';
  const rationale =
    sampleSize === 0
      ? `v1 heuristic: ${LOC_WEIGHT_PER_LINE} min/LoC + ${TEST_WEIGHT_PER_FILE} min/test + ${COMPLEXITY_WEIGHT_PER_NODE} min/complexity; confidence low because no historical sample`
      : sampleSize < HIGH_CONFIDENCE_MIN_SAMPLES
        ? `v1 heuristic: ${sampleSize} historical sample(s) available; will switch to percentile lookup at sampleSize >= ${HIGH_CONFIDENCE_MIN_SAMPLES}`
        : `v1 heuristic with sampleSize ${sampleSize}; v1.1 will switch to percentile lookup`;

  return {
    complexitySum,
    testCount,
    locSum,
    minutesP50: Math.round(minutesP50 * OUTPUT_PRECISION_DECIMALS) / OUTPUT_PRECISION_DECIMALS,
    minutesP90: Math.round(minutesP90 * OUTPUT_PRECISION_DECIMALS) / OUTPUT_PRECISION_DECIMALS,
    confidence,
    rationale
  };
}

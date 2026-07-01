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

  const minutesP50 = 0.25 * locSum + 0.5 * testCount + 0.1 * complexitySum;
  const minutesP90 = minutesP50 * 1.6;
  const confidence: WorkEstimate['confidence'] = sampleSize >= 5 ? 'high' : sampleSize >= 1 ? 'medium' : 'low';
  const rationale =
    sampleSize === 0
      ? 'v1 heuristic: 0.25 min/LoC + 0.5 min/test + 0.1 min/complexity; confidence low because no historical sample'
      : sampleSize < 5
        ? `v1 heuristic: ${sampleSize} historical sample(s) available; will switch to percentile lookup at sampleSize >= 5`
        : `v1 heuristic with sampleSize ${sampleSize}; v1.1 will switch to percentile lookup`;

  return {
    complexitySum,
    testCount,
    locSum,
    minutesP50: Math.round(minutesP50 * 10) / 10,
    minutesP90: Math.round(minutesP90 * 10) / 10,
    confidence,
    rationale
  };
}

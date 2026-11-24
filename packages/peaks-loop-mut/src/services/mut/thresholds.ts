/**
 * Per spec §4.2 验收审计 — Default thresholds + evaluator.
 *
 * Override via `peaks-mut.config.json` at project root.
 */
import type { EvaluatedAxes } from './types.js';

export interface Thresholds {
  readonly mutationKillRateMin: number;
  readonly weakAssertionRateMax: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = Object.freeze({
  mutationKillRateMin: 0.8,
  weakAssertionRateMax: 0.05
});

export type ThresholdViolationKind = 'mutationKillRateMin' | 'weakAssertionRateMax';

export interface ThresholdViolation {
  readonly kind: ThresholdViolationKind;
  readonly actual: number;
  readonly threshold: number;
}

export interface ThresholdEvaluation {
  readonly passed: boolean;
  readonly violations: ReadonlyArray<ThresholdViolation>;
  readonly evaluated: EvaluatedAxes;
}

/** The default: both axes are judged, which is what `peaks mut run` does. */
export const ALL_AXES: EvaluatedAxes = Object.freeze({ mutation: true, assertions: true });

/**
 * Judge the axes named in `evaluated`. An axis that was not measured (the
 * mutation axis during `peaks mut asserts`) produces no violation, so the
 * verdict rests on the axes the report actually carries.
 */
export function evaluateThresholds(
  t: Thresholds,
  actualKillRate: number,
  actualWeakRate: number,
  evaluated: EvaluatedAxes = ALL_AXES
): ThresholdEvaluation {
  const violations: ThresholdViolation[] = [];
  if (evaluated.mutation && actualKillRate < t.mutationKillRateMin) {
    violations.push({
      kind: 'mutationKillRateMin',
      actual: actualKillRate,
      threshold: t.mutationKillRateMin
    });
  }
  if (evaluated.assertions && actualWeakRate > t.weakAssertionRateMax) {
    violations.push({
      kind: 'weakAssertionRateMax',
      actual: actualWeakRate,
      threshold: t.weakAssertionRateMax
    });
  }
  return { passed: violations.length === 0, violations, evaluated };
}

/**
 * Per spec §4.2 验收审计 — Default thresholds + evaluator.
 *
 * Override via `peaks-mut.config.json` at project root.
 */
export interface Thresholds {
  readonly mutationKillRateMin: number;
  readonly weakAssertionRateMax: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = Object.freeze({
  mutationKillRateMin: 0.80,
  weakAssertionRateMax: 0.05,
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
}

export function evaluateThresholds(
  t: Thresholds,
  actualKillRate: number,
  actualWeakRate: number,
): ThresholdEvaluation {
  const violations: ThresholdViolation[] = [];
  if (actualKillRate < t.mutationKillRateMin) {
    violations.push({
      kind: 'mutationKillRateMin',
      actual: actualKillRate,
      threshold: t.mutationKillRateMin,
    });
  }
  if (actualWeakRate > t.weakAssertionRateMax) {
    violations.push({
      kind: 'weakAssertionRateMax',
      actual: actualWeakRate,
      threshold: t.weakAssertionRateMax,
    });
  }
  return { passed: violations.length === 0, violations };
}
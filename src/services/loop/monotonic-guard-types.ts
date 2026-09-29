/**
 * peaks-loop v3.0.0 — Slice C.1
 *
 * Type declarations for the monotonic-improvement guard, relocated verbatim
 * from `monotonic-guard.ts` so that module stays under the repo file-size cap.
 * No behaviour lives here: every declaration is erased at compile time and the
 * guard module re-exports all of them from its own path.
 */

/** Per-evaluator score row, derived from an `EvaluatorVerdictEnvelope`. */
export interface MonotonicScoreRow {
  readonly evaluator: string;
  readonly score: number;
  readonly gateAction: 'pass' | 'warn' | 'block';
  readonly degraded: boolean;
  /** ISO-8601 timestamp the verdict was recorded. */
  readonly observedAt: string;
}

/** Cycle index — a single attempt at the loop. */
export interface MonotonicCycle {
  readonly cycle: number;
  /** Per-evaluator score rows. Same evaluator appearing twice collapses
   *  to the last entry (BC: deterministic, no merging surprises). */
  readonly scores: readonly MonotonicScoreRow[];
}

export interface MonotonicRegression {
  readonly evaluator: string;
  readonly previousScore: number;
  readonly currentScore: number;
  readonly delta: number;
}

/** Result of a `checkMonotonicImprovement` call. */
export interface MonotonicReport {
  readonly status: 'pass' | 'warn' | 'block' | 'skip';
  readonly ok: boolean;
  readonly reason: string;
  readonly threshold: number;
  readonly previousCycle: number | null;
  readonly currentCycle: number;
  /** Per-evaluator regressions exceeding the threshold (sorted by |delta| desc). */
  readonly regressions: readonly MonotonicRegression[];
  /** Convenience boolean — true iff a regression exceeds the threshold. */
  readonly monotonicityViolation: boolean;
  /** Diagnostic hint surfaced as `MONOTONICITY_VIOLATION` in the CLI envelope. */
  readonly code:
    | 'MONOTONIC_OK'
    | 'MONOTONIC_NO_PREVIOUS'
    | 'MONOTONIC_VIOLATION'
    | 'MONOTONIC_INCOMPARABLE_EVALUATORS';
}

export interface CheckMonotonicOptions {
  /** Maximum regression permitted (in [0,1] scale). Default 0.05 (5%). */
  readonly threshold?: number;
  /** When provided, the guard logs the cycle id this report refers to. */
  readonly nowIso?: string;
}

/**
 * Type envelope for the `peaks slice check` CLI command.
 *
 * `peaks slice check` is the boundary check for the RD micro-cycle
 * (see `skills/peaks-solo/references/micro-cycle.md`). It bundles the
 * 4 self-checks that must pass at slice end before the slice is handed
 * off to peaks-qa:
 *
 *   1. typecheck (`npx tsc --noEmit`)
 *   2. unit tests (`npx vitest run`)
 *   3. 3-way review fan-out (code-review + security-review + perf-baseline)
 *   4. gate machinery (`peaks workflow verify-pipeline --rid <rid>`)
 *
 * The micro-cycle itself (per-bug TDD) runs OUTSIDE slice check — only
 * single-test runs (`vitest -t "<name>"`) are allowed in micro-cycles.
 * This command is for the BOUNDARY, not the inner loop.
 */

export type SliceCheckStageStatus = 'pass' | 'fail' | 'skipped';

export type SliceCheckStage = {
  /** Stable id for the stage (matches the runbook's check list). */
  name: 'typecheck' | 'unit-tests' | 'review-fanout' | 'gate-verify-pipeline';
  /** Human-readable description. */
  description: string;
  status: SliceCheckStageStatus;
  /** Wall-clock duration in ms; null if skipped. */
  durationMs: number | null;
  /** Free-form detail (summary line + last error line). */
  detail: string;
  /** Optional structured data (e.g. test counts, gate counts). */
  data?: Record<string, unknown>;
};

export type SliceCheckResult = {
  /** Absolute project root the command operated on. */
  projectRoot: string;
  /** Request id the boundary check applies to; null if no slice is active. */
  rid: string | null;
  /** All stages in execution order. */
  stages: SliceCheckStage[];
  /** True iff every stage passed (or was skipped) and the boundary is OK to hand off. */
  boundaryReady: boolean;
  /** Total wall-clock duration in ms. */
  totalDurationMs: number;
  /** Next steps suggested when boundaryReady is false. */
  nextActions: string[];
};

export type SliceCheckOptions = {
  projectRoot: string;
  /** When omitted, slice check inspects `.peaks/_runtime/current-change` to find the active rid. */
  rid?: string;
  /**
   * When true, re-run the 3-way review fan-out (peaks-rd's code-review +
   * security-review + perf-baseline sub-agents) even if the review files
   * already exist. The default is to verify presence and skip if all 3 are present.
   */
  refreshFanout: boolean;
  /**
   * When true, skip the unit-test stage. Useful when a slice has no unit
   * tests (e.g. a docs-only or config-only slice).
   */
  skipTests: boolean;
  /**
   * When true, an `unit-tests` stage that fails is reported as `skipped`
   * (with a `reason` naming the pre-existing failure count) instead of
   * `failed`. Used to opt in to bypassing the 28 pre-existing Windows
   * test failures documented in dogfood-2-f1-f4.md F17. Does NOT affect
   * the other 3 stages (typecheck / review-fanout / gate-verify-pipeline).
   * Default: false. The service treats `undefined` the same as `false`.
   */
  allowPreExistingFailures?: boolean;
};

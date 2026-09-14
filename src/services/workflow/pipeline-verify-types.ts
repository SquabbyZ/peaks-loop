/**
 * peaks-workflow — public type declarations for pipeline verification.
 *
 * Pure type module. No runtime helpers, no constants. The slimmed
 * `pipeline-verify-service.ts` re-exports the types so existing
 * import paths compile unchanged (rid-006 split).
 *
 * File budget: ≤ 400 lines (rid-006 split).
 */

import type { RequestType } from '../artifacts/artifact-prerequisites.js';

export type PipelineGate = {
  name: string;
  description: string;
  passed: boolean;
  detail: string;
  /**
   * Slice 2026-06-13-peaks-workflow-skip: optional status that
   * distinguishes a gate that was BYPASSED via `peaks workflow skip`
   * from one that actually passed evaluation. When set, the gate
   * was NOT evaluated by `evaluateGate` — the user/CLI explicitly
   * marked it as skipped. The boolean `passed` is set to `true` so
   * existing consumers (which only check `passed`) treat a skipped
   * gate as "satisfied", but downstream consumers that need
   * audit-grade distinction (e.g. CI badges, dashboards) can read
   * `status` to tell pass / fail / skipped apart.
   *
   *   - omitted (default): not set, gate was evaluated; treat as legacy.
   *   - 'pass':          gate evaluated and passed.
   *   - 'fail':          gate evaluated and failed.
   *   - 'skipped':       gate was bypassed; never evaluated.
   */
  status?: 'pass' | 'fail' | 'skipped';
};

export type PipelineVerification = {
  rid: string;
  sessionId: string;
  requestType: RequestType;
  complete: boolean;
  rdPhase: {
    invoked: boolean;
    state: string;
    gates: PipelineGate[];
  };
  qaPhase: {
    invoked: boolean;
    state: string;
    gates: PipelineGate[];
  };
  /**
   * Slice 002 (v2.15.0) AC-3: Gate H "feedback-promotion". Always
   * present (single-element array). Evaluates whether every
   * `metadata.type === 'feedback'` memory in `.peaks/memory/`
   * carries a promotion marker (comment OR sidecar) AND whether the
   * layer that marker claims is actually backed by its artifact
   * (rid 2026-09-14-gate-h-promotion). Failures block the `complete`
   * verdict via the `gateH` field below; the pipeline only completes
   * when every gate in this array passes.
   */
  feedbackPhase?: {
    gates: PipelineGate[];
  };
  violations: string[];
  nextActions: string[];
  /** Form of the security/performance evidence the RD gates accepted
   * (slice 025). `'suffixed'` when the current contract's path served the
   * file, `'legacy'` when a deprecated fallback did, `'none'` when neither
   * gate passed. The per-rid `<rid>.md` suffix the union was named after was
   * retired with `qa/security-findings-<rid>.md` (v2.11.0 D1/D4); the evidence
   * now lives at `audit/security-<rid>.md` / `audit/perf-<rid>.md`
   * (rid-scoped since slice `2026-09-14-audit-artifact-rid-scoping`) with
   * `audit/security.md` / `audit/perf.md` and
   * `rd/security-review.md` / `rd/perf-baseline.md` as the declared legacy
   * fallbacks (rid 2026-09-14-verify-pipeline-contract-drift). */
  acceptedForm?: 'suffixed' | 'legacy' | 'none';
  /** `gateC` is the pre-computed verdict string (AC7 dogfood shape). */
  gateC?: 'pass' | 'fail';
  /**
   * Slice 002 (v2.15.0) AC-3: Gate H verdict string. `'pass'` when
   * all feedback memories are promoted; `'fail'` when at least one
   * unpromoted feedback memory was found.
   */
  gateH?: 'pass' | 'fail';
  /**
   * Slice 2026-06-28-code-mode-bypass-fix (defect #3): `true` when
   * every evidence file resolved on the canonical path
   * (`.peaks/_runtime/change/<sessionId>/...`). `false` when at least
   * one evidence file resolved via a legacy fallback (`.peaks/<sessionId>/...`
   * or `.peaks/_runtime/<sessionId>/...`). QA / TXT surface the value
   * so users know to move misplaced evidence into the canonical
   * location.
   *
   * Slice 2026-06-29-change-id-root-removal: the legacy
   * `peaks workspace migrate-change-scope` migration tool is gone;
   * users must now move misplaced content into the canonical
   * `.peaks/_runtime/change/<sessionId>/<role>/` dir manually (or via
   * `peaks workspace migrate`).
   */
  usedCanonicalPath?: boolean;
};
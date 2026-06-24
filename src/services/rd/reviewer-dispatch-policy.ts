/**
 * Slice 2026-06-24-efficiency-4p-bundle / G4 (P1.3)
 *
 * Programmatic helper for the LLM-side runner to decide whether to
 * dispatch the `karpathy-reviewer` sub-agent in the 5-way review fanout.
 *
 * Background — peaks-rd's "Parallel review fan-out" (SKILL.md §130) is
 * a 5-way fanout triggered at the end of implementation:
 *
 *   1. code-reviewer
 *   2. security-reviewer
 *   3. perf-baseline-reviewer
 *   4. qa-test-cases-writer
 *   5. karpathy-reviewer (the hard Karpathy-Gate)
 *
 * For `config | docs | chore` request types, the slice already skips
 * the entire fanout (SKILL.md line 132 says "Config / docs / chore: no
 * fan-out"). This helper makes the policy **explicit and testable**:
 *
 *   - `shouldDispatchKarpathy(type)` returns `false` for
 *     `config | docs | chore`, `true` for the other types.
 *   - `reviewerListFor(type)` returns the 5-sub-agent list when the
 *     type triggers the fanout, otherwise returns the empty list.
 *   - `reviewerListFor(type)` is the **canonical decision table**
 *     consumed by the LLM-side runner and pinned by
 *     `tests/unit/rd/karpathy-skip-on-config-docs-chore.test.ts`.
 *
 * The 5-way fanout shape itself is unchanged; only the
 * karpathy-reviewer slot is dropped on config/docs/chore. The other
 * 4 reviewers remain dispatched on the types that trigger the fanout
 * (feature / refactor / bugfix).
 */

export const RD_REVIEW_REQUEST_TYPES = [
  'feat',
  'bugfix',
  'refactor',
  'config',
  'docs',
  'chore',
] as const;
export type RdReviewRequestType = (typeof RD_REVIEW_REQUEST_TYPES)[number];

/** The 5-sub-agent fanout triggered at the end of RD implementation. */
export const RD_FANOUT_REVIEWERS = [
  'code-reviewer',
  'security-reviewer',
  'perf-baseline-reviewer',
  'qa-test-cases-writer',
  'karpathy-reviewer',
] as const;
export type RdFanoutReviewer = (typeof RD_FANOUT_REVIEWERS)[number];

/** Subset of request types that fire the 5-way fanout. */
export const RD_FANOUT_REQUEST_TYPES = ['feat', 'bugfix', 'refactor'] as const;
export type RdFanoutRequestType = (typeof RD_FANOUT_REQUEST_TYPES)[number];

/**
 * True iff the karpathy-reviewer sub-agent should be dispatched for
 * this request type. For `config | docs | chore` the entire 5-way
 * fanout is skipped; karpathy is a no-op there.
 */
export function shouldDispatchKarpathy(type: RdReviewRequestType): boolean {
  return isFanoutTriggerType(type);
}

/**
 * True iff the request type triggers the 5-way review fanout.
 */
export function isFanoutTriggerType(
  type: RdReviewRequestType
): type is RdFanoutRequestType {
  return (
    type === 'feat' || type === 'bugfix' || type === 'refactor'
  );
}

/**
 * Returns the ordered list of reviewer roles to dispatch for this
 * request type. Empty list when the type does not trigger the
 * fanout (config/docs/chore) — the karpathy-reviewer (and the rest
 * of the 5-way fanout) is skipped.
 *
 * For `feat` and `refactor`: all 5 reviewers.
 * For `bugfix`: code-reviewer + security-reviewer + qa-test-cases-writer
 *   + karpathy-reviewer (perf-baseline-reviewer only when perf-shaped;
 *   that conditional is owned by the LLM-side runner via Slice 5/6
 *   behavior and is NOT encoded here — this helper enumerates the
 *   default 5; the LLM drops perf-baseline-reviewer when the slice
 *   is not perf-shaped).
 */
export function reviewerListFor(type: RdReviewRequestType): readonly RdFanoutReviewer[] {
  if (!isFanoutTriggerType(type)) {
    return [];
  }
  return RD_FANOUT_REVIEWERS;
}

/**
 * Returns the karpathy-reviewer's slot index in the 5-way fanout
 * (or -1 if it should be skipped for this type). Used by the
 * dispatch record writer so the count of emitted dispatch records
 * matches the policy: 5 for feat/refactor, 4-5 for bugfix
 * (perf-baseline conditional), 0 for config/docs/chore.
 */
export function karpathySlotIndex(type: RdReviewRequestType): number {
  if (!shouldDispatchKarpathy(type)) {
    return -1;
  }
  return RD_FANOUT_REVIEWERS.indexOf('karpathy-reviewer');
}
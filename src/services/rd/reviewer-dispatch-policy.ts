/**
 * Slice 2026-06-24-efficiency-4p-bundle / G4 (P1.3) — karpathy-skip policy
 * Slice v2.12.0 Group B (Tier 4) — collapse 5-way → 3-way fanout.
 *
 * Background — peaks-rd's "Parallel review fan-out" (SKILL.md §130) is
 * a fanout triggered at the end of implementation. The shape changed
 * across releases:
 *
 *   v2.11.x (legacy, 5-way):
 *     1. code-reviewer
 *     2. security-reviewer
 *     3. perf-baseline-reviewer
 *     4. qa-test-cases-writer
 *     5. karpathy-reviewer (the hard Karpathy-Gate)
 *
 *   v2.12.0 (canonical, 3-way):
 *     1. code-reviewer
 *     2. qa-test-cases-writer
 *     3. karpathy-reviewer (the hard Karpathy-Gate)
 *
 * The `security-reviewer` and `perf-baseline-reviewer` slots were
 * moved out of the RD fanout into two new independent skills:
 *   - `peaks-security-audit` (skill id: peaks-security-audit)
 *   - `peaks-perf-audit`     (skill id: peaks-perf-audit)
 * Both are dispatched as pre-RD audit runs that consume the public
 * PRD handoff + the project-scoped audit templates (slice v2.12.0
 * Tier 1+2+3 = Group A).
 *
 * The dispatch policy here is the **canonical decision table** consumed
 * by the LLM-side runner and pinned by tests:
 *   - `tests/unit/rd/karpathy-skip-on-config-docs-chore.test.ts`
 *     (5 → 3 element pinning)
 *   - `tests/unit/rd/deprecated-reviewer-back-compat.test.ts`
 *     (NEW in v2.12.0 — 8 cases; back-compat for the 2 removed slots)
 *
 * For `config | docs | chore` request types, the slice already skips
 * the entire fanout (SKILL.md line 132 says "Config / docs / chore: no
 * fan-out"). This helper makes the policy **explicit and testable**:
 *
 *   - `shouldDispatchKarpathy(type)` returns `false` for
 *     `config | docs | chore`, `true` for the other types.
 *   - `reviewerListFor(type)` returns the 3-sub-agent list when the
 *     type triggers the fanout, otherwise returns the empty list.
 *
 * The 2 removed reviewers (`security-reviewer`, `perf-baseline-reviewer`)
 * are exposed as `RD_DEPRECATED_REVIEWERS` for the 1-minor-release
 * back-compat window. The `isDeprecatedReviewer(name)` predicate lets
 * dispatchers (or legacy on-disk rd/{security-review,perf-baseline}.md
 * readers) detect a removed slot and route to the new audit skill
 * instead of failing the gate. See Tier 5 (`artifact-prerequisites.ts`)
 * for the matching prereq-side back-compat (`mustContainAny` form).
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

/**
 * The 3-sub-agent fanout triggered at the end of RD implementation
 * (v2.12.0). In v2.11.x this was a 5-element list; the
 * `security-reviewer` and `perf-baseline-reviewer` slots moved to
 * the standalone `peaks-security-audit` / `peaks-perf-audit` skills.
 */
export const RD_FANOUT_REVIEWERS = [
  'code-reviewer',
  'qa-test-cases-writer',
  'karpathy-reviewer',
] as const;
export type RdFanoutReviewer = (typeof RD_FANOUT_REVIEWERS)[number];

/**
 * Reviewer roles removed from the v2.11.x 5-way fanout. Exposed as a
 * separate constant so:
 *   (a) back-compat code paths can detect a legacy dispatch record
 *       (e.g. `.peaks/_sub_agents/<sid>/dispatch/security-reviewer.json`)
 *       and route to the new audit skill instead of failing,
 *   (b) the 1-minor-release window (v2.12.0) preserves read access to
 *       `rd/{security-review,perf-baseline}.md` on disk; v2.13.0
 *       hard-deletes them.
 *
 * Use `isDeprecatedReviewer(name)` (not direct array membership) so
 * future deprecations can use the same predicate without churn.
 */
export const RD_DEPRECATED_REVIEWERS = [
  'security-reviewer',
  'perf-baseline-reviewer',
] as const;
export type RdDeprecatedReviewer = (typeof RD_DEPRECATED_REVIEWERS)[number];

/** Subset of request types that fire the 3-way fanout. */
export const RD_FANOUT_REQUEST_TYPES = ['feat', 'bugfix', 'refactor'] as const;
export type RdFanoutRequestType = (typeof RD_FANOUT_REQUEST_TYPES)[number];

/**
 * True iff the karpathy-reviewer sub-agent should be dispatched for
 * this request type. For `config | docs | chore` the entire 3-way
 * fanout is skipped; karpathy is a no-op there.
 */
export function shouldDispatchKarpathy(type: RdReviewRequestType): boolean {
  return isFanoutTriggerType(type);
}

/**
 * True iff the request type triggers the 3-way review fanout.
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
 * of the 3-way fanout) is skipped.
 *
 * For `feat`, `bugfix`, and `refactor`: the 3 reviewers
 *   (code-reviewer, qa-test-cases-writer, karpathy-reviewer).
 *
 * The `security-reviewer` and `perf-baseline-reviewer` slots that
 * used to live here (v2.11.x 5-way) are now independent audit
 * skills — see `peaks-security-audit` / `peaks-perf-audit`. Their
 * outputs land at `audit/security.md` / `audit/perf.md` (see
 * `artifact-prerequisites.ts` `AUDIT_SECURITY` / `AUDIT_PERF`).
 */
export function reviewerListFor(type: RdReviewRequestType): readonly RdFanoutReviewer[] {
  if (!isFanoutTriggerType(type)) {
    return [];
  }
  return RD_FANOUT_REVIEWERS;
}

/**
 * Returns the karpathy-reviewer's slot index in the 3-way fanout
 * (or -1 if it should be skipped for this type). Used by the
 * dispatch record writer so the count of emitted dispatch records
 * matches the policy: 3 for feat/bugfix/refactor, 0 for
 * config/docs/chore.
 */
export function karpathySlotIndex(type: RdReviewRequestType): number {
  if (!shouldDispatchKarpathy(type)) {
    return -1;
  }
  return RD_FANOUT_REVIEWERS.indexOf('karpathy-reviewer');
}

/**
 * True iff `name` is one of the reviewer roles removed in v2.12.0.
 * Used by back-compat readers to detect legacy dispatch records or
 * on-disk artifacts and route to the new audit skill instead of
 * failing the gate. See `RD_DEPRECATED_REVIEWERS` for the canonical
 * list.
 */
export function isDeprecatedReviewer(name: string): name is RdDeprecatedReviewer {
  return (RD_DEPRECATED_REVIEWERS as ReadonlyArray<string>).includes(name);
}
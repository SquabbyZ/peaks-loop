/**
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
 * This module holds the machine-readable decision table for that collapse;
 * the prose the LLM runner actually reads is
 * `skills/bee/peaks-rd/references/parallel-review-fanout.md`. Prose cannot
 * be the runtime answer, so the table also derives the
 * `reviewPlan` field of the `peaks sub-agent dispatch rd` envelope
 * (`src/cli/commands/dispatch-review-plan.ts` -> `reviewPlanFor`). The plan
 * is envelope metadata only: it is never injected into the generated prompt,
 * so the sub-agents' instructions are unchanged.
 *
 * Pinning is complete. The two test files this block used to cite were
 * both deleted in `f17aa377`. The **predicate half**
 * (`RD_DEPRECATED_REVIEWERS` + `isDeprecatedReviewer`) was re-pinned by
 * `tests/unit/rd/reviewer-dispatch-policy.test.ts` (`7191140f`, 6 cases).
 * The **decision-table half** — `RD_FANOUT_REVIEWERS`' 3-element
 * membership, `reviewerListFor`, `karpathySlotIndex`,
 * `shouldDispatchKarpathy` — is pinned by
 * `tests/unit/rd/reviewer-dispatch-policy-decision-table.test.ts`,
 * including the 5→3 relationship: the fanout request types are exactly
 * the review request types `isFanoutTriggerType` accepts, and no
 * deprecated reviewer appears in the returned list.
 *
 * Runtime importers: `src/cli/commands/sub-agent-shared.ts`
 * (`deprecatedReviewerWarnings`) and
 * `src/cli/commands/dispatch-review-plan.ts` (`reviewPlanFor`), both reached
 * from the dispatch chokepoint in `src/cli/commands/dispatch-commands.ts`.
 * The three type aliases derived from the tuple constants stay
 * module-internal: no importer names them, so they are not exported.
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
 * instead of failing the gate. Tier 5 (`artifact-prerequisites.ts`)
 * holds the matching prereq-side back-compat: `AUDIT_SECURITY` /
 * `AUDIT_PERF` accept the legacy `rd/security-review.md` /
 * `rd/perf-baseline.md` artifacts via `legacyRelativePaths`.
 *
 * Both halves are wired as of slice F2 and both ACCEPT the legacy slot.
 * The dispatch side emits the reroute notice as a warning
 * (`deprecatedReviewerWarnings`) rather than a refusal, precisely so it
 * does not disagree with the prereq side about the same deprecation.
 */

/**
 * The request types this table speaks, spelled exactly as the project's
 * canonical `RequestType` (`feature`, never `feat`). The dispatch runtime
 * hands these functions a request artifact's declared type; a second spelling
 * would make `reviewerListFor('feature')` silently return no reviewers.
 */
export const RD_REVIEW_REQUEST_TYPES = [
  'feature',
  'bugfix',
  'refactor',
  'config',
  'docs',
  'chore'
] as const;
type RdReviewRequestType = (typeof RD_REVIEW_REQUEST_TYPES)[number];

/**
 * The 3-sub-agent fanout triggered at the end of RD implementation
 * (v2.12.0). In v2.11.x this was a 5-element list; the
 * `security-reviewer` and `perf-baseline-reviewer` slots moved to
 * the standalone `peaks-security-audit` / `peaks-perf-audit` skills.
 */
export const RD_FANOUT_REVIEWERS = [
  'code-reviewer',
  'qa-test-cases-writer',
  'karpathy-reviewer'
] as const;
type RdFanoutReviewer = (typeof RD_FANOUT_REVIEWERS)[number];

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
export const RD_DEPRECATED_REVIEWERS = ['security-reviewer', 'perf-baseline-reviewer'] as const;
export type RdDeprecatedReviewer = (typeof RD_DEPRECATED_REVIEWERS)[number];

/** Subset of request types that fire the 3-way fanout. */
export const RD_FANOUT_REQUEST_TYPES = ['feature', 'bugfix', 'refactor'] as const;
type RdFanoutRequestType = (typeof RD_FANOUT_REQUEST_TYPES)[number];

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
export function isFanoutTriggerType(type: RdReviewRequestType): type is RdFanoutRequestType {
  return type === 'feature' || type === 'bugfix' || type === 'refactor';
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
 * The machine-readable review plan for one request type — the shape the
 * dispatch envelope publishes as `data.reviewPlan`.
 *
 * `karpathySlotIndex` is `null` when karpathy is skipped (the policy's own
 * `-1` is an internal sentinel), so a consumer reads "no slot" rather than
 * an index that must be special-cased.
 */
export interface ReviewPlan {
  reviewers: string[];
  karpathy: boolean;
  karpathySlotIndex: number | null;
}

/**
 * The single aggregate over the three policy functions. Exported so the
 * dispatch seam calls the decision table once instead of re-deriving the
 * three fields, which would be a second implementation of the same policy.
 */
export function reviewPlanFor(type: RdReviewRequestType): ReviewPlan {
  const karpathy = shouldDispatchKarpathy(type);
  return {
    reviewers: [...reviewerListFor(type)],
    karpathy,
    karpathySlotIndex: karpathy ? karpathySlotIndex(type) : null
  };
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

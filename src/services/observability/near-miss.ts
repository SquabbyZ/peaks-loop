/**
 * `src/services/observability/near-miss.ts`
 *
 * The near-miss rate: of the slices that were declared PASSING, how many
 * passed anyway after a required check was still unsatisfied?
 *
 * WHY THIS EXISTS. The premise of the whole programme is that "the QA verdict
 * says pass" is a metric that is blind: it cannot see a pass that was bought
 * by skipping a check. This module is the number that can see it. The spec
 * (§2.3 S2.3) names it the headline output of the project, and the review
 * focus of Task 5 is the distinction between "gate skipped and never
 * evaluated" and "gate evaluated and passed" — the latter is normal flow, and
 * misreading it as the former would inflate the metric past meaning.
 *
 * THE REFERENCE MOMENT IS THE SUCCESSFUL PASS. The question this metric asks
 * is "at the moment the slice was declared passing, had the required check
 * been satisfied?" — so the reference is the PASS, not the first
 * `verdict-issued` event and not the last attempt at a key. A `verdict-issued`
 * attempt whose prereq check FAILED is not a pass at all; it is a refused
 * transition recorded under the same `to` state. The pass moment is therefore
 * the first `verdict-issued` attempt whose prereq check SUCCEEDED.
 *
 * A slice with no pass moment was never declared passing, so it is in
 * neither the numerator nor the denominator: there is no pass to have been
 * bought by skipping a check.
 *
 * THE LIVE SET IS A UNION OVER THE SLICE'S WHOLE HISTORY. A gate is "live"
 * for a transition when it WOULD have run had the transition not been
 * bypassed — `liveGateIds(phase, judged)` answers that. But the live set of
 * the FINAL transition is not the question: the size ratchet is live only at
 * `implemented`, so a slice bypassed there and later advanced to `qa-handoff`
 * has an EMPTY live set at its final transition, and a reader who looked only
 * there would see nothing wrong. The union over every gate event the slice
 * ever produced is what catches it.
 *
 * A `bypass` event is the PRIMARY evidence of a near-miss but the rule does
 * not DEPEND on it: a live gate with NO event at all is a near-miss too,
 * because a gate that was skipped and recorded nothing must not vanish from
 * the metric. The converse is what keeps the number honest: a live gate that
 * got a `pass` OR a `block` WAS evaluated, and neither is a near-miss.
 *
 * WHY THE DECLARED TYPE IS READ FROM THE EVENT AND NOT FROM THE ARTIFACT.
 * `peaks request retag` rewrites the `- type:` line with no state guard, so
 * the artifact on disk carries the CURRENT type, not the type the transition
 * ran under. The gate event carries the type the transition judged, so the
 * live set is reproduced from the event stream alone.
 *
 * WHY A MISSING DECLARED TYPE FALLS BACK TO THE STREAM. Older gate events
 * (written before the type was carried) exist on this branch without the
 * field. A `claim-table` event at the same phase in the same slice proves
 * the slice was tooling-only at that phase — the claim table only runs for
 * tooling-only slices — and its absence proves it was not. When even that
 * leaves the liveness undetermined (no usable phase), the gate is reported in
 * the `undetermined` list rather than being silently counted or silently
 * dropped: a reader must be able to see that something was not decidable.
 *
 * WHY THE TOOL-BLOCKED BRANCH IS EMPTY. The `tool-trace` category does not
 * exist in the schema yet — the tool-trace stream is a later slice. The
 * branch in `near-miss-facts.ts` is written so that the moment the category
 * lands, the reason starts firing with no change to this file's contract;
 * until then it finds nothing, because there is nothing to find.
 *
 * WHY THE REPORT CARRIES ITS COVERAGE. A rate over a class that had no
 * events to observe is not a rate — it is an absence read as a result, which
 * is the exact failure this programme exists to close. The report therefore
 * says, per class, whether the class was observable at all, and the CLI
 * warns when one was not.
 *
 * WHY THE REPORT CARRIES ITS DENOMINATOR. "Passed" has two definitions here
 * and they do not count the same slices, so the report states the one it
 * uses and reconciles it with the status summary's.
 *
 * WHY THE READERS LIVE NEXT DOOR. `near-miss-facts.ts` holds the event-shape
 * readers this metric is computed from, so this file holds the METRIC and
 * nothing else — the same split `aggregation.ts` and
 * `aggregation-helpers.ts` make in this directory.
 */

import type { ObservabilityEvent } from './observability-service.js';
import {
  sliceFacts,
  type NearMissEvidence,
  type NearMissUndetermined,
  type NearMissReason,
  type SliceFacts
} from './near-miss-facts.js';
import { gateIdOf, liveGatesOf } from './near-miss-gates.js';
import {
  computeCoverage,
  unobservableReasons,
  type NearMissClassCoverage
} from './near-miss-coverage.js';
import { describeDenominator, type NearMissDenominator } from './near-miss-denominator.js';
import type { RdGateId } from '../artifacts/rd-gate-event.js';

export type { NearMissEvidence, NearMissUndetermined, NearMissReason } from './near-miss-facts.js';
export type { NearMissClassCoverage } from './near-miss-coverage.js';
export type { NearMissDenominator } from './near-miss-denominator.js';

/** One slice that passed with a check skipped. */
export type NearMissRecord = {
  readonly sliceRid: string;
  readonly reasons: readonly NearMissReason[];
  /** The transition keys whose check was unsatisfied at the pass moment. */
  readonly unsatisfiedKeys: readonly string[];
  readonly evidence: readonly NearMissEvidence[];
};

/** The near-miss metric over a set of events. */
export type NearMissReport = {
  /** Near-miss slices over passing slices; 0 when there are no passing slices. */
  readonly nearMissRate: number;
  readonly passedSliceCount: number;
  readonly nearMissSliceCount: number;
  readonly records: readonly NearMissRecord[];
  /** Gates whose liveness the stream did not decide. */
  readonly undetermined: readonly NearMissUndetermined[];
  /**
   * What each reason class could and could not be observed for.
   *
   * A class with `observable: false` had NO events of its kind in the scope,
   * so its share of the rate is an absence of data — not a result. A consumer
   * that reads `nearMissRate` alone can still be misled, so this travels in
   * the same envelope.
   */
  readonly coverage: readonly NearMissClassCoverage[];
  /**
   * The reason classes this scope had NO events to observe.
   *
   * The aggregate `nearMissRate` does NOT cover these classes, so a zero
   * over them is an absence of data rather than a result. The per-class
   * `coverage` entry says the same thing with the numbers behind it.
   */
  readonly unobservedClasses: readonly NearMissReason[];
  /**
   * The denominator the rate divides by, and how it relates to the status
   * summary's success count.
   */
  readonly denominator: NearMissDenominator;
};

/**
 * The evidence a near-miss record carries.
 *
 * For a gate that was live and never evaluated, the evidence is the events
 * that let a reader CHECK that claim: the events about that gate (a bypass
 * is the primary one) and the sibling gate events of the same transition,
 * which are what establish the live set. For an unsatisfied prerequisite, it
 * is the refusal itself, named by the transition key it refused.
 */
function evidenceFor(
  neverEvaluated: readonly RdGateId[],
  gateEvents: readonly ObservabilityEvent[],
  unsatisfied: NonNullable<SliceFacts['passMoment']>
): readonly NearMissEvidence[] {
  const pointers: NearMissEvidence[] = [];
  for (const gateId of neverEvaluated) {
    for (const event of gateEvents) {
      const own = gateIdOf(event);
      const live = liveGatesOf(event, gateEvents);
      const witnessed = live !== null && live.includes(gateId);
      if (own !== gateId && !witnessed) continue;
      pointers.push({
        sessionId: event.sessionId,
        ts: event.ts,
        ...(own !== null ? { gateId: own } : {})
      });
    }
  }
  for (const failure of unsatisfied.failures) {
    pointers.push({
      sessionId: failure.sessionId,
      ts: failure.ts,
      transitionKey: failure.key
    });
  }
  return pointers;
}

/**
 * The reasons one passing slice carries.
 *
 * A prerequisite key counts when its check was STILL UNSATISFIED at the pass
 * moment: the slice was declared passing while a required check had not been
 * satisfied. A check that refused and was then satisfied before the pass is
 * a gate working as designed, and it is not a near-miss.
 */
function reasonsFor(fact: SliceFacts): {
  readonly reasons: NearMissReason[];
  readonly neverEvaluated: readonly RdGateId[];
} {
  const neverEvaluated = [...fact.liveGates].filter((gateId) => !fact.evaluatedGates.has(gateId));
  const reasons: NearMissReason[] = [];
  if (neverEvaluated.length > 0) reasons.push('gate-never-evaluated');
  if ((fact.passMoment?.unsatisfiedKeys.length ?? 0) > 0) reasons.push('prereq-skipped');
  if (fact.toolBlocked) reasons.push('tool-blocked');
  return { reasons, neverEvaluated };
}

/**
 * The near-miss metric over a set of events.
 *
 * The rate divides the near-miss slices by the PASSING slices — the slices
 * that recorded a successful verdict attempt — and is 0 when there are none,
 * so an empty scope reads as "no rate" rather than as a division by zero.
 */
export function computeNearMiss(events: readonly ObservabilityEvent[]): NearMissReport {
  const bySlice = new Map<string, ObservabilityEvent[]>();
  for (const event of events) {
    const sliceRid = event.sliceRid;
    if (sliceRid === undefined) continue;
    const bucket = bySlice.get(sliceRid);
    if (bucket === undefined) bySlice.set(sliceRid, [event]);
    else bucket.push(event);
  }

  const records: NearMissRecord[] = [];
  const undetermined: NearMissUndetermined[] = [];
  const passingFacts: SliceFacts[] = [];
  const reasonsBySlice = new Map<string, readonly NearMissReason[]>();
  let passedSliceCount = 0;

  for (const [sliceRid, sliceEvents] of bySlice) {
    const fact = sliceFacts(sliceRid, sliceEvents);
    // A slice with no pass moment was never declared passing.
    if (fact.passMoment === null) continue;
    passedSliceCount += 1;
    passingFacts.push(fact);
    const { reasons, neverEvaluated } = reasonsFor(fact);
    undetermined.push(...fact.undetermined);
    if (reasons.length === 0) continue;
    const gateEvents = sliceEvents.filter((event) => event.category === 'gate');
    reasonsBySlice.set(sliceRid, reasons);
    records.push({
      sliceRid,
      reasons,
      unsatisfiedKeys: fact.passMoment.unsatisfiedKeys,
      evidence: evidenceFor(neverEvaluated, gateEvents, fact.passMoment)
    });
  }

  const nearMissSliceCount = records.length;
  const nearMissRate = passedSliceCount === 0 ? 0 : nearMissSliceCount / passedSliceCount;
  const coverage = computeCoverage({ events, passingFacts, reasonsBySlice });

  return {
    nearMissRate,
    passedSliceCount,
    nearMissSliceCount,
    records,
    undetermined,
    coverage,
    unobservedClasses: unobservableReasons(coverage),
    denominator: describeDenominator(events, passedSliceCount)
  };
}

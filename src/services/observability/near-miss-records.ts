/**
 * `src/services/observability/near-miss-records.ts`
 *
 * The FINDINGS one slice carries: which gates were live and never evaluated,
 * which required checks were still unsatisfied when the slice passed, and the
 * events a reader can check those claims against.
 *
 * WHY THIS IS ITS OWN MODULE. The metric itself reads the stream and counts;
 * the shape of a finding is a different question, and `near-miss.ts` was at
 * its file-size cap with both in it. The evidence pointers in particular are
 * the part a reader USES rather than the part the metric computes, so they
 * travel with the record they belong to.
 */

import { gateIdOf, liveGatesOf } from './near-miss-gate-events.js';
import type { UnreadableVerdict } from './near-miss-attempts.js';
import type { RdGateId } from '../artifacts/rd-gate-event.js';
import type { ObservabilityEvent } from './observability-service.js';
import type {
  NearMissEvidence,
  NearMissReason,
  SliceFacts,
  UnsatisfiedKey
} from './near-miss-facts.js';

/** One slice that passed with a check skipped. */
export type NearMissRecord = {
  readonly sliceRid: string;
  readonly reasons: readonly NearMissReason[];
  /**
   * The moment the slice was declared passing.
   *
   * It travels WITH the record because it is what makes the finding
   * actionable: a reader cannot tell from the key alone whether the check was
   * REFUSING at that moment or had not been ATTEMPTED yet. On this
   * repository's recorded history one of the twelve findings is the first and
   * eleven are the second.
   */
  readonly passMoment: {
    /** The instant of the successful verdict attempt. */
    readonly ts: string;
  };
  /**
   * The transition keys whose check was unsatisfied at the pass moment, each
   * with its state there.
   */
  readonly unsatisfiedKeys: readonly UnsatisfiedKey[];
  readonly evidence: readonly NearMissEvidence[];
};

/**
 * A slice whose PASS verdict this build could not READ.
 *
 * It is neither a pass nor a non-pass: the record says a verdict was issued
 * and the value cannot be read, so whether the slice passed is unknown. It is
 * in neither the numerator nor the denominator, and it is listed rather than
 * dropped — a slice that vanishes from the accounting reads as "no passing
 * slices", which is an absence read as a result.
 */
export type NearMissUnmeasured = {
  readonly sliceRid: string;
  readonly sessionId: string;
  readonly ts: string;
  /** What left the question open. */
  readonly reason: string;
};

/**
 * Why a slice's pass verdict could not be read, in a sentence a reader can
 * act on.
 *
 * The recorded value is NAMED rather than summarised: a reader told only
 * "the verdict was unreadable" has to open the record to learn what it
 * actually said, and `"true"` read as a boolean is exactly the reading this
 * build must not make.
 *
 * `hasPassMoment` says whether a later readable attempt established the pass.
 * When it did, the open question is WHICH attempt was the reference moment;
 * when it did not, the open question is whether the slice passed at all.
 */
export function unmeasuredReason(unreadable: UnreadableVerdict, hasPassMoment: boolean): string {
  const consequence = hasPassMoment
    ? "so which attempt was the slice's pass moment could not be read"
    : 'so whether the slice passed could not be read';
  return (
    `the \`${unreadable.key}\` attempt records \`prereqOk\` as ${unreadable.value}, which is not a ` +
    `boolean, ${consequence}`
  );
}

/**
 * The evidence a near-miss record carries.
 *
 * For a gate that was live and never evaluated, the evidence is the events
 * that let a reader CHECK that claim: the events about that gate (a bypass
 * is the primary one) and the sibling gate events of the same transition,
 * which are what establish the live set. For an unsatisfied prerequisite, it
 * is the refusal itself, named by the transition key it refused.
 */
export function evidenceFor(
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
export function reasonsFor(fact: SliceFacts): {
  readonly reasons: NearMissReason[];
  readonly neverEvaluated: readonly RdGateId[];
} {
  const neverEvaluated = [...fact.liveGates].filter(
    (gateId) => !fact.evaluatedGates.has(gateId) && !fact.unreadableGates.has(gateId)
  );
  const reasons: NearMissReason[] = [];
  if (neverEvaluated.length > 0) reasons.push('gate-never-evaluated');
  if ((fact.passMoment?.unsatisfiedKeys.length ?? 0) > 0) reasons.push('prereq-skipped');
  if (fact.toolBlocked) reasons.push('tool-blocked');
  return { reasons, neverEvaluated };
}

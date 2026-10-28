/**
 * `src/services/observability/near-miss-gates.ts`
 *
 * The GATE facts the near-miss metric is computed from: which gates were
 * live, which of them were evaluated, which of them recorded a verdict this
 * build cannot read, and the liveness of the ones the stream did not decide.
 *
 * WHY THIS IS ITS OWN MODULE. The near-miss metric reads the gate side of
 * the stream and the prerequisite side of the stream, and the two have
 * different vocabularies: a gate is identified by a gate id and a phase, a
 * prerequisite by a transition key. Keeping the readers of one beside the
 * readers of the other is what lets the metric itself stay a metric. The
 * readers of a single gate event live in `near-miss-gate-events.ts`; what
 * lives here is the accumulation of many readings into the facts.
 *
 * WHY THE READERS OF ONE EVENT ARE BESIDE THE READERS OF MANY. The scope of
 * an unreadable verdict depends on what the WHOLE slice's gate events say —
 * an event this build cannot attribute may have been the verdict of a gate
 * that recorded nothing of its own, and of no other. So the decision of what
 * is unreadable cannot be made by one event alone, and the facts it reads
 * have to be accumulated before it is answered.
 */

import { isRdGateOutcome, type RdGateId } from '../artifacts/rd-gate-event.js';
import { gateIdOf, liveGatesOf, outcomeOf } from './near-miss-gate-events.js';
import type { ObservabilityEvent } from './observability-service.js';

/** A gate whose liveness could not be decided from the event stream. */
export type NearMissUndetermined = {
  readonly sliceRid: string;
  readonly sessionId: string;
  readonly ts: string;
  readonly gateId: string;
  /**
   * WHAT could not be decided — the liveness of the gate, or its verdict.
   *
   * The two are different questions, and a count that says only "undetermined"
   * cannot say which one it counted.
   */
  readonly kind: 'liveness' | 'verdict';
  /** What left the question open. */
  readonly reason: string;
};

/**
 * The gate facts one slice's events carry, accumulated as the stream is walked.
 *
 * MUTABLE on purpose: this is the accumulator the reader folds events into,
 * and the metric reads the finished set. The public surface exposes them
 * read-only.
 */
export type GateFacts = {
  /** The gate ids that were live at some transition of this slice. */
  readonly liveGates: Set<RdGateId>;
  /** The gate ids that got a `pass` or a `block` — i.e. WERE evaluated. */
  readonly evaluatedGates: Set<RdGateId>;
  /**
   * The gate ids some event NAMED, whatever verdict that event carried.
   *
   * A gate that has an event of its own carries its own verdict, and the
   * verdict of one gate says nothing about another — that is what keeps an
   * event about a gate this build does not know from masking a gate that
   * was bypassed.
   */
  readonly namedGates: Set<RdGateId>;
  /**
   * The live gates an event naming a gate this build does not know MIGHT
   * have been about.
   *
   * Such an event cannot be attributed to a gate, so it may be the verdict
   * of any gate that was live at its phase and recorded no verdict of its
   * own. The scope is settled by `unreadableGateIds`, once every event of
   * the slice has been read.
   */
  readonly unattributedGates: Set<RdGateId>;
  /**
   * The gate ids whose own VERDICT could not be read.
   *
   * An unreadable verdict is not an absent one: a gate whose own event
   * names an outcome this build does not know was not shown to have been
   * skipped — it was shown to be unreadable. Those gates are excluded from
   * the never-evaluated finding, and reported as undetermined instead.
   */
  readonly unreadableGates: Set<RdGateId>;
  /** The gates whose liveness the stream did not decide. */
  readonly undetermined: NearMissUndetermined[];
};

/**
 * The gates whose verdict this build cannot read.
 *
 * An event that names a KNOWN gate and an outcome this build does not know
 * leaves exactly that gate unreadable. An event that names a gate this build
 * does not know leaves UNATTRIBUTED: it may have been the verdict of any gate
 * that was live at its phase and recorded no verdict of its own — and of no
 * other, because a gate that recorded a verdict of its own carries that
 * verdict, and one gate's verdict says nothing about another's.
 */
export function unreadableGateIds(facts: GateFacts): ReadonlySet<RdGateId> {
  const unreadable = new Set(facts.unreadableGates);
  for (const gate of facts.unattributedGates) {
    if (!facts.namedGates.has(gate)) unreadable.add(gate);
  }
  return unreadable;
}

/** The gate id an event names, spelled out even when this build knows none. */
function rawGateIdOf(event: ObservabilityEvent): string {
  const detail = event.detail as { gateId?: unknown };
  return typeof detail.gateId === 'string' ? detail.gateId : '';
}

/**
 * Fold one gate event into the gate facts.
 *
 * A VERDICT THIS BUILD CANNOT READ IS NOT A FINDING. The event schema keeps
 * `detail` loose, so an event can carry an outcome this build does not know
 * (`'PASS'`) or name a gate id this build does not know. Neither is a gate
 * that was skipped: both are events whose verdict cannot be read. Reading them
 * as "never evaluated" would report a slice that evaluated every gate as one
 * that skipped one — a false near-miss at a rate of 100%.
 */
export function readGate(
  facts: GateFacts,
  event: ObservabilityEvent,
  sliceRid: string,
  gateEvents: readonly ObservabilityEvent[]
): void {
  const gateId = gateIdOf(event);
  const outcome = outcomeOf(event);
  const outcomeKnown = isRdGateOutcome(outcome);
  if (gateId !== null) {
    // The event NAMES this gate, so this gate's verdict is carried here.
    facts.namedGates.add(gateId);
    if (outcomeKnown && (outcome === 'pass' || outcome === 'block')) {
      facts.evaluatedGates.add(gateId);
    }
  }
  const live = liveGatesOf(event, gateEvents);
  if (live === null) {
    if (gateId !== null) {
      facts.undetermined.push({
        sliceRid,
        sessionId: event.sessionId,
        ts: event.ts,
        gateId,
        kind: 'liveness',
        reason: 'the gate event carries no usable phase, so the live set cannot be reproduced'
      });
    }
    return;
  }
  for (const gate of live) facts.liveGates.add(gate);
  readVerdict({ facts, event, sliceRid, gateId, outcomeKnown, live });
}

/** The verdict an event carries, and what this build could make of it. */
type VerdictReading = {
  readonly facts: GateFacts;
  readonly event: ObservabilityEvent;
  readonly sliceRid: string;
  readonly gateId: RdGateId | null;
  readonly outcomeKnown: boolean;
  readonly live: readonly RdGateId[];
};

/**
 * Read the VERDICT an event carries, when it carries one this build can read.
 *
 * A verdict that CAN be read is already accounted for: a `pass` or a `block`
 * was counted as evaluated, and a `bypass` is the skip the metric reports.
 * What is left here is the verdict this build could NOT read — an outcome
 * outside the vocabulary, or a gate id outside it. Neither is a gate that was
 * skipped, so the event is reported as undetermined.
 *
 * THE SCOPE OF AN UNREADABLE VERDICT IS THE GATE IT NAMES. An event that
 * names a known gate and an outcome this build does not know leaves exactly
 * that gate unreadable. An event that names a gate this build does not know
 * leaves UNATTRIBUTED: it may have been the verdict of any gate that was live
 * at its phase and recorded no verdict of its own — and of no other, because
 * a gate that recorded a verdict of its own carries that verdict, and one
 * gate's verdict says nothing about another's.
 */
function readVerdict(reading: VerdictReading): void {
  const { facts, event, sliceRid, gateId, outcomeKnown, live } = reading;
  if (gateId !== null && outcomeKnown) return;
  if (gateId === null) {
    for (const gate of live) facts.unattributedGates.add(gate);
    facts.undetermined.push({
      sliceRid,
      sessionId: event.sessionId,
      ts: event.ts,
      gateId: rawGateIdOf(event),
      kind: 'verdict',
      reason:
        'the gate event names a gate id this build does not know, so its verdict could not be ' +
        'attributed to a gate'
    });
    return;
  }
  facts.unreadableGates.add(gateId);
  facts.undetermined.push({
    sliceRid,
    sessionId: event.sessionId,
    ts: event.ts,
    gateId,
    kind: 'verdict',
    reason:
      'the gate event carries an outcome this build does not know, so the gate verdict could ' +
      'not be read'
  });
}

export { gateIdOf, liveGatesOf, phaseOf } from './near-miss-gate-events.js';
export { CLAIM_TABLE_GATE, KNOWN_GATE_IDS } from './near-miss-gate-events.js';
export { declaredTypeOf, outcomeOf, toolingOnlyAtPhase } from './near-miss-gate-events.js';

/**
 * `src/services/observability/near-miss-gates.ts`
 *
 * The GATE readers the near-miss metric is computed from: which gates a
 * transition would have run, which of them the stream says were evaluated,
 * and the liveness of the ones the stream did not decide.
 *
 * WHY THIS IS ITS OWN MODULE. The near-miss metric reads the gate side of
 * the stream and the prerequisite side of the stream, and the two have
 * different vocabularies: a gate is identified by a gate id and a phase, a
 * prerequisite by a transition key. Keeping the readers of one beside the
 * readers of the other is what lets the metric itself stay a metric.
 *
 * WHY THE LIVE SET IS REPRODUCED FROM THE EVENT AND NOT FROM THE ARTIFACT.
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
 * leaves the liveness undetermined (no usable phase), the gate is reported
 * rather than guessed at.
 */

import { isRequestType, type RequestType } from '../artifacts/artifact-prerequisites.js';
import {
  isRdGateOutcome,
  liveGateIds,
  RD_GATE_IDS,
  type RdGateId
} from '../artifacts/rd-gate-event.js';
import type { RdGatePhase } from '../artifacts/rd-transition-gates.js';
import { isToolingOnlyDeclaredType } from '../scan/type-corroboration.js';
import type { ObservabilityEvent } from './observability-service.js';

/** The gate that only a tooling-only slice runs. */
export const CLAIM_TABLE_GATE: RdGateId = 'claim-table';

/**
 * The gate ids this metric knows how to judge.
 *
 * READ FROM THE CANONICAL LIST, not re-typed here: a second copy of the
 * vocabulary is a list that rots, and it rots SILENTLY — a gate id added
 * upstream would not be in the copy, so `gateIdOf` would answer null for it
 * and a gate that PASSED would never be counted as evaluated, reading as
 * "never evaluated" — a false near-miss.
 */
export const KNOWN_GATE_IDS: readonly RdGateId[] = RD_GATE_IDS;

/** A gate whose liveness could not be decided from the event stream. */
export type NearMissUndetermined = {
  readonly sliceRid: string;
  readonly sessionId: string;
  readonly ts: string;
  readonly gateId: string;
  /** What left the question open. */
  readonly reason: string;
};

/** The gate id an event's own detail names, or null when it names none we know. */
export function gateIdOf(event: ObservabilityEvent): RdGateId | null {
  const detail = event.detail as { gateId?: unknown };
  const gateId = detail.gateId;
  if (typeof gateId !== 'string') return null;
  return KNOWN_GATE_IDS.find((known) => known === gateId) ?? null;
}

/**
 * The phase a gate event was recorded at, or null when it carries none.
 *
 * TYPED BY THE GATE LAYER'S OWN UNION, not by a second copy of it: the copy
 * would be a list that rots, and it rots silently — a phase added upstream
 * would not be in the copy, so a gate that PASSED at that phase would be read
 * as carrying no usable phase, and the slice would be reported as
 * undetermined instead of evaluated.
 */
export function phaseOf(event: ObservabilityEvent): RdGatePhase | null {
  const detail = event.detail as { phase?: unknown };
  const phase = detail.phase;
  if (phase === 'implemented' || phase === 'qa-handoff' || phase === 'handed-off') return phase;
  return null;
}

/** The declared type a gate event carries, or null when it carries none usable. */
export function declaredTypeOf(event: ObservabilityEvent): RequestType | null {
  const detail = event.detail as { declaredType?: unknown };
  const declaredType = detail.declaredType;
  if (typeof declaredType !== 'string' || !isRequestType(declaredType)) return null;
  return declaredType;
}

/** The outcome a gate event carries. */
export function outcomeOf(event: ObservabilityEvent): string {
  const detail = event.detail as { outcome?: unknown };
  return typeof detail.outcome === 'string' ? detail.outcome : '';
}

/**
 * Whether the slice was tooling-only at a phase, judged from the stream.
 *
 * The claim table only runs for tooling-only slices, so a claim-table event
 * at this phase in this slice proves the slice was tooling-only here, and
 * its absence proves it was not. This is the fallback for gate events
 * written before the declared type was carried.
 */
export function toolingOnlyAtPhase(
  phase: RdGatePhase,
  gateEvents: readonly ObservabilityEvent[]
): boolean {
  return gateEvents.some(
    (event) => phaseOf(event) === phase && gateIdOf(event) === CLAIM_TABLE_GATE
  );
}

/**
 * The live gate set of one gate event's transition, or null when it cannot
 * be reproduced.
 *
 * `null` means the liveness is undetermined — the event carries no usable
 * phase — and the caller reports it rather than guessing.
 */
export function liveGatesOf(
  event: ObservabilityEvent,
  gateEvents: readonly ObservabilityEvent[]
): readonly RdGateId[] | null {
  const phase = phaseOf(event);
  if (phase === null) return null;
  const declaredType = declaredTypeOf(event);
  const judged =
    declaredType === null
      ? toolingOnlyAtPhase(phase, gateEvents)
      : isToolingOnlyDeclaredType(declaredType);
  return liveGateIds(phase, judged);
}

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
   * The gate ids whose VERDICT could not be read.
   *
   * An unreadable verdict is not an absent one: a gate whose event names an
   * outcome this build does not know, or names no gate it knows, was not
   * shown to have been skipped — it was shown to be unreadable. Those gates
   * are excluded from the never-evaluated finding, and reported as
   * undetermined instead.
   */
  readonly unreadableGates: Set<RdGateId>;
  /** The gates whose liveness the stream did not decide. */
  readonly undetermined: NearMissUndetermined[];
};

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
  if (gateId !== null && outcomeKnown && (outcome === 'pass' || outcome === 'block')) {
    facts.evaluatedGates.add(gateId);
  }
  const live = liveGatesOf(event, gateEvents);
  if (live === null) {
    if (gateId !== null) {
      facts.undetermined.push({
        sliceRid,
        sessionId: event.sessionId,
        ts: event.ts,
        gateId,
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
 * skipped, so the gates they could have decided are marked unreadable and the
 * event is reported as undetermined.
 */
function readVerdict(reading: VerdictReading): void {
  const { facts, event, sliceRid, gateId, outcomeKnown, live } = reading;
  if (gateId !== null && outcomeKnown) return;
  if (gateId === null) {
    for (const gate of live) facts.unreadableGates.add(gate);
    facts.undetermined.push({
      sliceRid,
      sessionId: event.sessionId,
      ts: event.ts,
      gateId: rawGateIdOf(event),
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
    reason:
      'the gate event carries an outcome this build does not know, so the gate verdict could ' +
      'not be read'
  });
}

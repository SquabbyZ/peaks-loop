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
import { liveGateIds, RD_GATE_IDS, type RdGateId } from '../artifacts/rd-gate-event.js';
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

/** The phase a gate event was recorded at, or null when it carries none. */
export function phaseOf(
  event: ObservabilityEvent
): 'implemented' | 'qa-handoff' | 'handed-off' | null {
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
  phase: 'implemented' | 'qa-handoff' | 'handed-off',
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
  /** The gates whose liveness the stream did not decide. */
  readonly undetermined: NearMissUndetermined[];
};

/** Fold one gate event into the gate facts. */
export function readGate(
  facts: GateFacts,
  event: ObservabilityEvent,
  sliceRid: string,
  gateEvents: readonly ObservabilityEvent[]
): void {
  const gateId = gateIdOf(event);
  if (gateId !== null) {
    const outcome = outcomeOf(event);
    if (outcome === 'pass' || outcome === 'block') facts.evaluatedGates.add(gateId);
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
}

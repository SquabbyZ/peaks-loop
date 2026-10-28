/**
 * `src/services/observability/near-miss-gate-events.ts`
 *
 * The readers of ONE gate event: which gate it names, at which phase, with
 * which outcome, and which gates were live at that phase.
 *
 * WHY THIS IS ITS OWN MODULE. A gate is identified by a gate id and a phase,
 * a prerequisite by a transition key — different vocabularies, so the readers
 * of one sit beside the readers of the other. What lives HERE is the reading
 * of a single event; what lives in `near-miss-gates.ts` is the accumulation
 * of many readings into the facts the metric reads.
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
 * at this phase in this slice proves the slice was tooling-only here, and its
 * absence proves it was not. This is the fallback for gate events written
 * before the declared type was carried.
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

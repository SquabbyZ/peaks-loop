/**
 * `src/services/observability/near-miss-facts.ts`
 *
 * The event-stream readers the near-miss metric is computed from: what one
 * slice's events say about the gates that were live, the gates that were
 * evaluated, and the prerequisites that failed.
 *
 * WHY THIS IS A SEPARATE MODULE. The near-miss metric reads the observability
 * stream the same way the slice aggregation does — the same event shapes, the
 * same terminal-state vocabulary — and those readers are what this module
 * holds, so `near-miss.ts` holds the METRIC and nothing else. The split
 * follows the precedent in this directory: `aggregation.ts` reads the same
 * stream and keeps its readers in `aggregation-helpers.ts` for the same
 * reason.
 *
 * WHY THE READERS ARE CAREFUL ABOUT WHICH EVENT SAYS WHAT. The stream holds
 * two shapes of `slice-transition` event and they mean different things:
 *
 *   - the PREREQ shape (`{artifactRole, to, prereqOk, missingCount}`) is
 *     emitted by the prerequisite check itself, BEFORE the transition is
 *     allowed to proceed. A `prereqOk: false` on it records a REFUSAL: the
 *     gate did its job and the transition did not happen.
 *   - the TRANSITION shape (`{from, to, artifactRole}`) is emitted after the
 *     artifact was written, so it records an ARRIVAL at that state.
 *
 * A reader that treats the prereq shape's `to` as an arrival would count a
 * blocked transition as a slice that got there.
 */

import { isRequestType, type RequestType } from '../artifacts/artifact-prerequisites.js';
import { liveGateIds, type RdGateId } from '../artifacts/rd-gate-event.js';
import { isToolingOnlyDeclaredType } from '../scan/type-corroboration.js';
import type { ObservabilityEvent } from './observability-service.js';

/** The QA verdict state: the slice reached it, so the slice passed. */
export const VERDICT_STATE = 'verdict-issued';

/** The event category a tool trace carries once that slice lands. */
export const TOOL_TRACE_CATEGORY = 'tool-trace';

/** The gate that only a tooling-only slice runs. */
export const CLAIM_TABLE_GATE: RdGateId = 'claim-table';

/** The gate ids this metric knows how to judge. */
export const KNOWN_GATE_IDS: readonly RdGateId[] = [
  'file-size-ratchet',
  'declared-type-corroboration',
  CLAIM_TABLE_GATE
];

/** A pointer at one raw event, so a reader can check a count against it. */
export type NearMissEvidence = {
  readonly sessionId: string;
  readonly ts: string;
  /** The gate this event is about, when it is a gate decision. */
  readonly gateId?: string;
};

/** A gate whose liveness could not be decided from the event stream. */
export type NearMissUndetermined = {
  readonly sliceRid: string;
  readonly sessionId: string;
  readonly ts: string;
  readonly gateId: string;
  /** What left the question open. */
  readonly reason: string;
};

/** A prereq failure, with the stream position it happened at. */
export type PrereqFailure = NearMissEvidence & {
  /** The position of the failure in the slice's event stream. */
  readonly index: number;
};

/** What one slice's events say about it. */
export type SliceFacts = {
  readonly sliceRid: string;
  /** The slice reached the QA verdict state. */
  readonly passed: boolean;
  /**
   * The stream position at which the slice reached the verdict, or null when it
   * never did. A POSITION and not a timestamp: two events can share a
   * millisecond, and the rule asks what came BEFORE the verdict, which a
   * timestamp cannot answer when the clock does not advance.
   */
  readonly verdictIndex: number | null;
  /** The gate ids that were live at some transition of this slice. */
  readonly liveGates: ReadonlySet<RdGateId>;
  /** The gate ids that got a `pass` or a `block` — i.e. WERE evaluated. */
  readonly evaluatedGates: ReadonlySet<RdGateId>;
  /** The prereq failures this slice recorded, in stream order. */
  readonly prereqFailures: readonly PrereqFailure[];
  /** Whether a tool trace blocked on this slice. */
  readonly toolBlocked: boolean;
  /** The gates whose liveness the stream did not decide. */
  readonly undetermined: readonly NearMissUndetermined[];
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

/** The state a transition event moved to. */
export function transitionTarget(event: ObservabilityEvent): string {
  const detail = event.detail as { to?: unknown };
  return typeof detail.to === 'string' ? detail.to : '';
}

/**
 * Whether a transition event records a FAILED prereq check.
 *
 * The prereq event is emitted by the check itself, before the transition is
 * allowed to proceed, so `prereqOk === false` records a REFUSAL — the gate
 * doing its job. What makes it a near-miss is the other half of the rule:
 * the slice reached the verdict anyway.
 */
export function prereqFailed(event: ObservabilityEvent): boolean {
  const detail = event.detail as { prereqOk?: unknown };
  return detail.prereqOk === false;
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

/** The facts one slice's events carry, accumulated as the stream is walked. */
type Accumulator = {
  readonly sliceRid: string;
  readonly liveGates: Set<RdGateId>;
  readonly evaluatedGates: Set<RdGateId>;
  readonly prereqFailures: PrereqFailure[];
  readonly undetermined: NearMissUndetermined[];
  verdictIndex: number | null;
  toolBlocked: boolean;
};

/** Fold one transition event into the accumulator. */
function readTransition(acc: Accumulator, event: ObservabilityEvent, index: number): void {
  const target = transitionTarget(event);
  // A REFUSED attempt at the verdict state is not an arrival there.
  if (target === VERDICT_STATE && !prereqFailed(event) && acc.verdictIndex === null) {
    acc.verdictIndex = index;
  }
  if (prereqFailed(event)) {
    acc.prereqFailures.push({ sessionId: event.sessionId, ts: event.ts, index });
  }
}

/** Fold one tool-trace event into the accumulator. */
function readToolTrace(acc: Accumulator, event: ObservabilityEvent): void {
  // The tool-trace category is not in the schema yet, so this branch finds
  // nothing today. It is written now so that the reason starts firing the
  // moment the category lands. The category is compared as a raw string
  // because the schema's own union does not name it yet, and narrowing the
  // comparison to that union would make this branch uncallable.
  const detail = event.detail as { outcome?: unknown };
  if (detail.outcome === 'block') acc.toolBlocked = true;
}

/** Fold one gate event into the accumulator. */
function readGate(
  acc: Accumulator,
  event: ObservabilityEvent,
  gateEvents: readonly ObservabilityEvent[]
): void {
  const gateId = gateIdOf(event);
  if (gateId !== null) {
    const outcome = outcomeOf(event);
    if (outcome === 'pass' || outcome === 'block') acc.evaluatedGates.add(gateId);
  }
  const live = liveGatesOf(event, gateEvents);
  if (live === null) {
    if (gateId !== null) {
      acc.undetermined.push({
        sliceRid: acc.sliceRid,
        sessionId: event.sessionId,
        ts: event.ts,
        gateId,
        reason: 'the gate event carries no usable phase, so the live set cannot be reproduced'
      });
    }
    return;
  }
  for (const gate of live) acc.liveGates.add(gate);
}

/**
 * The facts one slice's events carry.
 *
 * The live set is the union over the slice's gate events of the gates that
 * were live at each event's transition — the union is the whole point, so
 * this walks every gate event rather than the last one.
 */
export function sliceFacts(sliceRid: string, events: readonly ObservabilityEvent[]): SliceFacts {
  const gateEvents = events.filter((event) => event.category === 'gate');
  const acc: Accumulator = {
    sliceRid,
    liveGates: new Set<RdGateId>(),
    evaluatedGates: new Set<RdGateId>(),
    prereqFailures: [],
    undetermined: [],
    verdictIndex: null,
    toolBlocked: false
  };
  for (const [index, event] of events.entries()) {
    if (event.category === 'slice-transition') readTransition(acc, event, index);
    else if ((event.category as string) === TOOL_TRACE_CATEGORY) readToolTrace(acc, event);
    else if (event.category === 'gate') readGate(acc, event, gateEvents);
  }
  return {
    sliceRid,
    passed: acc.verdictIndex !== null,
    verdictIndex: acc.verdictIndex,
    liveGates: acc.liveGates,
    evaluatedGates: acc.evaluatedGates,
    prereqFailures: acc.prereqFailures,
    toolBlocked: acc.toolBlocked,
    undetermined: acc.undetermined
  };
}

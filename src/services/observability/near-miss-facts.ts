/**
 * `src/services/observability/near-miss-facts.ts`
 *
 * The event-stream readers the near-miss metric is computed from: what one
 * slice's events say about the gates that were live, the gates that were
 * evaluated, what the slice could be OBSERVED for at all, and what its
 * prerequisite attempts recorded.
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
 * blocked transition as a slice that got there. The attempts module reads the
 * prereq shape, and the shape that carries no verdict at all is ignored.
 *
 * WHY THE GATE READERS LIVE NEXT DOOR TOO. A gate is identified by a gate id
 * and a phase, and a prerequisite by a transition key — different
 * vocabularies, so `near-miss-gates.ts` holds the gate side.
 */

import { readGate, type GateFacts, type NearMissUndetermined } from './near-miss-gates.js';
import { collectAttempts, unrecoveredFailures, type PrereqAttempt } from './near-miss-attempts.js';
import type { RdGateId } from '../artifacts/rd-gate-event.js';
import type { ObservabilityEvent } from './observability-service.js';

export { KNOWN_GATE_IDS, type NearMissUndetermined } from './near-miss-gates.js';

/** The QA verdict state: the slice reached it, so the slice passed. */
export const VERDICT_STATE = 'verdict-issued';

/** The event category a tool trace carries once that slice lands. */
export const TOOL_TRACE_CATEGORY = 'tool-trace';

/** Why a slice counts as a near-miss. */
export type NearMissReason = 'gate-never-evaluated' | 'tool-blocked' | 'prereq-skipped';

/** A pointer at one raw event, so a reader can check a count against it. */
export type NearMissEvidence = {
  readonly sessionId: string;
  readonly ts: string;
  /** The gate this event is about, when it is a gate decision. */
  readonly gateId?: string;
  /**
   * The transition key a prereq refusal belongs to, when it is one.
   *
   * The key names WHICH check refused, so a reader can check the pairing: the
   * same key is where a later success would have to appear for the refusal
   * to have been answered.
   */
  readonly transitionKey?: string;
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
  /**
   * The prereq failures this slice recorded that were NEVER satisfied.
   *
   * A failure that a later attempt at the same transition key satisfied is
   * NOT here: that is a gate refusing and then letting the slice through,
   * which is a gate working as designed.
   */
  readonly unrecoveredPrereqFailures: readonly PrereqAttempt[];
  /** Whether a tool trace blocked on this slice. */
  readonly toolBlocked: boolean;
  /** The gates whose liveness the stream did not decide. */
  readonly undetermined: readonly NearMissUndetermined[];
  /**
   * What this slice could be OBSERVED for — the evidence each reason class
   * needs, and whether this slice produced any.
   *
   * A slice that produced no gate event cannot be judged on the gate class at
   * all: the live set is the union over the slice's gate events, so with none
   * the union is empty. The same holds for a slice with no prereq attempt
   * and a slice with no tool trace.
   */
  readonly observed: {
    readonly gateEvents: number;
    readonly prereqAttempts: number;
    readonly toolTraces: number;
  };
};

/** The facts one slice's events carry, accumulated as the stream is walked. */
type Accumulator = {
  readonly sliceRid: string;
  readonly gates: GateFacts;
  verdictIndex: number | null;
  toolBlocked: boolean;
  toolTraces: number;
};

/** Fold one transition event into the accumulator. */
function readTransition(acc: Accumulator, event: ObservabilityEvent, index: number): void {
  const detail = event.detail as { to?: unknown; prereqOk?: unknown };
  const target = typeof detail.to === 'string' ? detail.to : '';
  // A REFUSED attempt at the verdict state is not an arrival there.
  if (target === VERDICT_STATE && acc.verdictIndex === null && detail.prereqOk !== false) {
    acc.verdictIndex = index;
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
  acc.toolTraces += 1;
  if (detail.outcome === 'block') acc.toolBlocked = true;
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
  const attempts = collectAttempts(events);
  const gates: GateFacts = {
    liveGates: new Set<RdGateId>(),
    evaluatedGates: new Set<RdGateId>(),
    undetermined: []
  };
  const acc: Accumulator = {
    sliceRid,
    gates,
    verdictIndex: null,
    toolBlocked: false,
    toolTraces: 0
  };
  for (const [index, event] of events.entries()) {
    if (event.category === 'slice-transition') readTransition(acc, event, index);
    else if ((event.category as string) === TOOL_TRACE_CATEGORY) readToolTrace(acc, event);
    else if (event.category === 'gate') readGate(gates, event, sliceRid, gateEvents);
  }
  return {
    sliceRid,
    passed: acc.verdictIndex !== null,
    verdictIndex: acc.verdictIndex,
    liveGates: gates.liveGates,
    evaluatedGates: gates.evaluatedGates,
    unrecoveredPrereqFailures: unrecoveredFailures(attempts, acc.verdictIndex),
    toolBlocked: acc.toolBlocked,
    undetermined: gates.undetermined,
    observed: {
      gateEvents: gateEvents.length,
      prereqAttempts: attempts.length,
      toolTraces: acc.toolTraces
    }
  };
}

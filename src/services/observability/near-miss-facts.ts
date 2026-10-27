/**
 * `src/services/observability/near-miss-facts.ts`
 *
 * The event-stream readers the near-miss metric is computed from: what one
 * slice's events say about the gates that were live, the gates that were
 * evaluated, when the slice was declared PASSING, what its prerequisite
 * attempts recorded, and what the slice could be OBSERVED for at all.
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
import {
  collectAttempts,
  failuresOf,
  passMomentOf,
  unsatisfiedKeys,
  type PrereqAttempt
} from './near-miss-attempts.js';
import type { RdGateId } from '../artifacts/rd-gate-event.js';
import type { ObservabilityEvent } from './observability-service.js';

export { KNOWN_GATE_IDS, type NearMissUndetermined } from './near-miss-gates.js';

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

/**
 * The moment the slice was declared passing, and what was still unsatisfied
 * at that moment.
 */
export type PassMoment = {
  /** The position of the successful verdict attempt in the slice's stream. */
  readonly index: number;
  /** The instant of the successful verdict attempt. */
  readonly ts: string;
  /**
   * The transition keys whose check was still unsatisfied when the slice was
   * declared passing.
   */
  readonly unsatisfiedKeys: readonly string[];
  /** The failed attempts of those keys — the evidence for the finding. */
  readonly failures: readonly PrereqAttempt[];
};

/** What one slice's events say about it. */
export type SliceFacts = {
  readonly sliceRid: string;
  /**
   * The moment the slice was declared PASSING, or null when it never was.
   *
   * A slice with no pass moment is not in the metric's denominator: it was
   * never declared passing, so there is no pass to have been bought by
   * skipping a check.
   */
  readonly passMoment: PassMoment | null;
  /** The gate ids that were live at some transition of this slice. */
  readonly liveGates: ReadonlySet<RdGateId>;
  /** The gate ids that got a `pass` or a `block` — i.e. WERE evaluated. */
  readonly evaluatedGates: ReadonlySet<RdGateId>;
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
  readonly gates: GateFacts;
  toolBlocked: boolean;
  toolTraces: number;
};

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
  const acc: Accumulator = { gates, toolBlocked: false, toolTraces: 0 };
  for (const event of events) {
    if ((event.category as string) === TOOL_TRACE_CATEGORY) readToolTrace(acc, event);
    else if (event.category === 'gate') readGate(gates, event, sliceRid, gateEvents);
  }
  const moment = passMomentOf(attempts);
  const unsatisfied = moment === null ? [] : unsatisfiedKeys(attempts, moment.index);
  const failures = unsatisfied.flatMap((key) => failuresOf(attempts, key));
  return {
    sliceRid,
    passMoment:
      moment === null
        ? null
        : { index: moment.index, ts: moment.ts, unsatisfiedKeys: unsatisfied, failures },
    liveGates: gates.liveGates,
    evaluatedGates: gates.evaluatedGates,
    toolBlocked: acc.toolBlocked,
    undetermined: gates.undetermined,
    observed: {
      gateEvents: gateEvents.length,
      prereqAttempts: attempts.length,
      toolTraces: acc.toolTraces
    }
  };
}

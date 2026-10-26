/**
 * The gate layer's event vocabulary: the stable ids the RD transition gates
 * are known by, and the ONE function that writes a gate decision into the
 * observability stream.
 *
 * WHY THE IDS ARE STABLE STRINGS. A gate decision is only useful if a reader
 * can ask "which gate blocked?" — across sessions, and across versions of
 * this repository. A reader that has to recognise the CODE that produced the
 * event cannot ask that question at all, which is how the gate layer stayed
 * invisible until now.
 *
 * WHY THE EMITTER LIVES HERE AND NOT IN THE OBSERVABILITY SERVICE. The service
 * module is at its file-size cap, and this file owns the gate vocabulary: the
 * ids, the outcomes, and the prose the bypass note uses for them. The service
 * keeps the schema-and-write half it has always owned.
 *
 * THE RECORDER IS CURRIED. One transition has ONE identity — the project, the
 * session, the slice and the phase — and every decision it makes shares it.
 * The recorder binds that identity once, so a decision costs one line at the
 * call site and cannot forget which slice it belongs to.
 *
 * FIRE-AND-FORGET BY CONTRACT. The gate's verdict must not change because an
 * event could not be written, so nothing here throws.
 */
import { emitObservabilityEvent } from '../observability/observability-service.js';
import { OBSERVABILITY_SCHEMA_VERSION } from '../observability/observability-schema.js';
import type { RdGatePhase, RdGateViolationKind } from './rd-transition-gates.js';

/** The gates the RD transition layer decides, by their stable ids. */
export type RdGateId = 'file-size-ratchet' | 'declared-type-corroboration' | 'claim-table';

/** What the gate decided about the transition. */
export type RdGateOutcome = 'pass' | 'block' | 'bypass';

/** The prose each gate id carries in the bypass note. */
const GATE_LABELS: Record<RdGateId, string> = {
  'file-size-ratchet': 'file-size ratchet',
  'declared-type-corroboration': 'declared-type corroboration',
  'claim-table': 'claim table'
};

/**
 * The gates a bypassed transition skips, per phase. The size ratchet only
 * runs at `implemented`, so the two later phases skip one gate, not two.
 *
 * The bypass NOTE and this list are two readings of ONE table: the note's
 * prose is built from these ids, so the text that names the skipped gates
 * cannot drift from the events that name them.
 */
const BYPASSED_GATE_IDS: Record<RdGatePhase, readonly RdGateId[]> = {
  implemented: ['file-size-ratchet', 'declared-type-corroboration'],
  'qa-handoff': ['declared-type-corroboration'],
  'handed-off': ['declared-type-corroboration']
};

/** The ids of the gates a bypassed transition skips, in the note's order. */
export function bypassedGateIds(phase: RdGatePhase): readonly RdGateId[] {
  return BYPASSED_GATE_IDS[phase];
}

/** The prose the bypass note uses for one gate id. */
export function gateLabel(gateId: RdGateId): string {
  return GATE_LABELS[gateId];
}

/** The transition a gate decision belongs to. */
export type RdGateContext = {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly sliceRid: string;
  readonly phase: RdGatePhase;
};

/** The decision half of a gate event: what the gate decided, and why. */
export type RdGateDecision = {
  readonly violationKind?: RdGateViolationKind | undefined;
  readonly reason?: string | undefined;
};

/** The recorder for ONE transition: it fills in the transition's identity. */
export type RdGateRecorder = (
  gateId: RdGateId,
  outcome: RdGateOutcome,
  decision?: RdGateDecision
) => void;

/** Bind the transition's identity, once. */
export function rdGateRecorder(context: RdGateContext): RdGateRecorder {
  return (gateId, outcome, decision) => {
    emitRdGateEvent({
      ...context,
      gateId,
      outcome,
      violationKind: decision?.violationKind,
      reason: decision?.reason
    });
  };
}

/**
 * Record ONE gate decision in the session's observability stream.
 *
 * The optional fields carry `| undefined` on purpose: this repository
 * compiles with `exactOptionalPropertyTypes`, so a caller that forwards a
 * possibly-absent value could not pass it to a plain optional property.
 */
export function emitRdGateEvent(opts: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly sliceRid: string;
  readonly gateId: RdGateId;
  readonly phase: RdGatePhase;
  readonly outcome: RdGateOutcome;
  readonly violationKind?: RdGateViolationKind | undefined;
  readonly reason?: string | undefined;
}): void {
  const detail: Record<string, unknown> = {
    gateId: opts.gateId,
    phase: opts.phase,
    outcome: opts.outcome
  };
  if (opts.violationKind !== undefined) detail['violationKind'] = opts.violationKind;
  if (opts.reason !== undefined) detail['reason'] = opts.reason;
  try {
    emitObservabilityEvent(
      {
        schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
        ts: new Date().toISOString(),
        sessionId: opts.sessionId,
        category: 'gate',
        sliceRid: opts.sliceRid,
        detail
      },
      { projectRoot: opts.projectRoot }
    );
  } catch (error) {
    // Fire-and-forget: the gate's verdict must not change because the event
    // could not be written. `error` is held so the block is not an empty
    // catch — swallowing it IS the contract, not an oversight.
    void error;
  }
}

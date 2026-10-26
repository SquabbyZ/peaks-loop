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
 * The gates the bypass NOTE names, per phase. This is NOT the live set: the
 * note names the gates a reader is TOLD about, while `liveGateIds` is the set
 * of checks that were actually APPLICABLE — a gate that was live and skipped
 * has to be recorded even when the note does not name it.
 *
 * The note and this list are two readings of ONE table: the note's prose is
 * built from these ids, so the text that names the skipped gates cannot drift
 * from the prose the artifact carries.
 */
const NOTED_GATE_IDS: Record<RdGatePhase, readonly RdGateId[]> = {
  implemented: ['file-size-ratchet', 'declared-type-corroboration'],
  'qa-handoff': ['declared-type-corroboration'],
  'handed-off': ['declared-type-corroboration']
};

/** The ids of the gates the bypass note names, in the note's order. */
export function notedGateIds(phase: RdGatePhase): readonly RdGateId[] {
  return NOTED_GATE_IDS[phase];
}

/**
 * The gates that are LIVE for a transition: the checks that WOULD run if the
 * transition were not bypassed.
 *
 * A live gate that produced no verdict was SKIPPED; a gate that is not live
 * was never applicable to that transition. The two must be tellable apart, or
 * a skipped gate is indistinguishable from a gate that does not exist for the
 * slice — the invisible state this stream exists to remove.
 *
 * DERIVED FROM THE SOURCE, not from the note. `runRdTransitionGates` runs the
 * size ratchet at `implemented` and, for a declared type that is NOT
 * tooling-only, runs NOTHING else — the type rule is a no-op there and the
 * claim table is never read. For a tooling-only declared type the type rule
 * and the claim table run at every phase, and the size ratchet joins them at
 * `implemented`.
 */
const LIVE_GATE_IDS: Record<RdGatePhase, Record<'tooling' | 'product', readonly RdGateId[]>> = {
  implemented: {
    tooling: ['file-size-ratchet', 'declared-type-corroboration', 'claim-table'],
    product: ['file-size-ratchet']
  },
  'qa-handoff': {
    tooling: ['declared-type-corroboration', 'claim-table'],
    product: []
  },
  'handed-off': {
    tooling: ['declared-type-corroboration', 'claim-table'],
    product: []
  }
};

/**
 * The gates that are live for a transition, by its phase and by whether the
 * declared type is tooling-only.
 */
export function liveGateIds(phase: RdGatePhase, judged: boolean): readonly RdGateId[] {
  return LIVE_GATE_IDS[phase][judged ? 'tooling' : 'product'];
}

/** The prose the bypass note uses for one gate id. */
export function gateLabel(gateId: RdGateId): string {
  return GATE_LABELS[gateId];
}

/**
 * What each gate was NOT able to check, when the transition was bypassed.
 */
const BYPASS_DETAIL: Record<RdGateId, string> = {
  'file-size-ratchet': ', so no file was measured against the cap',
  'declared-type-corroboration': ', so the declared type was never judged against the change set',
  'claim-table': ', so no rid claim was checked against the working tree'
};

/**
 * Why ONE gate did not run, when the transition was bypassed.
 *
 * PER GATE, not the shared note: the note the artifact carries names the
 * skipped gates in prose, and it does not name every gate that stood down —
 * so it cannot be the reason for all of them. The note stays the prose; this
 * is the machine-facing explanation.
 */
export function bypassReason(gateId: RdGateId, phase: RdGatePhase): string {
  return (
    `the ${gateLabel(gateId)} was not evaluated: --allow-incomplete bypassed the rd ` +
    `${phase} gates${BYPASS_DETAIL[gateId]}`
  );
}

/**
 * Why the claim table could not be evaluated. The causes are DIFFERENT facts
 * — no artifact at all, or a table some rid never filled in — and a consumer
 * has to be able to tell them apart. (The third cause, a diff that could not
 * be obtained, is a `block` with its own `violationKind`.)
 */
export function claimTableReason(artifactCount: number, missingCount: number): string {
  if (artifactCount === 0) {
    return (
      'the claim table could not be evaluated: the session has no RD artifact, so no rid ' +
      'declares the paths it touched and an unclaimed source change cannot be ruled out'
    );
  }
  return (
    `the claim table could not be evaluated: ${missingCount} of ${artifactCount} RD artifacts ` +
    'declare no "## Changed paths" section, and an incomplete table cannot prove that no ' +
    'source change is unclaimed'
  );
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

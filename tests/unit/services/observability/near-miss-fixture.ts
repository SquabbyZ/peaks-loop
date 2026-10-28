// tests/unit/services/observability/near-miss-fixture.ts
//
// The shared fixture for the near-miss tests: a session's metrics file
// written to a REAL temp tree and read back through the repository's own
// reader, so the shapes under test are the shapes on disk.
//
// WHY A SEPARATE FIXTURE MODULE. The near-miss suite covers two subjects —
// the rule itself and the coverage the report carries — and the two live in
// two test files. Duplicating the fixture would put the same dozen lines in
// both, and a copy that drifts is a copy that lies.
//
// WHAT THE EVENTS LOOK LIKE. The stream holds two `slice-transition` shapes:
// the PREREQ shape, which carries the verdict (`prereqOk`), and the
// TRANSITION shape, which carries the arrival (`from`) and no verdict. One
// attempt produces BOTH. The fixture makes the distinction explicit so a
// test that means "the check refused" says so.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readObservabilityEvents,
  type ObservabilityEvent
} from '~/src/services/observability/observability-service.js';

export const SESSION_ID = '2026-10-27-session-nearmiss';

/** One slice-transition event, in the shape the emitter writes. */
export type Transition = {
  readonly to: string;
  readonly prereqOk?: boolean;
  readonly missingCount?: number;
};

/** One gate decision, in the shape the gate emitter writes. */
export type GateEvent = {
  readonly gateId: string;
  readonly phase: 'implemented' | 'qa-handoff' | 'handed-off';
  readonly outcome: 'pass' | 'block' | 'bypass';
  readonly declaredType?: string;
};

/** The temp roots this fixture created, so the caller can clean them up. */
const roots: string[] = [];

/** Remove every temp tree the fixture created. */
export function cleanupRoots(): void {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Write a session's metrics file with the given events, then read them back
 * through the real reader — so the shapes under test are the shapes on disk.
 */
export function seedSession(
  events: ReadonlyArray<Record<string, unknown>>
): readonly ObservabilityEvent[] {
  const root = mkdtempSync(join(tmpdir(), 'peaks-near-miss-'));
  roots.push(root);
  const dir = join(root, '.peaks', '_runtime', SESSION_ID, 'metrics');
  mkdirSync(dir, { recursive: true });
  const lines = events.map((event, index) =>
    JSON.stringify({
      schemaVersion: 1,
      ts: new Date(Date.UTC(2026, 9, 27, 0, 0, index)).toISOString(),
      sessionId: SESSION_ID,
      ...event
    })
  );
  writeFileSync(join(dir, 'slices.jsonl'), `${lines.join('\n')}\n`, 'utf8');
  return readObservabilityEvents(root, SESSION_ID);
}

/**
 * A transition event, in the shape the emitter writes.
 *
 * `prereqOk` is the VERDICT event — the one the prereq check emits. The
 * arrival event carries `from` instead and no verdict, and `transition()` is
 * used for both by leaving `prereqOk` undefined.
 */
export function transition(
  to: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    category: 'slice-transition',
    sliceRid: 'slice-1',
    detail: { artifactRole: 'rd', to, ...extra }
  };
}

/** A gate decision event, in the shape the gate emitter writes. */
export function gate(event: GateEvent): Record<string, unknown> {
  return {
    category: 'gate',
    sliceRid: 'slice-1',
    detail: {
      phase: event.phase,
      outcome: event.outcome,
      gateId: event.gateId,
      declaredType: event.declaredType ?? 'feature'
    }
  };
}

/**
 * A gate decision event that carries NO PHASE.
 *
 * The phase is what says which transition's live gate set to reproduce, so a
 * gate event without one cannot have its liveness decided. The brief requires
 * such a gate to be REPORTED rather than silently counted or silently
 * dropped, and this is the fixture for that case.
 */
export function phaseLessGate(gateId: string): Record<string, unknown> {
  return {
    category: 'gate',
    sliceRid: 'slice-1',
    detail: { outcome: 'pass', gateId }
  };
}

/**
 * A gate decision event that carries NO DECLARED TYPE.
 *
 * Older gate events were written before the type was carried, so the liveness
 * has to fall back to the claim-table inference. The brief requires that the
 * computation must NOT CRASH on such an event, and this is the fixture for
 * that case.
 */
export function typelessGate(gateId: string, phase: GateEvent['phase']): Record<string, unknown> {
  return {
    category: 'gate',
    sliceRid: 'slice-1',
    detail: { phase, outcome: 'pass', gateId }
  };
}

/**
 * A gate decision event carrying an outcome this build does not know.
 *
 * The event schema keeps `detail` loose, so an event CAN carry an outcome
 * outside the vocabulary — `'PASS'` where the vocabulary says `'pass'`. A
 * verdict this build cannot read is not an absent verdict, and the metric
 * must not report the slice as one that skipped a gate.
 */
export function unknownOutcomeGate(
  gateId: string,
  phase: GateEvent['phase']
): Record<string, unknown> {
  return {
    category: 'gate',
    sliceRid: 'slice-1',
    detail: { phase, outcome: 'PASS', gateId, declaredType: 'feature' }
  };
}

/**
 * A gate decision event naming a gate id this build does not know.
 *
 * A gate added upstream would arrive under an id this build's vocabulary does
 * not carry. Its verdict cannot be attributed to a gate, so it must not be
 * read as a gate that was skipped.
 */
export function unknownGateIdGate(phase: GateEvent['phase']): Record<string, unknown> {
  return {
    category: 'gate',
    sliceRid: 'slice-1',
    detail: { phase, outcome: 'pass', gateId: 'gate-added-upstream', declaredType: 'feature' }
  };
}

/**
 * A gate decision event naming a gate id this build does not know, at a
 * TOOLING-ONLY slice's phase.
 *
 * The tooling live set is the whole vocabulary at `implemented`, so an
 * unattributable event there is live alongside every known gate — the shape
 * in which an over-broad mask erases a sibling gate's genuine bypass.
 */
export function unknownGateIdToolingGate(
  phase: GateEvent['phase'] = 'implemented'
): Record<string, unknown> {
  return {
    category: 'gate',
    sliceRid: 'slice-1',
    detail: { phase, outcome: 'pass', gateId: 'gate-added-upstream', declaredType: 'tooling' }
  };
}

/**
 * A gate decision event naming a KNOWN gate, at a tooling-only slice's phase.
 */
export function toolingGate(
  gateId: string,
  outcome: GateEvent['outcome'],
  phase: GateEvent['phase'] = 'implemented'
): Record<string, unknown> {
  return {
    category: 'gate',
    sliceRid: 'slice-1',
    detail: { phase, outcome, gateId, declaredType: 'tooling' }
  };
}

/**
 * A `verdict-issued` attempt whose prereq verdict is NOT a boolean.
 *
 * The event schema keeps `detail` loose, so a record CAN carry
 * `prereqOk: "true"` — a string where the reader expects a boolean. The
 * verdict was RECORDED and cannot be READ, which is a different fact from
 * "no verdict", and the two must not collapse into one another: the second
 * makes the slice vanish from the accounting entirely.
 */
export function malformedVerdictAttempt(): Record<string, unknown> {
  return {
    category: 'slice-transition',
    sliceRid: 'slice-1',
    detail: { artifactRole: 'rd', to: 'verdict-issued', prereqOk: 'true', missingCount: 0 }
  };
}

/**
 * The slice's whole transition history, ending in a SUCCESSFUL verdict.
 *
 * The verdict attempt carries `prereqOk: true` because that attempt is what
 * declared the slice passing. A test that means "the slice never passed"
 * builds its own history instead of using this.
 */
export function reachingVerdict(
  extra: readonly Transition[] = []
): readonly Record<string, unknown>[] {
  return [
    transition('implemented', { prereqOk: true, missingCount: 0 }),
    ...extra.map((t) => transition(t.to, { prereqOk: t.prereqOk, missingCount: t.missingCount })),
    transition('qa-handoff', { prereqOk: true, missingCount: 0 }),
    transition('verdict-issued', { prereqOk: true, missingCount: 0 })
  ];
}

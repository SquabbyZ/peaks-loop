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

/** The slice's whole transition history, ending in a QA verdict. */
export function reachingVerdict(
  extra: readonly Transition[] = []
): readonly Record<string, unknown>[] {
  return [
    transition('implemented'),
    ...extra.map((t) => transition(t.to, { prereqOk: t.prereqOk, missingCount: t.missingCount })),
    transition('qa-handoff'),
    transition('verdict-issued')
  ];
}

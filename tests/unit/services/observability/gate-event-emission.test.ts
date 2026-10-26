// tests/unit/services/observability/gate-event-emission.test.ts
//
// WHY THIS FILE EXISTS. The gate layer decided whether a slice may advance and
// wrote its verdict NOWHERE structured: the only trace was a free-text
// `reason` on a prerequisite event, and only when a prerequisite ALSO failed.
// A gate that blocked, or that was bypassed, left no machine-readable trace —
// and "the gate layer is invisible" is exactly the blindness this event stream
// exists to remove.
//
// WHY THE EVENTS ARE READ BACK FROM DISK. The emit is fire-and-forget, so the
// only honest way to assert what it recorded is to read the session's metrics
// file back and look at the line that was written. A mock would prove that the
// mock was called.
//
// THE ORDERING ARM IS THE POINT. A `block` event has to be written BEFORE the
// gate throws: after the throw it never fires, and "this gate blocked a slice"
// is precisely the fact that would be lost. The arm below catches the throw
// and then finds the block event on disk — were the emit to sit after the
// throw, that event would not be there.
//
// WHY EVERY GATE GETS ITS OWN EVENT. A reader has to be able to ask "which
// gate was never evaluated?" — and one aggregate event per transition cannot
// answer it. The ids here are the stable names the rest of the observability
// work keys on.
//
// Dimensions:
//   - behavior:   the emitter's own contract — what it records, and that it never throws
//   - integration: the gate's decisions reaching the event stream
//   - render:     OMITTED — the event is a machine record, not a rendered surface
//   - a11y:       OMITTED — no human-visible message originates here

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { emitRdGateEvent } from '~/src/services/artifacts/rd-gate-event.js';
import {
  rdGatesBypassNote,
  runRdTransitionGates
} from '~/src/services/artifacts/rd-transition-gates.js';
import {
  emitObservabilityEvent,
  readObservabilityEvents
} from '~/src/services/observability/observability-service.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/observability/gate-event-emission.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the event is a machine record; it renders no surface' },
    { dim: 'a11y', reason: 'no human-visible message originates here' }
  ]
);

const SESSION_ID = '2026-10-26-gate-events';
const RID = 'rid-gate-events-1';
const OTHER_RID = 'rid-gate-events-2';
const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

/** A throwaway project root; the emit writes its metrics under it. */
function projectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-gate-events-'));
  roots.push(root);
  return root;
}

function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'pipe', windowsHide: true });
}

/** A temporary repository with one commit, so `HEAD` resolves. */
function makeRepo(): string {
  const root = projectRoot();
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'fixture');
  git(root, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(root, 'README.md'), '# fixture\n', 'utf8');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

/**
 * An RD artifact for `rid`. `declared: null` means the artifact carries NO
 * `## Changed paths` heading at all — the state that makes the session's claim
 * table INCOMPLETE, and with it the anti-lie fallback unable to run.
 */
function writeArtifact(root: string, rid: string, declared: readonly string[] | null): void {
  const path = join(root, '.peaks', '_runtime', SESSION_ID, 'rd', 'requests', `001-${rid}.md`);
  mkdirSync(dirname(path), { recursive: true });
  const section =
    declared === null
      ? ''
      : ['## Changed paths', '', ...declared.map((p) => `changedPath: ${p}`), ''].join('\n');
  const body = [
    `# RD Request ${rid}`,
    '',
    `- session: ${SESSION_ID}`,
    '- type: docs',
    '',
    section,
    '## Status',
    '',
    '- state: spec-locked',
    ''
  ].join('\n');
  writeFileSync(path, body, 'utf8');
}

/** A changed file in the working tree. */
function put(root: string, relPath: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, 'export const x = 1;\n', 'utf8');
}

/** The gate, run for the slice as a `docs` request. */
function gate(
  root: string,
  options: {
    allowIncomplete?: boolean;
    phase?: 'implemented' | 'qa-handoff' | 'handed-off';
  } = {}
): string | null {
  return runRdTransitionGates({
    projectRoot: root,
    declaredType: 'docs',
    allowIncomplete: options.allowIncomplete ?? false,
    phase: options.phase ?? 'implemented',
    requestId: RID,
    sessionId: SESSION_ID
  });
}

/** The gate events on disk, as `gateId=outcome` strings. */
function gateEvents(root: string): string[] {
  return readObservabilityEvents(root, SESSION_ID)
    .filter((event) => event.category === 'gate')
    .map((event) => `${String(event.detail['gateId'])}=${String(event.detail['outcome'])}`);
}

/** The gate events on disk, with their whole detail. */
function gateDetails(root: string): Array<Record<string, unknown>> {
  return readObservabilityEvents(root, SESSION_ID)
    .filter((event) => event.category === 'gate')
    .map((event) => event.detail);
}

describe('Scenario: behavior — the emitter records one decision and never throws', () => {
  it('when a gate decision is emitted, should record the gate id, the phase and the outcome', () => {
    // given: a throwaway project root and a session id
    // when: a gate decision is emitted for that session
    // then: the event on disk names the gate, the phase and the outcome
    const root = projectRoot();
    emitRdGateEvent({
      projectRoot: root,
      sessionId: SESSION_ID,
      sliceRid: RID,
      gateId: 'file-size-ratchet',
      phase: 'implemented',
      outcome: 'pass'
    });
    const events = readObservabilityEvents(root, SESSION_ID);
    expect(events).toHaveLength(1);
    expect(events[0]?.category).toBe('gate');
    expect(events[0]?.sliceRid).toBe(RID);
    expect(events[0]?.detail).toMatchObject({
      gateId: 'file-size-ratchet',
      phase: 'implemented',
      outcome: 'pass'
    });
  });

  it('when a refusal is emitted, should record the kind of violation that caused it', () => {
    // given: a throwaway project root
    // when: a blocking decision is emitted with the violation kind
    // then: the kind and the reason are on the record, not only the outcome
    const root = projectRoot();
    emitRdGateEvent({
      projectRoot: root,
      sessionId: SESSION_ID,
      sliceRid: RID,
      gateId: 'claim-table',
      phase: 'implemented',
      outcome: 'block',
      violationKind: 'source-unclaimed',
      reason: 'no request artifact claimed src/x.ts'
    });
    const details = gateDetails(root);
    expect(details).toHaveLength(1);
    expect(details[0]?.['violationKind']).toBe('source-unclaimed');
    expect(details[0]?.['reason']).toBe('no request artifact claimed src/x.ts');
  });

  it('when the session id is not a single path segment, should not throw', () => {
    // given: a session id that names a directory OUTSIDE the session axis
    // when: a gate decision is emitted for it
    // then: the emit does not throw, and nothing was written for that id
    const root = projectRoot();
    expect(() =>
      emitRdGateEvent({
        projectRoot: root,
        sessionId: '../../escape',
        sliceRid: RID,
        gateId: 'file-size-ratchet',
        phase: 'implemented',
        outcome: 'pass'
      })
    ).not.toThrow();
    expect(readObservabilityEvents(root, '../../escape')).toEqual([]);
  });

  it('when the write cannot happen, should report the failure instead of throwing', () => {
    // given: an event whose session id cannot be resolved
    // when: it is handed to the observability service
    // then: the failure is a VALUE the caller can read — written is false
    const root = projectRoot();
    const result = emitObservabilityEvent(
      {
        schemaVersion: 1,
        ts: new Date().toISOString(),
        sessionId: '../../escape',
        category: 'gate',
        detail: { gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'pass' }
      },
      { projectRoot: root }
    );
    expect(result.written).toBe(false);
    expect(result.reason).toBe('invalid-session-id');
  });
});

describe('Scenario: integration — the gate layer speaks for itself', () => {
  it('when the declared-type gate refuses a slice, should record the block even though the gate threw', () => {
    // given: a docs rid that declares a product-source path
    // when: the gate runs and refuses
    // then: the refusal happened AND the block is on disk — the event was
    //       written BEFORE the throw, or it would not be there at all
    const root = makeRepo();
    writeArtifact(root, RID, ['src/x.ts']);
    put(root, 'src/x.ts');
    let refused: unknown = null;
    try {
      gate(root);
    } catch (error) {
      refused = error;
    }
    expect(refused).not.toBeNull();
    const details = gateDetails(root);
    expect(details).toContainEqual(
      expect.objectContaining({
        gateId: 'declared-type-corroboration',
        outcome: 'block',
        violationKind: 'source-touched'
      })
    );
  });

  it('when an unclaimed source change is found, should record the block for the claim table', () => {
    // given: two declaring rids, neither of them claiming the source change
    // when: the gate runs and refuses
    // then: the block is on disk, and it names the kind of violation
    const root = makeRepo();
    writeArtifact(root, RID, ['docs/a.md']);
    writeArtifact(root, OTHER_RID, ['docs/b.md']);
    put(root, 'src/x.ts');
    let refused: unknown = null;
    try {
      gate(root);
    } catch (error) {
      refused = error;
    }
    expect(refused).not.toBeNull();
    expect(gateDetails(root)).toContainEqual(
      expect.objectContaining({
        gateId: 'claim-table',
        outcome: 'block',
        violationKind: 'source-unclaimed'
      })
    );
  });

  it('when every gate finds nothing wrong, should record a pass for each gate that ran', () => {
    // given: a docs rid that claims only a markdown file, and a second rid
    //        that claims the src change in the working tree
    // when: the gate runs
    // then: it passes, and every gate that ran says so on the record
    const root = makeRepo();
    writeArtifact(root, RID, ['docs/a.md']);
    writeArtifact(root, OTHER_RID, ['src/x.ts']);
    put(root, 'src/x.ts');
    const note = gate(root);
    expect(note).toBeNull();
    expect(gateEvents(root)).toEqual([
      'claim-table=pass',
      'declared-type-corroboration=pass',
      'file-size-ratchet=pass'
    ]);
  });

  it('when the gates are bypassed, should record a bypass for each skipped gate with the note verbatim', () => {
    // given: a docs rid whose gates are about to be skipped
    // when: the gate runs with --allow-incomplete
    // then: the note is the one the artifact already carries, and each skipped
    //       gate has its own bypass event carrying it
    const root = makeRepo();
    writeArtifact(root, RID, ['docs/a.md']);
    const note = gate(root, { allowIncomplete: true });
    expect(note).toBe(rdGatesBypassNote('implemented'));
    expect(gateEvents(root)).toEqual([
      'file-size-ratchet=bypass',
      'declared-type-corroboration=bypass'
    ]);
    for (const detail of gateDetails(root)) {
      expect(detail['reason']).toBe(note);
    }
  });

  it('when the claim table cannot be completed, should record a bypass for the claim table', () => {
    // given: a second rid whose artifact declares NO paths, so the anti-lie
    //        fallback cannot run — an incomplete table cannot prove that
    //        nobody claimed a path
    // when: the gate runs
    // then: the fallback stood down, and the record says "not evaluated"
    //       instead of "passed"
    const root = makeRepo();
    writeArtifact(root, RID, ['docs/a.md']);
    writeArtifact(root, OTHER_RID, null);
    put(root, 'src/x.ts');
    const note = gate(root);
    expect(note).not.toBeNull();
    expect(gateEvents(root)).toContain('claim-table=bypass');
  });
});

// tests/unit/services/artifacts/request-transition-state-order.test.ts
//
// Guard for S-14, rid `rid-size-gate-reads-ratchet` (session
// `2026-10-12-session-74bd69`).
//
// MEASURED DEFECT. `ALLOWED_STATES_PER_ROLE` is a SEQUENCE, but
// `transitionRequestArtifact` tested only membership. So when `rd → implemented`
// and `rd → qa-handoff` were both refused, `rd → handed-off` still passed: a
// slice could report itself delivered past every intermediate gate. Two
// artifacts in that session (`rd/requests/002-*.md`, `003-*.md`) sit at
// `handed-off` with a note saying the earlier transitions were refused — the
// reproduction, on disk.
//
// THE ARM CHOSEN: enforce the sequence. A FORWARD jump is refused; a move to or
// from `blocked`, a move to the current state, and a BACKWARD move (the QA
// return-to-rd repair re-enters `rd: spec-locked` from `qa-handoff` — see
// `skills/peaks-code/references/micro-cycle.md`) stay legal. `--allow-incomplete`
// bypasses it, which is why the in-order walk in
// `tests/integration/business-capability-e2e.test.ts` and the draft→verdict
// unit case in `request-artifact-state-authority.test.ts` keep passing.
//
// Dimensions covered:
//   - render:      the refusal names the skipped states and the next legal one
//   - behavior:    which moves the rule allows (jump / step / backward / blocked)
//   - integration: a real tmp session tree through `transitionRequestArtifact`

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { transitionRequestArtifact } from '../../../../src/services/artifacts/request-artifact-service.js';
import {
  stateOrderViolation,
  StateOrderViolationError
} from '../../../../src/services/artifacts/request-state-order.js';

declareDimensions(
  'tests/unit/services/artifacts/request-transition-state-order.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason:
        'the rule returns/throws a typed envelope; rendering it to a human is guarded in tests/unit/cli/request-transition-failures.test.ts'
    }
  ]
);

const SESSION_ID = '2026-10-13-session-74bd69';
const RID = '2026-10-13-state-order-fixture';

const ws = withTmpWorkspacePerTest('peaks-state-order-');

/** An rd artifact parked at `state` (or carrying NO state line when `null`),
 *  with no lint-failing placeholder for the walk that runs WITHOUT the bypass. */
function seedRdArtifact(root: string, state: string | null): void {
  const path = join(root, '.peaks', '_runtime', SESSION_ID, 'rd', 'requests', `001-${RID}.md`);
  mkdirSync(dirname(path), { recursive: true });
  const stateLine = state === null ? '' : `- state: ${state}\n`;
  writeFileSync(
    path,
    `# RD Request ${RID}\n\n- session: ${SESSION_ID}\n${stateLine}- type: feature\n`,
    'utf8'
  );
}

function transition(
  root: string,
  newState: string,
  extra: { allowIncomplete?: boolean } = {}
): ReturnType<typeof transitionRequestArtifact> {
  return transitionRequestArtifact({
    role: 'rd',
    requestId: RID,
    projectRoot: root,
    sessionId: SESSION_ID,
    newState: newState as Parameters<typeof transitionRequestArtifact>[0]['newState'],
    confirmed: true,
    ...(extra.allowIncomplete === true ? { allowIncomplete: true } : {})
  });
}

describe('Scenario: render — a forward jump is refused with its skipped states named', () => {
  it('when rd jumps draft → handed-off, should name every skipped state and the next legal one', async () => {
    // given: an rd artifact at draft, and the state machine's declared order
    // when: the forward jump is attempted without the bypass
    // then: it is refused, and the message is actionable rather than a bare rule
    seedRdArtifact(ws().path, 'draft');
    await expect(transition(ws().path, 'handed-off')).rejects.toBeInstanceOf(
      StateOrderViolationError
    );
    const jump = stateOrderViolation('rd', 'draft', 'handed-off');
    expect(jump?.skipped).toEqual(['spec-locked', 'implemented', 'qa-handoff']);
    expect(jump?.next).toBe('spec-locked');
  });
});

describe('Scenario: behavior — which moves the sequence allows', () => {
  it('when the move is one step forward, backward, to the current state, or via blocked, should allow it', () => {
    // given: the rd order draft → spec-locked → implemented → qa-handoff → handed-off
    // when: each legal shape is asked of the rule
    // then: none is refused — the rule is a skip test, not a rising-rank test
    expect(stateOrderViolation('rd', 'draft', 'spec-locked')).toBeNull();
    expect(stateOrderViolation('rd', 'implemented', 'qa-handoff')).toBeNull();
    // the QA return-to-rd repair re-enters spec-locked from qa-handoff
    expect(stateOrderViolation('rd', 'qa-handoff', 'spec-locked')).toBeNull();
    expect(stateOrderViolation('rd', 'implemented', 'implemented')).toBeNull();
    // `blocked` is a side state: reachable from anywhere, leaving anywhere
    expect(stateOrderViolation('rd', 'draft', 'blocked')).toBeNull();
    expect(stateOrderViolation('rd', 'blocked', 'implemented')).toBeNull();
  });

  it('when the move skips exactly one state, should refuse it — the reproduction this rule was written for', () => {
    // given: the reproduction recorded in this module's header — the request sits
    //        at `implemented`, so the two gates before it already passed and the
    //        move jumps straight to the end
    // when: the rule is asked about that single skip
    // then: it is a jump, not a pass. The `draft → handed-off` case does not
    //       reach this boundary: it skips three states, so a rule tolerating a
    //       two-state window would still refuse it, while this one is the exact
    //       shape the recorded defect took.
    expect(stateOrderViolation('rd', 'implemented', 'handed-off')).toEqual({
      kind: 'jump',
      skipped: ['qa-handoff'],
      next: 'qa-handoff'
    });
  });

  it('when the current state cannot be read, should fail CLOSED rather than allow the move', () => {
    // given: `existing.state` is 'unknown' whenever the artifact carries no
    //        `- state:` line, and this gate runs before every other one
    // when: the rule is asked about a move from that unreadable state
    // then: it is a breach, not a pass — otherwise a deleted line is an
    //       off-switch for the whole gate
    expect(stateOrderViolation('rd', 'unknown', 'handed-off')).toEqual({
      kind: 'unreadable',
      skipped: [],
      next: null
    });
  });
});

describe('Scenario: integration — the real transition enforces order and still honours the bypass', () => {
  it('when the states are walked in order with --allow-incomplete, should reach handed-off', async () => {
    // given: a real rd artifact at draft in a real session tree
    seedRdArtifact(ws().path, 'draft');
    // when: every step is taken in order (prereqs bypassed, order is satisfied)
    // then: each lands — the refusal above is a JUMP refusal, not an order-of-walk block
    for (const state of ['spec-locked', 'implemented', 'qa-handoff', 'handed-off']) {
      const result = await transition(ws().path, state, { allowIncomplete: true });
      expect(result?.state).toBe(state);
    }
  });

  it('when the artifact has no state line at all, should refuse the move as unreadable', async () => {
    // given: a real rd artifact whose `- state:` line has been DELETED — the
    //        one-line edit that used to switch this gate off
    seedRdArtifact(ws().path, null);
    // when: the jump is attempted without the bypass
    // then: it is refused, and the refusal says the state could not be read
    await expect(transition(ws().path, 'handed-off')).rejects.toMatchObject({
      code: 'STATE_ORDER_UNREADABLE',
      kind: 'unreadable'
    });
  });

  it('when the jump is attempted with --allow-incomplete, should let the escape hatch through', async () => {
    // given: a real rd artifact at draft
    // when: the jump is requested WITH the documented bypass
    // then: it succeeds — the order gate is what --allow-incomplete bypasses,
    //       exactly as it bypasses the prerequisite and lint gates
    seedRdArtifact(ws().path, 'draft');
    const result = await transition(ws().path, 'handed-off', { allowIncomplete: true });
    expect(result?.state).toBe('handed-off');
  });
});

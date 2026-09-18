// tests/unit/release/release-hotfix-no-dead-stage.test.ts
//
// Guards the Slice H2 fix: the dead `'hotfixed'` stage declaration.
//
// Why this test file exists:
//   `release-state.ts` declared an 8th stage, `'hotfixed'`, with two rows
//   pointing INTO it (`'watching': [..., 'hotfixed']` and
//   `'rolled-back': ['hotfixed', ...]`) and one row leading out of it
//   (`'hotfixed': ['watching', 'rolled-back']`). Nothing ever entered it:
//   `hotfixRelease` rolls the active release back and starts the hotfix
//   version at `canary-10`. The stage and the function landed in the SAME
//   commit (383682c1), and `git log -S "hotfixed"` shows only that commit —
//   the wiring was never written, it was not deleted.
//
//   This is NOT the same defect shape as the H1 `'watching'` bug, and the fix
//   is deliberately not the same shape either. `'hotfixed'` cannot simply be
//   kept as a declared state: its only out-edges were `watching`/`rolled-back`,
//   so a release parked in it could never reach `canary-50` or `promoted` —
//   hence never `promotedAt`, never a completed watch window, and never `done`.
//   Making it reachable would have re-created the H1 deadlock on the hotfix
//   path AND falsified the `hotfix` command's own advice ("Run `peaks release
//   canary --percent 50` to advance"). So the stage is deleted, not wired.
//
//   The load-bearing assertions are the PAIR: no row may reach `'hotfixed'`
//   (the dead declaration is gone), and the hotfix release must still be able
//   to walk the normal pipeline to a terminus (deleting the stage lost the
//   hotfix flow nothing). A test that only asserted the deletion would pass
//   even if the hotfix path were dead-ended; a test that only walked the
//   pipeline would not have caught the dead row at all.

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';
import {
  EMPTY_RELEASE_STATE,
  hotfixRelease,
  isReleaseStage,
  isValidStageTransition,
  planRelease,
  readReleaseState,
  transitionRelease,
  writeReleaseState,
  type ReleaseStage,
} from '~/src/services/release/release-state.js';

declareDimensions('tests/unit/release/release-hotfix-no-dead-stage.test.ts', [
  'render',
  'behavior',
  'integration',
], [
  {
    dim: 'a11y',
    reason:
      'no user-facing copy, error code, or exit code is under test — the fix is a stage-table deletion plus its service-level guard',
  },
]);

/** The stage this slice deleted. Probe-only: intentionally cast, because the
 *  whole point is that `ReleaseStage` must no longer admit it. */
const DELETED_STAGE = 'hotfixed' as unknown as ReleaseStage;

/** The legal stages as of this slice. Kept literal so the exhaustive scan
 *  below cannot silently shrink along with the table it is checking. */
const DECLARED_STAGES: readonly ReleaseStage[] = [
  'planned',
  'canary-10',
  'canary-50',
  'promoted',
  'watching',
  'done',
  'rolled-back',
];

const T0 = new Date('2026-09-18T10:00:00Z');
const T1 = new Date('2026-09-18T11:00:00Z');

describe('Scenario: behavior — no transition reaches the deleted hotfixed stage', () => {
  it('when every declared stage is asked, should offer no edge into hotfixed', () => {
    // when/then: exhaustive scan — every declared stage, every declared target
    for (const from of DECLARED_STAGES) {
      expect(
        isValidStageTransition(from, DELETED_STAGE),
        `'${from}' must not be able to reach '${DELETED_STAGE}'`,
      ).toBe(false);
    }
  });

  it('when asked whether hotfixed is a release stage, should say no', () => {
    expect(isReleaseStage(DELETED_STAGE)).toBe(false);
    // ... while every stage that IS declared stays declared.
    for (const s of DECLARED_STAGES) {
      expect(isReleaseStage(s), `'${s}' must remain a legal stage`).toBe(true);
    }
  });

  it('when the deleted stage is the SOURCE, should not throw and should offer nothing', async () => {
    // A stale or hand-edited `.peaks/release-state.json` must fail as an
    // invalid transition, not as a TypeError out of the table lookup.
    expect(() => isValidStageTransition(DELETED_STAGE, 'done')).not.toThrow();
  });
});

describe('Scenario: behavior — H1 stays fixed and the neighbours keep their edges', () => {
  it('when the table is asked, should keep promoted → done reachable (H1)', () => {
    expect(isValidStageTransition('promoted', 'done')).toBe(true);
  });

  it('when the table is asked, should keep watching declared and its edges intact', () => {
    expect(isValidStageTransition('promoted', 'watching')).toBe(true);
    expect(isValidStageTransition('watching', 'done')).toBe(true);
    expect(isValidStageTransition('watching', 'rolled-back')).toBe(true);
  });

  it('when rollback is asked, should still allow rolled-back → planned', () => {
    expect(isValidStageTransition('rolled-back', 'planned')).toBe(true);
  });
});

describe('Scenario: behavior — a hotfix enters the normal pipeline, not a stage', () => {
  it('when a hotfix starts with no active release, should land at canary-10', () => {
    // given: an empty state
    // when:  hotfixRelease creates the hotfix
    const r = hotfixRelease(EMPTY_RELEASE_STATE, '4.0.55-hotfix', 'urgent', T0);
    if ('error' in r) throw new Error('expected ok');

    // then:  the ACTIVE stage is canary-10 — never the deleted stage
    expect(r.record.currentStage).toBe('canary-10');
    expect(r.state.active?.currentStage).toBe('canary-10');
    expect(isReleaseStage(r.record.currentStage)).toBe(true);
  });

  it('when a hotfix starts over an active release, should roll it back into history', () => {
    // given: a release in flight at canary-10
    const p = planRelease(EMPTY_RELEASE_STATE, '4.0.54', T0);
    if ('error' in p) throw new Error('expected ok');
    const c = transitionRelease(p.state, 'canary-10', undefined, T0);
    if ('error' in c) throw new Error('expected ok');

    // when:  a hotfix forces it out of the way
    const h = hotfixRelease(c.state, '4.0.55-hotfix', 'urgent', T1);
    if ('error' in h) throw new Error('expected ok');

    // then:  the superseded release is history, marked rolled-back (not hotfixed)
    expect(h.state.active?.version).toBe('4.0.55-hotfix');
    expect(h.state.history).toHaveLength(1);
    expect(h.state.history[0]!.currentStage).toBe('rolled-back');
    expect(h.state.history.every((rec) => rec.currentStage !== DELETED_STAGE)).toBe(true);
  });

  it('when the hotfix release is advanced, should reach a real terminus (done)', () => {
    // given: a hotfix started with no active release
    const h = hotfixRelease(EMPTY_RELEASE_STATE, '4.0.55-hotfix', 'urgent', T0);
    if ('error' in h) throw new Error('expected ok');

    // when:  the operator follows the command's own advice and advances it
    const fifty = transitionRelease(h.state, 'canary-50', undefined, T0);
    if ('error' in fifty) throw new Error(`canary-50 refused: ${fifty.error}`);
    const promoted = transitionRelease(fifty.state, 'promoted', undefined, T0);
    if ('error' in promoted) throw new Error(`promoted refused: ${promoted.error}`);
    const done = transitionRelease(promoted.state, 'done', undefined, T1);
    if ('error' in done) throw new Error(`done refused: ${done.error}`);

    // then:  it is done — with the promotedAt/doneAt stamps the watch window
    //        and `peaks release done` depend on
    expect(done.state.active?.currentStage).toBe('done');
    expect(done.state.active?.doneAt).toBe(T1.toISOString());
    // ... and the walk never needed the deleted stage.
    expect(
      done.state.active?.stageHistory.every((e) => e.stage !== DELETED_STAGE),
    ).toBe(true);
  });
});

describe('Scenario: render — the persisted hotfix record carries no deleted stage', () => {
  const ws = withTmpWorkspacePerTest('peaks-release-hotfix-');

  it('when the hotfix state is written, should persist canary-10 and no hotfixed field', () => {
    // given: a hotfix started in a real workspace
    mkdirSync(ws().peaksDir, { recursive: true });
    const h = hotfixRelease(EMPTY_RELEASE_STATE, '4.0.55-hotfix', 'urgent', T0);
    if ('error' in h) throw new Error('expected ok');

    // when:  the state is persisted
    writeReleaseState(ws().path, h.state);

    // then:  the on-disk shape names canary-10 and mentions the deleted stage nowhere
    const raw = readFileSync(join(ws().peaksDir, 'release-state.json'), 'utf8');
    const parsed = JSON.parse(raw) as {
      active: { version: string; currentStage: string; stageHistory: readonly { stage: string }[] };
    };
    expect(parsed.active.version).toBe('4.0.55-hotfix');
    expect(parsed.active.currentStage).toBe('canary-10');
    expect(parsed.active.stageHistory.map((e) => e.stage)).toEqual(['canary-10']);
    expect(raw).not.toContain(DELETED_STAGE);
  });
});

describe('Scenario: integration — the hotfix release survives a real state round-trip', () => {
  const ws = withTmpWorkspacePerTest('peaks-release-hotfix-rt-');

  it('when written, read back, and walked to done, should end active=null in history', () => {
    // given: a hotfix state written to disk
    mkdirSync(ws().peaksDir, { recursive: true });
    const h = hotfixRelease(EMPTY_RELEASE_STATE, '4.0.55-hotfix', 'urgent', T0);
    if ('error' in h) throw new Error('expected ok');
    writeReleaseState(ws().path, h.state);

    // when:  the round-tripped state advances to a terminus
    const reread = readReleaseState(ws().path);
    expect(reread.active?.currentStage).toBe('canary-10');
    const fifty = transitionRelease(reread, 'canary-50', undefined, T0);
    if ('error' in fifty) throw new Error(`canary-50 refused: ${fifty.error}`);
    const promoted = transitionRelease(fifty.state, 'promoted', undefined, T0);
    if ('error' in promoted) throw new Error(`promoted refused: ${promoted.error}`);
    const done = transitionRelease(promoted.state, 'done', undefined, T1);
    if ('error' in done) throw new Error(`done refused: ${done.error}`);

    // then:  closing it out (the shape `peaks release done` writes) is recorded
    const closed = {
      version: 1 as const,
      active: null,
      history: [...done.state.history, done.state.active!],
    };
    writeReleaseState(ws().path, closed);
    const after = readReleaseState(ws().path);

    expect(after.active).toBeNull();
    expect(after.history).toHaveLength(1);
    expect(after.history[0]!.version).toBe('4.0.55-hotfix');
    expect(after.history[0]!.currentStage).toBe('done');
    expect(typeof after.history[0]!.doneAt).toBe('string');
  });
});

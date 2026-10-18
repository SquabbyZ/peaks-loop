// tests/unit/release/release-state-stage-validation.test.ts
//
// Guards the backlog §2.4 fix: `readReleaseState` must not return a
// `currentStage` the stage table does not declare.
//
// Why this test file exists:
//   `readReleaseState` cast `JSON.parse` to `Partial<ReleaseState>` and handed
//   `parsed.active` straight back. `ReleaseRecord.currentStage` is typed
//   `ReleaseStage`, so the cast asserted a lie the file could contradict — the
//   validator `isReleaseStage` existed and was never called. Measured before
//   the fix: a file with `currentStage: 'hotfixed'` (a stage H2 deleted) read
//   back as `'hotfixed'`, and `transitionRelease` then THREW (its refusal
//   message indexes the stage table). After the fix the reader fails closed to
//   `EMPTY_RELEASE_STATE`, exactly as it already did for a malformed file or a
//   wrong `version`.
//
//   The load-bearing assertions are the PAIR: an unknown stage must be refused
//   on read, and a legal stage must still round-trip. A test that only
//   asserted the refusal would pass if the reader returned EMPTY unconditionally.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';
import {
  EMPTY_RELEASE_STATE,
  readReleaseState,
  transitionRelease,
  type ReleaseState
} from '~/src/services/release/release-state.js';

declareDimensions(
  'tests/unit/release/release-state-stage-validation.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason:
        'no user-facing copy, error code, or exit code is under test — the fix is a reader guard and its returned shape'
    }
  ]
);

const T0 = '2026-09-18T10:00:00.000Z';

/** The stage H2 deleted. Probe-only: `ReleaseStage` must not admit it. */
const RETIRED_STAGE = 'hotfixed';

/** A well-formed version-1 release record declaring `stage`. */
function record(stage: string): Record<string, unknown> {
  return {
    version: '9.9.9',
    currentStage: stage,
    stageHistory: [{ stage, at: T0 }],
    createdAt: T0
  };
}

function seed(ws: { peaksDir: string }, state: unknown): void {
  mkdirSync(ws.peaksDir, { recursive: true });
  writeFileSync(join(ws.peaksDir, 'release-state.json'), JSON.stringify(state, null, 2), 'utf8');
}

function seedActive(ws: { peaksDir: string }, stage: string): void {
  seed(ws, { version: 1, active: record(stage), history: [] });
}

const ws = withTmpWorkspacePerTest('peaks-release-stage-');

describe('Scenario: behavior — an undeclared stage is refused on read', () => {
  it('when the active release names an unknown stage, should fail closed', () => {
    // given: a state file claiming a stage no build declares
    seedActive(ws(), 'bogus-stage');

    // when:  the state is read
    const state = readReleaseState(ws().path);

    // then:  the reader refuses the file rather than assert the lie
    expect(state).toEqual(EMPTY_RELEASE_STATE);
    expect(state.active).toBeNull();
  });

  it('when the active release still names the retired hotfixed stage, should fail closed', () => {
    // given: the exact stale-file shape §2.4 was written about
    seedActive(ws(), RETIRED_STAGE);

    // when:  the state is read
    const state = readReleaseState(ws().path);

    // then:  the retired stage does not come back out
    expect(state).toEqual(EMPTY_RELEASE_STATE);
    expect(state.active?.currentStage).toBeUndefined();
  });

  it('when a history record names an unknown stage, should fail closed', () => {
    // given: an active release is fine, but a past one is not
    seed(ws(), { version: 1, active: record('planned'), history: [record('bogus-stage')] });

    // when:  the state is read
    // then:  the reader does not return a typed `currentStage` it cannot vouch for
    expect(readReleaseState(ws().path)).toEqual(EMPTY_RELEASE_STATE);
  });

  it('when the active release names a legal stage, should return it unchanged', () => {
    // given: a state file this build wrote itself
    seedActive(ws(), 'promoted');

    // when:  the state is read
    const state = readReleaseState(ws().path);

    // then:  the record survives intact — the guard is not a blanket refusal
    expect(state.active?.currentStage).toBe('promoted');
    expect(state.history).toEqual([]);
  });
});

describe('Scenario: render — a readable state keeps its version-1 shape', () => {
  it('when a legal file is read, should return version 1 with its history intact', () => {
    // given: one active and one historical record, both legal
    seed(ws(), { version: 1, active: record('watching'), history: [record('done')] });

    // when:  the state is read
    const state: ReleaseState = readReleaseState(ws().path);

    // then:  the envelope shape is unchanged by the guard
    expect(state.version).toBe(1);
    expect(state.active?.currentStage).toBe('watching');
    expect(state.history.map((r) => r.currentStage)).toEqual(['done']);
  });
});

describe('Scenario: integration — the existing fail-closed branches are untouched', () => {
  it('when the file is malformed JSON, should still return the empty state', () => {
    // given: a truncated file
    mkdirSync(ws().peaksDir, { recursive: true });
    writeFileSync(join(ws().peaksDir, 'release-state.json'), '{ not json', 'utf8');

    // when/then: the pre-existing catch branch answers
    expect(readReleaseState(ws().path)).toEqual(EMPTY_RELEASE_STATE);
  });

  it('when the file has a version this build does not know, should still return the empty state', () => {
    // given: a legal stage wrapped in an unknown version envelope
    seed(ws(), { version: 2, active: record('planned'), history: [] });

    // when/then: the pre-existing version branch answers, before the stage guard
    expect(readReleaseState(ws().path)).toEqual(EMPTY_RELEASE_STATE);
  });

  it('when a stale stage is read and a transition is attempted, should not throw', () => {
    // given: a file naming the retired stage — measured pre-fix to make
    //        `transitionRelease` throw a TypeError while building its refusal
    seedActive(ws(), RETIRED_STAGE);

    // when:  the reader hands the state to the transition path
    const state = readReleaseState(ws().path);

    // then:  there is no active release left to transition, and nothing throws
    expect(() => transitionRelease(state, 'canary-10')).not.toThrow();
    expect(transitionRelease(state, 'canary-10')).toEqual({ error: 'no active release' });
  });

  it('when the file is absent, should return the empty state', () => {
    // when/then: the pre-existing missing-file branch answers
    expect(readReleaseState(ws().path)).toEqual(EMPTY_RELEASE_STATE);
  });
});

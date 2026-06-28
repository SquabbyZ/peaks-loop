/**
 * v2.15.0 follow-up — G15 tests: release state machine.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EMPTY_RELEASE_STATE,
  hotfixRelease,
  isReleaseStage,
  isValidStageTransition,
  planRelease,
  readReleaseState,
  rollbackRelease,
  transitionRelease,
  watchWindow,
  writeReleaseState,
  type ReleaseStage
} from '../../../../src/services/release/release-state.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'peaks-release-test-'));
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe('isReleaseStage', () => {
  it('accepts the 8 known stages', () => {
    for (const s of ['planned', 'canary-10', 'canary-50', 'promoted', 'watching', 'done', 'rolled-back', 'hotfixed']) {
      expect(isReleaseStage(s)).toBe(true);
    }
  });
  it('rejects unknown stages', () => {
    expect(isReleaseStage('foo')).toBe(false);
  });
});

describe('isValidStageTransition', () => {
  it('allows the happy path: planned → canary-10 → canary-50 → promoted → watching → done', () => {
    const path: ReleaseStage[] = ['planned', 'canary-10', 'canary-50', 'promoted', 'watching', 'done'];
    for (let i = 0; i < path.length - 1; i++) {
      expect(isValidStageTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });
  it('allows rollback from any pre-done stage', () => {
    for (const s of ['planned', 'canary-10', 'canary-50', 'promoted', 'watching'] as const) {
      expect(isValidStageTransition(s, 'rolled-back')).toBe(true);
    }
  });
  it('forbids skipping stages', () => {
    expect(isValidStageTransition('planned', 'canary-50')).toBe(false);
    expect(isValidStageTransition('planned', 'promoted')).toBe(false);
    expect(isValidStageTransition('canary-10', 'promoted')).toBe(false);
  });
  it('forbids transitions from done', () => {
    expect(isValidStageTransition('done', 'rolled-back')).toBe(false);
    expect(isValidStageTransition('done', 'watching')).toBe(false);
  });
});

describe('planRelease', () => {
  it('plans a new release in the planned stage', () => {
    const r = planRelease(EMPTY_RELEASE_STATE, 'v1.0.0', new Date('2026-06-28T10:00:00Z'));
    if ('error' in r) throw new Error('expected ok');
    expect(r.record.version).toBe('v1.0.0');
    expect(r.record.currentStage).toBe('planned');
    expect(r.state.active).toEqual(r.record);
  });
  it('rejects planning when an active release exists', () => {
    const r1 = planRelease(EMPTY_RELEASE_STATE, 'v1.0.0', new Date('2026-06-28T10:00:00Z'));
    if ('error' in r1) throw new Error('expected ok');
    const r2 = planRelease(r1.state, 'v1.1.0', new Date('2026-06-28T11:00:00Z'));
    expect('error' in r2).toBe(true);
  });
});

describe('transitionRelease', () => {
  it('advances planned → canary-10', () => {
    const r = planRelease(EMPTY_RELEASE_STATE, 'v1.0.0', new Date('2026-06-28T10:00:00Z'));
    if ('error' in r) throw new Error('expected ok');
    const t = transitionRelease(r.state, 'canary-10', undefined, new Date('2026-06-28T11:00:00Z'));
    if ('error' in t) throw new Error('expected ok');
    expect(t.state.active?.currentStage).toBe('canary-10');
  });
  it('records promotedAt when transitioning to promoted', () => {
    const r1 = planRelease(EMPTY_RELEASE_STATE, 'v1.0.0', new Date('2026-06-28T10:00:00Z'));
    if ('error' in r1) throw new Error('expected ok');
    const r2 = transitionRelease(r1.state, 'canary-10', undefined, new Date('2026-06-28T11:00:00Z'));
    if ('error' in r2) throw new Error('expected ok');
    const r3 = transitionRelease(r2.state, 'canary-50', undefined, new Date('2026-06-28T12:00:00Z'));
    if ('error' in r3) throw new Error('expected ok');
    const promoted = transitionRelease(r3.state, 'promoted', undefined, new Date('2026-06-28T13:00:00Z'));
    if ('error' in promoted) throw new Error('expected ok');
    expect(promoted.state.active?.promotedAt).toBe('2026-06-28T13:00:00.000Z');
  });
  it('rejects invalid transition', () => {
    const r = planRelease(EMPTY_RELEASE_STATE, 'v1.0.0', new Date('2026-06-28T10:00:00Z'));
    if ('error' in r) throw new Error('expected ok');
    const t = transitionRelease(r.state, 'done');
    expect('error' in t).toBe(true);
  });
});

describe('rollbackRelease', () => {
  it('rolls back an active release and moves to history', () => {
    const r = planRelease(EMPTY_RELEASE_STATE, 'v1.0.0', new Date('2026-06-28T10:00:00Z'));
    if ('error' in r) throw new Error('expected ok');
    const rb = rollbackRelease(r.state, 'emergency', new Date('2026-06-28T11:00:00Z'));
    if ('error' in rb) throw new Error('expected ok');
    expect(rb.state.active).toBeNull();
    expect(rb.state.history).toHaveLength(1);
    expect(rb.state.history[0]?.currentStage).toBe('rolled-back');
  });
});

describe('hotfixRelease', () => {
  it('starts a hotfix without any active release (skips planned stage)', () => {
    const r = hotfixRelease(EMPTY_RELEASE_STATE, 'v1.0.1-hotfix', 'urgent', new Date('2026-06-28T10:00:00Z'));
    if ('error' in r) throw new Error('expected ok');
    expect(r.record.currentStage).toBe('canary-10');
    expect(r.record.version).toBe('v1.0.1-hotfix');
  });
  it('forces rollback of the active release before starting the hotfix', () => {
    const p = planRelease(EMPTY_RELEASE_STATE, 'v1.0.0', new Date('2026-06-28T10:00:00Z'));
    if ('error' in p) throw new Error('expected ok');
    const h = hotfixRelease(p.state, 'v1.0.1-hotfix', 'urgent', new Date('2026-06-28T11:00:00Z'));
    if ('error' in h) throw new Error('expected ok');
    expect(h.state.active?.version).toBe('v1.0.1-hotfix');
    expect(h.state.active?.currentStage).toBe('canary-10');
    expect(h.state.history).toHaveLength(1);
    expect(h.state.history[0]?.version).toBe('v1.0.0');
  });
});

describe('watchWindow', () => {
  it('returns full window when not yet promoted', () => {
    const r = planRelease(EMPTY_RELEASE_STATE, 'v1.0.0', new Date('2026-06-28T10:00:00Z'));
    if ('error' in r) throw new Error('expected ok');
    const win = watchWindow(r.record, new Date('2026-06-28T10:00:00Z'));
    expect(win.elapsedMs).toBe(0);
    expect(win.remainingMs).toBe(24 * 60 * 60 * 1000);
    expect(win.percentComplete).toBe(0);
  });
  it('computes elapsed time correctly', () => {
    const r = planRelease(EMPTY_RELEASE_STATE, 'v1.0.0', new Date('2026-06-28T10:00:00Z'));
    if ('error' in r) throw new Error('expected ok');
    let state = transitionRelease(r.state, 'canary-10', undefined, new Date('2026-06-28T10:00:00Z'));
    if ('error' in state) throw new Error('expected ok');
    state = transitionRelease(state.state, 'canary-50', undefined, new Date('2026-06-28T10:00:00Z'));
    if ('error' in state) throw new Error('expected ok');
    state = transitionRelease(state.state, 'promoted', undefined, new Date('2026-06-28T10:00:00Z'));
    if ('error' in state) throw new Error('expected ok');
    const twelveHoursLater = new Date('2026-06-28T22:00:00Z');
    const win = watchWindow(state.state.active!, twelveHoursLater);
    expect(win.elapsedMs).toBe(12 * 60 * 60 * 1000);
    expect(win.percentComplete).toBe(0.5);
  });
  it('caps at 100% even when past the window', () => {
    const r = planRelease(EMPTY_RELEASE_STATE, 'v1.0.0', new Date('2026-06-28T10:00:00Z'));
    if ('error' in r) throw new Error('expected ok');
    const promoted: ReleaseStage = 'promoted';
    const active = { ...r.record, currentStage: promoted, promotedAt: '2026-06-28T10:00:00.000Z' };
    const win = watchWindow(active, new Date('2026-06-30T10:00:00Z'));
    expect(win.percentComplete).toBe(1);
  });
});

describe('readReleaseState / writeReleaseState', () => {
  it('returns EMPTY when no file exists', () => {
    expect(readReleaseState(tmpDir)).toEqual(EMPTY_RELEASE_STATE);
  });
  it('round-trips state through disk', () => {
    const r = planRelease(EMPTY_RELEASE_STATE, 'v1.0.0', new Date('2026-06-28T10:00:00Z'));
    if ('error' in r) throw new Error('expected ok');
    writeReleaseState(tmpDir, r.state);
    const reloaded = readReleaseState(tmpDir);
    expect(reloaded.active?.version).toBe('v1.0.0');
  });
});

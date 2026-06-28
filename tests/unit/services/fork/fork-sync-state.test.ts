/**
 * v2.15.0 follow-up — G11 tests: fork-sync-state service.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendSyncRecord,
  buildForkStatusReport,
  EMPTY_FORK_STATE,
  makeSyncId,
  readForkState,
  recommendStableTags,
  updateSyncRecordStatus,
  writeForkState,
  type ForkBaseline,
  type ForkSyncRecord
} from '../../../../src/services/fork/fork-sync-state.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'peaks-fork-test-'));
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe('readForkState / writeForkState', () => {
  it('returns EMPTY_FORK_STATE when no state file exists', () => {
    const state = readForkState(tmpDir);
    expect(state).toEqual(EMPTY_FORK_STATE);
  });

  it('round-trips a state through the filesystem', () => {
    const baseline: ForkBaseline = {
      upstream: 'github.com/xxx/hermes',
      basedOn: 'v1.0.0',
      recordedAt: '2026-06-28T10:00:00.000Z',
      commitsAhead: 5,
      filesChanged: 12
    };
    const record: ForkSyncRecord = {
      syncId: 'sync-test',
      targetTag: 'v1.10.0',
      plannedAt: '2026-06-28T11:00:00.000Z',
      predictedConflicts: ['src/foo.ts'],
      businessPatches: ['p1', 'p2'],
      status: 'planned'
    };
    writeForkState(tmpDir, { version: 1, baseline, history: [record] });
    const onDisk = JSON.parse(readFileSync(join(tmpDir, '.peaks/fork-state.json'), 'utf8'));
    expect(onDisk.baseline.basedOn).toBe('v1.0.0');
    const reloaded = readForkState(tmpDir);
    expect(reloaded.baseline).toEqual(baseline);
    expect(reloaded.history).toEqual([record]);
  });
});

describe('appendSyncRecord / updateSyncRecordStatus (immutability)', () => {
  it('appendSyncRecord returns a new state without mutating the input', () => {
    const before = readForkState(tmpDir);
    const record: ForkSyncRecord = {
      syncId: 'sync-1',
      targetTag: 'v1.5.0',
      plannedAt: '2026-06-28T12:00:00.000Z',
      predictedConflicts: [],
      businessPatches: [],
      status: 'planned'
    };
    const after = appendSyncRecord(before, record);
    expect(before.history).toHaveLength(0);
    expect(after.history).toHaveLength(1);
    expect(after.history[0]?.syncId).toBe('sync-1');
  });

  it('updateSyncRecordStatus changes the status of the matching record', () => {
    const a: ForkSyncRecord = { syncId: 'a', targetTag: 'v1', plannedAt: 't', predictedConflicts: [], businessPatches: [], status: 'planned' };
    const b: ForkSyncRecord = { syncId: 'b', targetTag: 'v2', plannedAt: 't', predictedConflicts: [], businessPatches: [], status: 'planned' };
    const state = { version: 1 as const, baseline: null, history: [a, b] };
    const updated = updateSyncRecordStatus(state, 'a', 'verified', 'all good');
    expect(updated.history[0]?.status).toBe('verified');
    expect(updated.history[0]?.verificationNotes).toBe('all good');
    expect(updated.history[1]?.status).toBe('planned');
  });

  it('updateSyncRecordStatus returns state unchanged when syncId not found', () => {
    const state = { version: 1 as const, baseline: null, history: [] };
    const updated = updateSyncRecordStatus(state, 'nope', 'verified');
    expect(updated).toBe(state);
  });
});

describe('makeSyncId', () => {
  it('produces a stable id with date and tag slug', () => {
    const id = makeSyncId('v1.20.0', new Date('2026-06-28T10:00:00.000Z'));
    expect(id).toBe('sync-2026-06-28-v1.20.0');
  });

  it('sanitizes non-alphanumeric characters in the tag', () => {
    const id = makeSyncId('v1.0/rc+1', new Date('2026-06-28T10:00:00.000Z'));
    expect(id).toBe('sync-2026-06-28-v1.0-rc-1');
  });
});

describe('recommendStableTags', () => {
  it('filters out pre-release tags (alpha/beta/rc/dev/preview)', () => {
    const tags = ['v1.0.0', 'v1.0.0-alpha', 'v1.5.0-beta', 'v1.8.0-rc.1', 'v1.9.0', 'v2.0.0-dev'];
    expect(recommendStableTags(tags, null)).toEqual(['v1.0.0', 'v1.9.0']);
  });

  it('returns only tags newer than the current baseline', () => {
    const tags = ['v1.0.0', 'v1.5.0', 'v1.9.0', 'v2.0.0'];
    expect(recommendStableTags(tags, 'v1.5.0')).toEqual(['v1.9.0', 'v2.0.0']);
  });

  it('returns all stable tags when baseline is null', () => {
    const tags = ['v1.0.0', 'v1.5.0', 'v2.0.0'];
    expect(recommendStableTags(tags, null)).toEqual(['v1.0.0', 'v1.5.0', 'v2.0.0']);
  });

  it('returns all stable tags when baseline is not in the list', () => {
    const tags = ['v1.5.0', 'v2.0.0'];
    expect(recommendStableTags(tags, 'v1.0.0')).toEqual(['v1.5.0', 'v2.0.0']);
  });
});

describe('buildForkStatusReport', () => {
  it('flags driftWarning when commitsAhead > 30', () => {
    const state = {
      version: 1 as const,
      baseline: {
        upstream: 'u',
        basedOn: 'v1',
        recordedAt: 't',
        commitsAhead: 50,
        filesChanged: 5
      },
      history: []
    };
    const r = buildForkStatusReport(state);
    expect(r.driftWarning).toBe(true);
    expect(r.hasBaseline).toBe(true);
  });

  it('does NOT flag driftWarning when commitsAhead <= 30', () => {
    const state = {
      version: 1 as const,
      baseline: {
        upstream: 'u',
        basedOn: 'v1',
        recordedAt: 't',
        commitsAhead: 10,
        filesChanged: 5
      },
      history: []
    };
    const r = buildForkStatusReport(state);
    expect(r.driftWarning).toBe(false);
  });

  it('returns lastSync as the most recent history entry', () => {
    const a: ForkSyncRecord = { syncId: 'a', targetTag: 'v1', plannedAt: 't1', predictedConflicts: [], businessPatches: [], status: 'verified' };
    const b: ForkSyncRecord = { syncId: 'b', targetTag: 'v2', plannedAt: 't2', predictedConflicts: [], businessPatches: [], status: 'planned' };
    const state = { version: 1 as const, baseline: null, history: [a, b] };
    expect(buildForkStatusReport(state).lastSync?.syncId).toBe('b');
  });

  it('returns lastSync = null when history is empty', () => {
    const r = buildForkStatusReport(EMPTY_FORK_STATE);
    expect(r.lastSync).toBeNull();
    expect(r.syncCount).toBe(0);
  });
});

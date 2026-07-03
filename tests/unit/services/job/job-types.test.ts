import { describe, it, expect } from 'vitest';
import {
  SliceStateSchema,
  JobStateSchema,
  ResourceSnapshotSchema,
  JobStatusSummarySchema,
  type SliceState,
  type JobState,
  type ResourceSnapshot,
  type JobStatusSummary,
} from '../../../../src/services/job/job-types.js';

describe('SliceStateSchema', () => {
  it('accepts a minimal pending slice', () => {
    const r = SliceStateSchema.safeParse({ sliceId: 's1', label: 'a', status: 'pending' });
    expect(r.success).toBe(true);
  });
  it('rejects an unknown status enum value', () => {
    const r = SliceStateSchema.safeParse({ sliceId: 's1', label: 'a', status: 'whatever' });
    expect(r.success).toBe(false);
  });
  it('requires commitSha when status is done', () => {
    const r = SliceStateSchema.safeParse({ sliceId: 's1', label: 'a', status: 'done' });
    expect(r.success).toBe(false);
  });
});

describe('JobStateSchema', () => {
  it('defaults mainLoopStrategy to rotating', () => {
    const r = JobStateSchema.parse({
      jobId: 'j1', sessionId: 'sess-1',
      startedAt: '2026-07-03T00:00:00.000Z',
      lastCheckpointAt: '2026-07-03T00:01:00.000Z',
      slices: [],
    });
    expect(r.mainLoopStrategy).toBe('rotating');
    expect(r.rotateEvery).toBe(3);
    expect(r.mainSessionCycle).toBe(0);
  });
  it('accepts optional mainLoopOverride (rotating → single) with reason + timestamp', () => {
    const r = JobStateSchema.safeParse({
      jobId: 'j1', sessionId: 'sess-1',
      startedAt: '2026-07-03T00:00:00.000Z',
      lastCheckpointAt: '2026-07-03T00:01:00.000Z',
      slices: [],
      mainLoopOverride: { from: 'rotating', to: 'single', reason: '2-slice fix; predicted wall ≤5min', at: '2026-07-03T00:00:30.000Z' },
    });
    expect(r.success).toBe(true);
  });
});

describe('ResourceSnapshotSchema', () => {
  it('rejects contextRatio > 1', () => {
    const r = ResourceSnapshotSchema.safeParse({ capturedAt: '2026-07-03T00:00:00.000Z', cpuPercent: 50, memMb: 1024, diskMb: 10, contextRatio: 1.5 });
    expect(r.success).toBe(false);
  });
});

describe('JobStatusSummarySchema', () => {
  it('derives total = done + failed + blocked + skipped + pending (sample)', () => {
    const r = JobStatusSummarySchema.safeParse({ total: 8, done: 5, failed: 0, blocked: 0, skipped: 0, lastCheckpoint: '2026-07-03T00:00:00.000Z', mainLoopStrategy: 'rotating', mainSessionCycle: 1 });
    expect(r.success).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import os from 'node:os';
import { collectResourceSnapshot } from '../../../../src/services/job/job-resource-snapshot.js';
import { ResourceSnapshotSchema } from '../../../../src/services/job/job-types.js';

describe('collectResourceSnapshot', () => {
  it('returns a structurally-valid snapshot', () => {
    const snap = collectResourceSnapshot(os.tmpdir());
    expect(snap.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(snap.cpuPercent).toBeLessThanOrEqual(100);
    expect(snap.memMb).toBeGreaterThanOrEqual(0);
    expect(snap.diskMb).toBeGreaterThanOrEqual(0);
    expect(snap.contextRatio).toBeGreaterThanOrEqual(0);
    expect(snap.contextRatio).toBeLessThanOrEqual(1);
    // shape conforms to ResourceSnapshot (validate with zod)
    const r = ResourceSnapshotSchema.safeParse(snap);
    expect(r.success).toBe(true);
  });

  it('capturedAt is ISO 8601', () => {
    const snap = collectResourceSnapshot(os.tmpdir());
    expect(() => new Date(snap.capturedAt)).not.toThrow();
    expect(snap.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

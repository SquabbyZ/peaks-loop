import { describe, expect, it } from 'vitest';
import { HEARTBEAT_TRUNCATE_LIMIT, truncateHeartbeats } from '../../src/services/dispatch/heartbeat-truncator.js';
import type { Heartbeat } from '../../src/services/dispatch/dispatch-record-writer.js';

function makeHeartbeat(i: number): Heartbeat {
  return {
    at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    status: 'running',
    progress: i % 100,
    note: null
  };
}

describe('truncateHeartbeats (RL-16)', () => {
  it('keeps all entries below the limit', () => {
    const entries = Array.from({ length: 99 }, (_, i) => makeHeartbeat(i));
    const r = truncateHeartbeats(entries);
    expect(r.truncated).toBe(false);
    expect(r.dropped).toBe(0);
    expect(r.heartbeats).toHaveLength(99);
  });

  it('keeps the most recent 100 when over the limit and reports truncated', () => {
    const entries = Array.from({ length: 150 }, (_, i) => makeHeartbeat(i));
    const r = truncateHeartbeats(entries);
    expect(r.truncated).toBe(true);
    expect(r.dropped).toBe(50);
    expect(r.heartbeats).toHaveLength(100);
    // The kept entries are the last 100 (indices 50..149).
    expect(r.heartbeats[0]?.at).toBe(entries[50]?.at);
    expect(r.heartbeats[99]?.at).toBe(entries[149]?.at);
  });

  it('exposes the constant for the truncation limit', () => {
    expect(HEARTBEAT_TRUNCATE_LIMIT).toBe(100);
  });

  it('handles an empty array', () => {
    const r = truncateHeartbeats([]);
    expect(r.truncated).toBe(false);
    expect(r.heartbeats).toHaveLength(0);
  });
});

/**
 * applyTruncation boundary tests — slice 2026-06-23-audit-4th #D2.
 *
 * Pins the contract: keep most recent 100, mark truncated=true when
 * the input is >100. The truncated flag flows through appendHeartbeat's
 * return value so the LLM can detect "we dropped older heartbeats".
 * The 100-entry cap is hard-coded in applyTruncation; this file
 * verifies the boundary at 0, exactly-100, 101, and 200 entries.
 *
 * 200 vs 101 is the most important case: the function must keep the
 * LAST 100 (newest), not the FIRST 100 (oldest). A regression that
 * kept the oldest would silently lose recent progress updates, which
 * is the worst-case for the dispatcher's poll loop.
 */
import { describe, expect, it } from 'vitest';
import { applyTruncation } from '../../../../src/services/dispatch/dispatch-record-writer.js';

function makeHeartbeat(i: number, progress: number): { at: string; status: 'running' | 'done'; progress: number; note: string | null } {
  // at is sequential so the LAST 100 case is unambiguous in tests.
  return {
    at: `2026-06-23T00:00:${String(i).padStart(2, '0')}.000Z`,
    status: i === 199 ? 'done' : 'running',
    progress,
    note: null
  };
}

describe('applyTruncation', () => {
  it('returns the input verbatim when length <= 100 (truncated=false)', () => {
    const input = Array.from({ length: 100 }, (_, i) => makeHeartbeat(i, i));
    const result = applyTruncation(input);
    expect(result.heartbeats).toEqual(input);
    expect(result.truncated).toBe(false);
    expect(result.heartbeats.length).toBe(100);
  });

  it('returns empty array for empty input (truncated=false)', () => {
    const result = applyTruncation([]);
    expect(result.heartbeats).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('drops oldest entries and keeps last 100 when input is 101 (truncated=true)', () => {
    const input = Array.from({ length: 101 }, (_, i) => makeHeartbeat(i, i));
    const result = applyTruncation(input);
    expect(result.truncated).toBe(true);
    expect(result.heartbeats.length).toBe(100);
    // First entry (i=0) must be dropped; entries 1..100 must survive.
    expect(result.heartbeats[0]?.progress).toBe(1);
    expect(result.heartbeats[99]?.progress).toBe(100);
  });

  it('keeps LAST 100 (not first 100) when input is 200 — critical for progress visibility', () => {
    const input = Array.from({ length: 200 }, (_, i) => makeHeartbeat(i, i));
    const result = applyTruncation(input);
    expect(result.truncated).toBe(true);
    expect(result.heartbeats.length).toBe(100);
    // The last entry (i=199, status=done) must be present.
    expect(result.heartbeats[99]?.at).toBe('2026-06-23T00:00:199.000Z');
    expect(result.heartbeats[99]?.status).toBe('done');
    expect(result.heartbeats[99]?.progress).toBe(199);
    // The first kept entry (i=100) must be the OLDEST visible.
    expect(result.heartbeats[0]?.progress).toBe(100);
    // Entries 0..99 must be gone.
    expect(result.heartbeats.some((h) => h.progress === 0)).toBe(false);
  });

  it('returns a NEW array (does not mutate the input)', () => {
    const input = Array.from({ length: 5 }, (_, i) => makeHeartbeat(i, i));
    const snapshot = input.map((h) => h.at);
    const result = applyTruncation(input);
    expect(result.heartbeats).not.toBe(input);
    expect(input.map((h) => h.at)).toEqual(snapshot);
  });
});

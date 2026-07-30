// tests/unit/services/dispatch/heartbeat-truncator.test.ts
//
// 4-dimension unit test for the pure heartbeat truncation helper in
// src/services/dispatch/heartbeat-truncator.ts. The function is pure —
// given an array of heartbeats it returns the most recent
// HEARTBEAT_TRUNCATE_LIMIT (100) plus a flag and a drop count.
//
// Dimensions covered:
//   - render:    not applicable (returns structured data, not user text)
//   - behavior:  truncation only fires when input length > 100; result
//                is the most-recent window; dropped count is correct
//   - a11y:      not applicable (no human-visible surface)
//   - integration: OMITTED — pure function, no boundary to mock
//
// We declareDimensions with the covered set explicitly so the omitted
// dimensions surface in any future test audit.

import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import type { Heartbeat } from '~/src/services/dispatch/dispatch-record-writer';

declareDimensions(
  'tests/unit/services/dispatch/heartbeat-truncator.test.ts',
  ['behavior'],
  [
    { dim: 'render', reason: 'returns a structured TruncationResult, no text surface' },
    { dim: 'integration', reason: 'pure function, no fs/network/process boundary' },
    { dim: 'a11y', reason: 'no user-visible text or exit code' },
  ],
);

import {
  HEARTBEAT_TRUNCATE_LIMIT,
  truncateHeartbeats,
} from '~/src/services/dispatch/heartbeat-truncator';

function hb(seq: number): Heartbeat {
  return {
    at: new Date(2026, 6, 30, 0, 0, seq).toISOString(),
    seq,
    note: `heartbeat #${seq}`,
  };
}

describe('behavior — truncation boundary', () => {
  it('returns a copy of the input unchanged when length <= LIMIT', () => {
    const input: Heartbeat[] = Array.from({ length: 50 }, (_, i) => hb(i));
    const out = truncateHeartbeats(input);
    expect(out.truncated).toBe(false);
    expect(out.dropped).toBe(0);
    expect(out.heartbeats).toHaveLength(50);
    expect(out.heartbeats[0]?.seq).toBe(0);
    expect(out.heartbeats[49]?.seq).toBe(49);
  });

  it('returns the input unchanged when length equals LIMIT exactly', () => {
    const input: Heartbeat[] = Array.from({ length: HEARTBEAT_TRUNCATE_LIMIT }, (_, i) => hb(i));
    const out = truncateHeartbeats(input);
    expect(out.truncated).toBe(false);
    expect(out.dropped).toBe(0);
    expect(out.heartbeats).toHaveLength(HEARTBEAT_TRUNCATE_LIMIT);
  });

  it('keeps the most recent LIMIT entries when length > LIMIT', () => {
    const total = HEARTBEAT_TRUNCATE_LIMIT + 5;
    const input: Heartbeat[] = Array.from({ length: total }, (_, i) => hb(i));
    const out = truncateHeartbeats(input);
    expect(out.truncated).toBe(true);
    expect(out.dropped).toBe(5);
    expect(out.heartbeats).toHaveLength(HEARTBEAT_TRUNCATE_LIMIT);
    // First kept entry must be the oldest one still inside the window.
    expect(out.heartbeats[0]?.seq).toBe(5);
    // Last kept entry must be the very last input entry.
    expect(out.heartbeats[HEARTBEAT_TRUNCATE_LIMIT - 1]?.seq).toBe(total - 1);
  });

  it('drops the oldest half when input is 2x the limit', () => {
    const total = HEARTBEAT_TRUNCATE_LIMIT * 2;
    const input: Heartbeat[] = Array.from({ length: total }, (_, i) => hb(i));
    const out = truncateHeartbeats(input);
    expect(out.truncated).toBe(true);
    expect(out.dropped).toBe(HEARTBEAT_TRUNCATE_LIMIT);
    expect(out.heartbeats[0]?.seq).toBe(HEARTBEAT_TRUNCATE_LIMIT);
  });

  it('handles a single-entry array (no-op)', () => {
    const out = truncateHeartbeats([hb(1)]);
    expect(out.truncated).toBe(false);
    expect(out.dropped).toBe(0);
    expect(out.heartbeats).toEqual([hb(1)]);
  });

  it('handles an empty array (no-op)', () => {
    const out = truncateHeartbeats([]);
    expect(out.truncated).toBe(false);
    expect(out.dropped).toBe(0);
    expect(out.heartbeats).toEqual([]);
  });

  it('returns a NEW array, never aliases the input', () => {
    const input: Heartbeat[] = [hb(1), hb(2)];
    const out = truncateHeartbeats(input);
    expect(out.heartbeats).not.toBe(input);
    // Mutating the result must not mutate the input.
    (out.heartbeats as Heartbeat[]).push(hb(3));
    expect(input).toHaveLength(2);
  });

  it('preserves entry order (most-recent at the end)', () => {
    const input: Heartbeat[] = [hb(1), hb(2), hb(3)];
    const out = truncateHeartbeats(input);
    expect(out.heartbeats.map((h) => h.seq)).toEqual([1, 2, 3]);
  });
});

describe('behavior — LIMIT constant sanity', () => {
  it('HEARTBEAT_TRUNCATE_LIMIT is the documented value (100)', () => {
    expect(HEARTBEAT_TRUNCATE_LIMIT).toBe(100);
  });
});

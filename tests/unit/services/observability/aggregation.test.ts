/**
 * Tests for `aggregation.ts` — pure aggregations over
 * `readonly ObservabilityEvent[]`.
 *
 * Slice B of v2.11.1. No fs — synthetic events only. The CLI layer
 * is tested separately in `observability-commands.test.ts`.
 */

import { describe, expect, test } from 'vitest';

import {
  REPAIR_CYCLE_CAP,
  aggregateFanout,
  aggregateRepairCycles,
  aggregateSlices,
  aggregateStatus,
  filterByPeriod,
  periodStartIso
} from '../../../../src/services/observability/aggregation.js';
import type { ObservabilityEvent } from '../../../../src/services/observability/observability-service.js';

function evt(overrides: Partial<ObservabilityEvent> & Pick<ObservabilityEvent, 'category' | 'sessionId'>): ObservabilityEvent {
  return {
    schemaVersion: 1,
    ts: '2026-06-26T09:30:00.000Z',
    detail: {},
    ...overrides
  };
}

function sliceTransition(overrides: {
  sessionId: string;
  sliceRid: string;
  ts?: string;
  from?: string;
  to: string;
  artifactRole?: string;
}): ObservabilityEvent {
  return evt({
    category: 'slice-transition',
    sessionId: overrides.sessionId,
    ts: overrides.ts ?? '2026-06-26T09:30:00.000Z',
    sliceRid: overrides.sliceRid,
    detail: {
      ...(overrides.from !== undefined ? { from: overrides.from } : {}),
      to: overrides.to,
      ...(overrides.artifactRole !== undefined ? { artifactRole: overrides.artifactRole } : {})
    }
  });
}

describe('aggregateStatus', () => {
  test('returns zeros for an empty event list', () => {
    const s = aggregateStatus([]);
    expect(s).toEqual({
      totalEvents: 0,
      totalSlices: 0,
      successCount: 0,
      failCount: 0,
      repairCyclePeak: 0,
      fanoutCostTotal: 0
    });
  });

  test('counts one happy slice (final state = handed-off)', () => {
    const events = [
      sliceTransition({ sessionId: 's1', sliceRid: '001', from: 'draft', to: 'spec-locked', artifactRole: 'rd' }),
      sliceTransition({ sessionId: 's1', sliceRid: '001', from: 'spec-locked', to: 'implemented', artifactRole: 'rd' }),
      sliceTransition({ sessionId: 's1', sliceRid: '001', from: 'implemented', to: 'handed-off', artifactRole: 'rd' })
    ];
    const s = aggregateStatus(events);
    expect(s.totalEvents).toBe(3);
    expect(s.totalSlices).toBe(1);
    expect(s.successCount).toBe(1);
    expect(s.failCount).toBe(0);
  });

  test('counts blocked as fail', () => {
    const events = [
      sliceTransition({ sessionId: 's1', sliceRid: '001', from: 'draft', to: 'blocked', artifactRole: 'rd' })
    ];
    const s = aggregateStatus(events);
    expect(s.totalSlices).toBe(1);
    expect(s.successCount).toBe(0);
    expect(s.failCount).toBe(1);
  });

  test('counts qa handoffs as repair-cycle activity', () => {
    const events = [
      sliceTransition({ sessionId: 's1', sliceRid: '001', from: 'draft', to: 'spec-locked', artifactRole: 'rd' }),
      sliceTransition({ sessionId: 's1', sliceRid: '001', from: 'spec-locked', to: 'qa-handoff', artifactRole: 'rd' }),
      sliceTransition({ sessionId: 's1', sliceRid: '001', from: 'qa-handoff', to: 'verdict-issued', artifactRole: 'qa' }),
      sliceTransition({ sessionId: 's1', sliceRid: '001', from: 'verdict-issued', to: 'qa-handoff', artifactRole: 'qa' })
    ];
    const s = aggregateStatus(events);
    expect(s.repairCyclePeak).toBe(2);
  });

  test('counts dispatch events toward fanoutCostTotal', () => {
    const events = [
      evt({ category: 'dispatch', sessionId: 's1', role: 'rd', detail: {} }),
      evt({ category: 'dispatch', sessionId: 's1', role: 'qa', detail: {} }),
      sliceTransition({ sessionId: 's1', sliceRid: '001', from: 'draft', to: 'spec-locked', artifactRole: 'rd' })
    ];
    const s = aggregateStatus(events);
    expect(s.fanoutCostTotal).toBe(2);
    expect(s.totalEvents).toBe(3);
  });
});

describe('aggregateSlices', () => {
  test('returns one rollup per sliceRid', () => {
    const events = [
      sliceTransition({ sessionId: 's1', sliceRid: '001', from: 'draft', to: 'spec-locked', artifactRole: 'rd', ts: '2026-06-26T09:00:00.000Z' }),
      sliceTransition({ sessionId: 's1', sliceRid: '001', from: 'spec-locked', to: 'handed-off', artifactRole: 'rd', ts: '2026-06-26T09:30:00.000Z' }),
      sliceTransition({ sessionId: 's1', sliceRid: '002', from: 'draft', to: 'blocked', artifactRole: 'rd' })
    ];
    const slices = aggregateSlices(events);
    expect(slices).toHaveLength(2);
    const r1 = slices.find((s) => s.sliceRid === '001')!;
    expect(r1.transitions).toBe(2);
    expect(r1.finalState).toBe('handed-off');
    expect(r1.success).toBe(true);
    expect(r1.durationMs).toBe(30 * 60 * 1000);
    const r2 = slices.find((s) => s.sliceRid === '002')!;
    expect(r2.finalState).toBe('blocked');
    expect(r2.success).toBe(false);
  });

  test('sorts rollups by sliceRid ascending', () => {
    const events = [
      sliceTransition({ sessionId: 's1', sliceRid: '002', from: 'draft', to: 'spec-locked', artifactRole: 'rd' }),
      sliceTransition({ sessionId: 's1', sliceRid: '001', from: 'draft', to: 'spec-locked', artifactRole: 'rd' }),
      sliceTransition({ sessionId: 's1', sliceRid: '003', from: 'draft', to: 'spec-locked', artifactRole: 'rd' })
    ];
    const slices = aggregateSlices(events);
    expect(slices.map((s) => s.sliceRid)).toEqual(['001', '002', '003']);
  });

  test('returns empty array when no slice-transition events', () => {
    expect(aggregateSlices([])).toEqual([]);
  });
});

describe('aggregateFanout', () => {
  test('returns zeros for no dispatch events', () => {
    expect(aggregateFanout([])).toEqual({
      total: 0,
      perRole: { 'rd': 0, 'qa': 0, 'code-reviewer': 0, 'karpathy-reviewer': 0, 'peaks-security-audit': 0, 'peaks-perf-audit': 0 }
    });
  });

  test('groups dispatch events by role', () => {
    const events = [
      evt({ category: 'dispatch', sessionId: 's1', role: 'rd', detail: {} }),
      evt({ category: 'dispatch', sessionId: 's1', role: 'rd', detail: {} }),
      evt({ category: 'dispatch', sessionId: 's1', role: 'qa', detail: {} }),
      evt({ category: 'dispatch', sessionId: 's1', role: 'karpathy-reviewer', detail: {} }),
      // Non-dispatch events are ignored:
      sliceTransition({ sessionId: 's1', sliceRid: '001', from: 'draft', to: 'spec-locked', artifactRole: 'rd' })
    ];
    const f = aggregateFanout(events);
    expect(f.total).toBe(4);
    expect(f.perRole.rd).toBe(2);
    expect(f.perRole.qa).toBe(1);
    expect(f.perRole['karpathy-reviewer']).toBe(1);
    expect(f.perRole['code-reviewer']).toBe(0);
    expect(f.perRole['peaks-security-audit']).toBe(0);
    expect(f.perRole['peaks-perf-audit']).toBe(0);
  });

  test('ignores dispatch events without a role field', () => {
    const events = [
      evt({ category: 'dispatch', sessionId: 's1', detail: {} })
    ];
    const f = aggregateFanout(events);
    expect(f.total).toBe(0);
  });
});

describe('aggregateRepairCycles', () => {
  test('returns zero cycles for no slice-transition events', () => {
    const r = aggregateRepairCycles([]);
    expect(r.totalCycles).toBe(0);
    expect(r.capHit).toBe(false);
    expect(r.capHitCount).toBe(0);
    expect(r.perSlice).toEqual([]);
  });

  test('flags capHit when any slice reaches the cap', () => {
    const events = [
      sliceTransition({ sessionId: 's1', sliceRid: '001', from: 'qa-handoff', to: 'verdict-issued', artifactRole: 'qa' }),
      sliceTransition({ sessionId: 's1', sliceRid: '001', from: 'verdict-issued', to: 'qa-handoff', artifactRole: 'qa' }),
      sliceTransition({ sessionId: 's1', sliceRid: '001', from: 'qa-handoff', to: 'verdict-issued', artifactRole: 'qa' })
    ];
    const r = aggregateRepairCycles(events);
    expect(r.totalCycles).toBe(3);
    expect(r.cap).toBe(REPAIR_CYCLE_CAP);
    expect(r.capHit).toBe(true);
    expect(r.capHitCount).toBe(1);
  });

  test('counts cycles per slice independently', () => {
    const events = [
      sliceTransition({ sessionId: 's1', sliceRid: '001', from: 'qa-handoff', to: 'verdict-issued', artifactRole: 'qa' }),
      sliceTransition({ sessionId: 's1', sliceRid: '002', from: 'qa-handoff', to: 'verdict-issued', artifactRole: 'qa' }),
      sliceTransition({ sessionId: 's1', sliceRid: '002', from: 'verdict-issued', to: 'qa-handoff', artifactRole: 'qa' })
    ];
    const r = aggregateRepairCycles(events);
    expect(r.totalCycles).toBe(3);
    expect(r.perSlice).toEqual([
      { sliceRid: '001', cycleCount: 1 },
      { sliceRid: '002', cycleCount: 2 }
    ]);
  });
});

describe('period rollup helpers (Slice D setup)', () => {
  test('periodStartIso returns start of UTC day for day', () => {
    const start = periodStartIso('day', () => new Date('2026-06-26T15:30:00Z'));
    expect(start).toBe('2026-06-26T00:00:00.000Z');
  });

  test('periodStartIso returns Monday for week', () => {
    // 2026-06-26 is a Friday — should roll back to Monday 2026-06-22
    const start = periodStartIso('week', () => new Date('2026-06-26T15:30:00Z'));
    expect(start).toBe('2026-06-22T00:00:00.000Z');
  });

  test('periodStartIso returns 1st of month for month', () => {
    const start = periodStartIso('month', () => new Date('2026-06-26T15:30:00Z'));
    expect(start).toBe('2026-06-01T00:00:00.000Z');
  });

  test('filterByPeriod keeps only events on/after start', () => {
    const events = [
      evt({ category: 'slice-transition', sessionId: 's1', sliceRid: '001', ts: '2026-06-25T23:59:59.999Z', detail: { to: 'spec-locked' } }),
      evt({ category: 'slice-transition', sessionId: 's1', sliceRid: '002', ts: '2026-06-26T00:00:00.000Z', detail: { to: 'spec-locked' } }),
      evt({ category: 'slice-transition', sessionId: 's1', sliceRid: '003', ts: '2026-06-26T12:00:00.000Z', detail: { to: 'spec-locked' } })
    ];
    const filtered = filterByPeriod(events, 'day', () => new Date('2026-06-26T15:30:00Z'));
    expect(filtered.map((e) => e.sliceRid)).toEqual(['002', '003']);
  });
});
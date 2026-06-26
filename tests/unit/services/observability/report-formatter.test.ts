/**
 * Tests for `report-formatter.ts` — pure markdown rendering.
 *
 * Slice D of v2.11.1. Snapshot-style: render ReportInput → assert
 * key sections present. No IO; no fs.
 */

import { describe, expect, test } from 'vitest';

import { renderObservabilityReport } from '../../../../src/services/observability/report-formatter.js';
import type {
  FanoutBreakdown,
  Period,
  RepairCycleReport,
  SliceRollup,
  StatusAggregate
} from '../../../../src/services/observability/aggregation.js';

function baseInput(overrides: Partial<Parameters<typeof renderObservabilityReport>[0]> = {}): Parameters<typeof renderObservabilityReport>[0] {
  return {
    scope: 'session',
    scopeId: '2026-06-26-session-test',
    period: 'day' as Period,
    generatedAt: '2026-06-26T10:00:00.000Z',
    status: {
      totalEvents: 0,
      totalSlices: 0,
      successCount: 0,
      failCount: 0,
      repairCyclePeak: 0,
      fanoutCostTotal: 0
    },
    slices: [],
    fanout: {
      total: 0,
      perRole: { 'rd': 0, 'qa': 0, 'code-reviewer': 0, 'security-reviewer': 0, 'karpathy-reviewer': 0 }
    },
    repairCycles: { totalCycles: 0, cap: 3, capHit: false, capHitCount: 0, perSlice: [] },
    ...overrides
  };
}

describe('renderObservabilityReport', () => {
  test('header includes scope, period, generated-at', () => {
    const md = renderObservabilityReport(baseInput());
    expect(md).toContain('# peaks observability report');
    expect(md).toContain('session `2026-06-26-session-test`');
    expect(md).toContain('- **period**: day');
    expect(md).toContain('- **generated at**: 2026-06-26T10:00:00.000Z');
    expect(md).toContain('- **scope marker**: from v2.11.1 install date');
  });

  test('all-sessions scope renders without backticks', () => {
    const md = renderObservabilityReport(baseInput({ scope: 'all-sessions', scopeId: 'all' }));
    expect(md).toContain('**scope**: all sessions');
    expect(md).not.toContain('session `all`');
  });

  test('status summary table shows all 6 metrics', () => {
    const md = renderObservabilityReport(baseInput({
      status: { totalEvents: 10, totalSlices: 3, successCount: 2, failCount: 1, repairCyclePeak: 2, fanoutCostTotal: 4 } as StatusAggregate
    }));
    expect(md).toContain('## Status summary');
    expect(md).toContain('| total events | 10 |');
    expect(md).toContain('| total slices | 3 |');
    expect(md).toContain('| success count | 2 |');
    expect(md).toContain('| fail count | 1 |');
    expect(md).toContain('| repair-cycle peak | 2 |');
    expect(md).toContain('| fanout cost total | 4 |');
  });

  test('empty slices render a placeholder line, not an empty table', () => {
    const md = renderObservabilityReport(baseInput());
    expect(md).toContain('## Slices');
    expect(md).toContain('_No slice transitions recorded for this period._');
  });

  test('slices table includes rid + transitions + final state + duration + success', () => {
    const slices: SliceRollup[] = [
      {
        sliceRid: '001-foo', transitions: 3, firstTs: '2026-06-26T09:00:00.000Z', lastTs: '2026-06-26T09:30:00.000Z',
        durationMs: 30 * 60 * 1000, finalState: 'handed-off', fanoutCount: 0, repairCycleCount: 0, success: true
      },
      {
        sliceRid: '002-bar', transitions: 1, firstTs: '2026-06-26T09:00:00.000Z', lastTs: '2026-06-26T09:00:00.000Z',
        durationMs: 0, finalState: 'blocked', fanoutCount: 0, repairCycleCount: 0, success: false
      }
    ];
    const md = renderObservabilityReport(baseInput({ slices }));
    expect(md).toContain('| 001-foo | 3 | handed-off | 30.0m | ✓ |');
    expect(md).toContain('| 002-bar | 1 | blocked | 0 | ✗ |');
  });

  test('fanout table omits zero-count roles and shows total row', () => {
    const fanout: FanoutBreakdown = {
      total: 5,
      perRole: { 'rd': 2, 'qa': 1, 'code-reviewer': 0, 'security-reviewer': 0, 'karpathy-reviewer': 2 }
    };
    const md = renderObservabilityReport(baseInput({ fanout }));
    expect(md).toContain('| rd | 2 |');
    expect(md).toContain('| qa | 1 |');
    expect(md).toContain('| karpathy-reviewer | 2 |');
    expect(md).not.toContain('| code-reviewer | 0 |');
    expect(md).toContain('| **total** | **5** |');
  });

  test('repair-cycles table shows cap hit flag', () => {
    const cycles: RepairCycleReport = {
      totalCycles: 4,
      cap: 3,
      capHit: true,
      capHitCount: 1,
      perSlice: [{ sliceRid: '001-capped', cycleCount: 4 }]
    };
    const md = renderObservabilityReport(baseInput({ repairCycles: cycles }));
    expect(md).toContain('| 001-capped | 4 |');
    expect(md).toContain('- **cap**: 3');
    expect(md).toContain('- **cap hit**: yes');
    expect(md).toContain('- **slices at cap**: 1');
  });

  test('top-N slowest slices sorted descending by duration', () => {
    const slices: SliceRollup[] = [
      { sliceRid: 'fast', transitions: 1, firstTs: 't1', lastTs: 't2', durationMs: 1000, finalState: 'handed-off', fanoutCount: 0, repairCycleCount: 0, success: true },
      { sliceRid: 'slow', transitions: 5, firstTs: 't1', lastTs: 't2', durationMs: 600_000, finalState: 'handed-off', fanoutCount: 0, repairCycleCount: 0, success: true },
      { sliceRid: 'medium', transitions: 2, firstTs: 't1', lastTs: 't2', durationMs: 30_000, finalState: 'handed-off', fanoutCount: 0, repairCycleCount: 0, success: true }
    ];
    const md = renderObservabilityReport(baseInput({ slices }));
    expect(md).toContain('## Top-5 slowest slices');
    // Search only within the slowest-slices section to avoid matching
    // rows in the earlier full Slices table.
    const sectionStart = md.indexOf('## Top-5 slowest slices');
    const section = md.slice(sectionStart);
    const slowIdx = section.indexOf('| slow |');
    const mediumIdx = section.indexOf('| medium |');
    const fastIdx = section.indexOf('| fast |');
    expect(slowIdx).toBeLessThan(mediumIdx);
    expect(mediumIdx).toBeLessThan(fastIdx);
  });

  test('full integration: non-empty input renders all sections in expected order', () => {
    const md = renderObservabilityReport(baseInput({
      status: { totalEvents: 6, totalSlices: 2, successCount: 1, failCount: 1, repairCyclePeak: 1, fanoutCostTotal: 1 } as StatusAggregate,
      slices: [
        { sliceRid: '001', transitions: 2, firstTs: 't1', lastTs: 't2', durationMs: 60_000, finalState: 'handed-off', fanoutCount: 0, repairCycleCount: 0, success: true }
      ],
      fanout: { total: 1, perRole: { 'rd': 1, 'qa': 0, 'code-reviewer': 0, 'security-reviewer': 0, 'karpathy-reviewer': 0 } },
      repairCycles: { totalCycles: 1, cap: 3, capHit: false, capHitCount: 0, perSlice: [{ sliceRid: '001', cycleCount: 1 }] }
    }));
    const headerIdx = md.indexOf('# peaks observability report');
    const statusIdx = md.indexOf('## Status summary');
    const slicesIdx = md.indexOf('## Slices');
    const fanoutIdx = md.indexOf('## Fanout');
    const cyclesIdx = md.indexOf('## Repair cycles');
    const slowestIdx = md.indexOf('## Top-5 slowest slices');
    expect(headerIdx).toBeLessThan(statusIdx);
    expect(statusIdx).toBeLessThan(slicesIdx);
    expect(slicesIdx).toBeLessThan(fanoutIdx);
    expect(fanoutIdx).toBeLessThan(cyclesIdx);
    expect(cyclesIdx).toBeLessThan(slowestIdx);
  });
});
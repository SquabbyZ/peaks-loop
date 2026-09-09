// tests/unit/services/context/summary-view.test.ts
//
// Slice 2026-09-10-context-audit-and-discipline (Slice B) — the bounded
// `--summary` view.
//
// Defects this pins:
//   1. unbounded dumps — a full `peaks memory reindex --json` array cost
//      ≈ 40K tokens when repeated; `--summary` must stay ≤ 2 KB.
//   2. lying counts — shrinking the view must never falsify the total; the
//      `count` field keeps the true length while `names` shows a prefix.
//   3. shape drift — the summary view is ADDITIVE: the default envelopes are
//      untouched (asserted separately in the CLI test).
//
// Run with:
//   ./node_modules/.bin/vitest run tests/unit/services/context/summary-view.test.ts

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  boundedNames,
  fitSummaryToBytes,
  SUMMARY_INITIAL_NAMES,
  SUMMARY_MAX_BYTES,
} from '~/src/services/context/summary-view';
import { buildMemoryReindexSummary } from '~/src/cli/commands/memory-commands';
import { buildDoctorSummary } from '~/src/cli/commands/core/doctor-command';
import { buildRequestListSummary } from '~/src/cli/commands/request-commands';
import type { MemoryReindexReport } from '~/src/services/memory/project-memory-service';

declareDimensions(
  'tests/unit/services/context/summary-view.test.ts',
  ['behavior', 'render'],
  [
    { dim: 'integration', reason: 'pure functions over in-memory objects; no fs / subprocess' },
    { dim: 'a11y', reason: 'no human-visible surface beyond the JSON envelope asserted here' },
  ],
);

/** Size AS PRINTED — the CLI serializes with `null, 2`. */
const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value, null, 2) ?? '', 'utf8');

describe('behavior — boundedNames', () => {
  it('when given many names, should keep the true count and cap the prefix', () => {
    const names = Array.from({ length: 500 }, (_, i) => `memory-${i}`);
    const view = boundedNames(names);
    expect(view.count).toBe(500);
    expect(view.names).toHaveLength(SUMMARY_INITIAL_NAMES);
    expect(view.names[0]).toBe('memory-0');
  });

  it('when a name is very long, should clip it to the label cap', () => {
    const view = boundedNames(['x'.repeat(500)]);
    expect(view.names[0]?.length).toBeLessThanOrEqual(120);
    expect(view.names[0]?.endsWith('…')).toBe(true);
  });
});

describe('behavior — fitSummaryToBytes', () => {
  it('when the object already fits, should return it unchanged', () => {
    const small = { view: 'summary', count: 3, names: ['a', 'b', 'c'] };
    expect(fitSummaryToBytes(small)).toEqual(small);
  });

  it('when the object is far over budget, should shrink string arrays until it fits', () => {
    // given: a 2000-name array nested two levels deep
    const big = {
      view: 'summary',
      count: 2000,
      nested: { names: Array.from({ length: 2000 }, (_, i) => `entry-${i}-${'y'.repeat(40)}`) },
    };

    // when: the fitter runs
    const out = fitSummaryToBytes(big);

    // then: ≤ 2 KB, scalars untouched, array shorter
    expect(bytes(out)).toBeLessThanOrEqual(SUMMARY_MAX_BYTES);
    expect(out.count).toBe(2000);
    expect((out.nested as { names: string[] }).names.length).toBeLessThan(2000);
  });

  it('when no array can be shrunk, should return the input without throwing', () => {
    const noArrays = { view: 'summary', count: 1, note: 'z'.repeat(3000) };
    expect(() => fitSummaryToBytes(noArrays)).not.toThrow();
  });
});

describe('render — command summary builders stay ≤ 2 KB and keep counts', () => {
  it('when a reindex report has 300 unclassified files, should bound the summary', () => {
    const report: MemoryReindexReport = {
      apply: false,
      projectRoot: '/repo',
      memoryDir: '/repo/.peaks/memory',
      indexPath: '/repo/.peaks/memory/index.json',
      memoryMdPath: '/repo/.peaks/memory/MEMORY.md',
      scannedFiles: 400,
      indexed: 100,
      indexedByKind: { rule: 50, decision: 50 },
      unclassified: Array.from({ length: 300 }, (_, i) => ({
        name: `stray-${i}`,
        filePath: `/repo/.peaks/memory/${'deep/'.repeat(6)}stray-${i}.md`,
        rawKind: null,
        reason: 'no resolvable kind',
      })),
      nameConflicts: Array.from({ length: 40 }, (_, i) => ({ name: `dup-${i}`, filePaths: ['a', 'b'] })),
      orphanIndex: Array.from({ length: 60 }, (_, i) => ({ name: `gone-${i}`, kind: 'rule', sourcePath: '/x' })),
      orphanDisk: Array.from({ length: 60 }, (_, i) => `/repo/.peaks/memory/orphan-${i}.md`),
      memoryMd: { path: '/repo/.peaks/memory/MEMORY.md', regenerated: false },
      writtenFiles: ['/repo/.peaks/memory/MEMORY.md'],
    };

    const view = buildMemoryReindexSummary(report);

    expect(bytes(view)).toBeLessThanOrEqual(SUMMARY_MAX_BYTES);
    expect(view.view).toBe('summary');
    expect(view.scannedFiles).toBe(400);
    expect(view.indexed).toBe(100);
    expect((view.unclassified as { count: number }).count).toBe(300);
    expect((view.unclassified as { names: string[] }).names.length).toBeGreaterThan(0);
    expect((view.orphanDisk as { count: number }).count).toBe(60);
  });

  it('when a doctor report has 200 checks, should bound the summary', () => {
    const checks = Array.from({ length: 200 }, (_, i) => ({
      id: `l3:check-${i}`,
      ok: i % 3 !== 0,
      message: `check ${i} ${'m'.repeat(120)}`,
      severity: i % 3 === 0 ? 'error' : 'warning',
    }));
    const view = buildDoctorSummary({
      checks,
      summary: { ok: false, passed: 133, failed: 67, warnings: 133 },
      staleBinding: { ttlMs: 300000, staleCount: 4, staleInstances: new Array(4).fill({ sid: 's' }), droppedCount: 1, droppedSids: ['s1'] },
    });

    expect(bytes(view)).toBeLessThanOrEqual(SUMMARY_MAX_BYTES);
    expect(view.view).toBe('summary');
    expect(view.summary).toEqual({ ok: false, passed: 133, failed: 67, warnings: 133 });
    expect((view.checks as { count: number }).count).toBe(200);
    expect((view.failed as { count: number }).count).toBe(67);
    expect((view.staleBinding as { staleCount: number }).staleCount).toBe(4);
  });

  it('when a request list has 150 items, should bound the summary and keep the total', () => {
    const items = Array.from({ length: 150 }, (_, i) => ({
      role: 'rd' as const,
      sessionId: '2026-09-10-session-abcdef',
      requestId: `2026-09-10-request-${i}`,
      path: `/repo/.peaks/_runtime/2026-09-10-session-abcdef/rd/requests/2026-09-10-request-${i}.md`,
      state: 'rd-handoff',
      requestType: 'feature' as const,
    }));

    const view = buildRequestListSummary(items);

    expect(bytes(view)).toBeLessThanOrEqual(SUMMARY_MAX_BYTES);
    expect(view.view).toBe('summary');
    expect(view.count).toBe(150);
    expect((view.items as { count: number }).count).toBe(150);
    expect((view.items as { names: string[] }).names[0]).toContain('2026-09-10-request-0');
  });
});

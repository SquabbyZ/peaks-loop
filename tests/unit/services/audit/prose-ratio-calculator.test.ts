/**
 * Prose-ratio-calculator unit tests — Slice C Group G3 (v2.14.0).
 *
 * Verifies the ratio math + informational exclusion (per A3.1:
 * ratio ≤ 5% excludes `informational: true` entries). 9 cases.
 */
import { describe, it, expect } from 'vitest';
import {
  computeProseRatio,
  DEFAULT_PROSE_RATIO_TARGET,
} from '../../../../src/services/audit/prose-ratio-calculator.js';
import type { RedLineEntry } from '../../../../src/services/audit/types.js';

function makeEntry(opts: {
  backing: 'cli-backed' | 'partial' | 'prose-only';
  informational?: boolean;
  id?: string;
}): RedLineEntry {
  return {
    id: opts.id ?? 'rl-test-001',
    rule: 'test rule',
    source: { file: 'test.md', line: 1, marker: 'MANDATORY', context: 'test context' },
    backing: opts.backing,
    enforcerRef: opts.backing === 'cli-backed' ? 'src/test.ts' : null,
    ...(opts.informational ? { informational: true } : {}),
  };
}

describe('computeProseRatio', () => {
  it('case 1: empty input returns zero ratio and exceeds=false', () => {
    const r = computeProseRatio([]);
    expect(r.totalRedLines).toBe(0);
    expect(r.proseOnly).toBe(0);
    expect(r.ratio).toBe(0);
    expect(r.exceeds).toBe(false);
  });

  it('case 2: all cli-backed gives 0% ratio', () => {
    const r = computeProseRatio([
      makeEntry({ backing: 'cli-backed' }),
      makeEntry({ backing: 'cli-backed' }),
    ]);
    expect(r.cliBacked).toBe(2);
    expect(r.proseOnly).toBe(0);
    expect(r.ratio).toBe(0);
    expect(r.exceeds).toBe(false);
  });

  it('case 3: 1 prose-only out of 20 = 5.0% (at threshold, not exceeds)', () => {
    const entries: RedLineEntry[] = [];
    for (let i = 0; i < 19; i += 1) entries.push(makeEntry({ backing: 'cli-backed', id: `rl-cli-${i}` }));
    entries.push(makeEntry({ backing: 'prose-only', id: 'rl-prose-1' }));
    const r = computeProseRatio(entries);
    expect(r.totalRedLines).toBe(20);
    expect(r.proseOnly).toBe(1);
    expect(r.ratio).toBe(0.05);
    // 5% is NOT > 5% — at-threshold is OK
    expect(r.exceeds).toBe(false);
  });

  it('case 4: 1 prose-only out of 19 = 5.26% exceeds threshold', () => {
    const entries: RedLineEntry[] = [];
    for (let i = 0; i < 18; i += 1) entries.push(makeEntry({ backing: 'cli-backed', id: `rl-cli-${i}` }));
    entries.push(makeEntry({ backing: 'prose-only', id: 'rl-prose-1' }));
    const r = computeProseRatio(entries);
    expect(r.ratio).toBeCloseTo(1 / 19, 5);
    expect(r.ratio).toBeGreaterThan(0.05);
    expect(r.exceeds).toBe(true);
  });

  it('case 5: informational entries are excluded from proseOnly count', () => {
    const r = computeProseRatio([
      makeEntry({ backing: 'prose-only', informational: true, id: 'rl-info-1' }),
      makeEntry({ backing: 'prose-only', informational: true, id: 'rl-info-2' }),
      makeEntry({ backing: 'prose-only', informational: true, id: 'rl-info-3' }),
      makeEntry({ backing: 'prose-only', id: 'rl-real-1' }),
    ]);
    expect(r.totalRedLines).toBe(4);
    expect(r.informational).toBe(3);
    expect(r.proseOnly).toBe(1);
    expect(r.ratio).toBe(0.25);
  });

  it('case 6: all informational gives 0% ratio (the v2.12.1 reform case)', () => {
    const r = computeProseRatio([
      makeEntry({ backing: 'prose-only', informational: true }),
      makeEntry({ backing: 'prose-only', informational: true }),
    ]);
    expect(r.informational).toBe(2);
    expect(r.proseOnly).toBe(0);
    expect(r.ratio).toBe(0);
    expect(r.exceeds).toBe(false);
  });

  it('case 7: partial entries counted in partial, not proseOnly', () => {
    const r = computeProseRatio([
      makeEntry({ backing: 'partial' }),
      makeEntry({ backing: 'partial' }),
      makeEntry({ backing: 'cli-backed' }),
    ]);
    expect(r.partial).toBe(2);
    expect(r.cliBacked).toBe(1);
    expect(r.proseOnly).toBe(0);
    expect(r.ratio).toBe(0);
  });

  it('case 8: default target is 0.05 (5%) per A3.1', () => {
    expect(DEFAULT_PROSE_RATIO_TARGET).toBe(0.05);
  });

  it('case 9: custom target via options.target', () => {
    const r = computeProseRatio(
      [makeEntry({ backing: 'prose-only' }), makeEntry({ backing: 'cli-backed' })],
      { target: 0.5 }
    );
    expect(r.target).toBe(0.5);
    expect(r.ratio).toBe(0.5);
    // 0.5 is NOT > 0.5
    expect(r.exceeds).toBe(false);
  });
});

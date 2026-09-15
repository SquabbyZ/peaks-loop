// tests/unit/services/audit/prose-ratio-calculator.test.ts
//
// A8 of the 2026-09-15 diagnosis: the audit reported `proseOnly: 0` while
// the same JSON carried 44 rows with `"backing": "prose-only"`. The
// excluded rows were those the classifier had labelled `informational`.
// These cases pin the corrected accounting: `informational` is a label,
// never a denominator.

import { describe, expect, it } from 'vitest';

import { computeProseRatio } from '../../../../src/services/audit/prose-ratio-calculator.js';
import type { RedLineBacking, RedLineEntry } from '../../../../src/services/audit/types.js';

function entry(backing: RedLineBacking, informational?: boolean): RedLineEntry {
  return {
    id: `rl-${backing}-${informational === true ? 'info' : 'plain'}-${Math.random().toString(36).slice(2, 8)}`,
    rule: 'a rule',
    source: { file: 'skills/x/SKILL.md', line: 1, marker: 'BLOCKING', context: '' },
    backing,
    enforcerRef: null,
    ...(informational === undefined ? {} : { informational }),
  };
}

describe('computeProseRatio', () => {
  it('when an informational row is prose-only, should count it in proseOnly', () => {
    // given: one prose-only row carrying the informational label
    const entries = [entry('prose-only', true)];

    // when: the ratio is computed
    const result = computeProseRatio(entries);

    // then: it is counted — the label does not remove it
    expect(result.proseOnly).toBe(1);
    expect(result.ratio).toBe(1);
  });

  it('when informational and plain prose-only rows are mixed, should count both', () => {
    // given: 3 informational + 2 plain prose-only rows
    const entries = [
      entry('prose-only', true),
      entry('prose-only', true),
      entry('prose-only', true),
      entry('prose-only'),
      entry('prose-only'),
    ];

    // when: the ratio is computed
    const result = computeProseRatio(entries);

    // then: proseOnly is 5, not the 2 that the pre-A8 numerator produced
    expect(result.proseOnly).toBe(5);
    expect(result.discoveredProseOnly).toBe(3);
    expect(result.ratio).toBe(1);
  });

  it('when the denominator changes, should divide by every entry', () => {
    // given: 2 prose-only rows among 8 total
    const entries = [
      entry('prose-only', true),
      entry('prose-only'),
      entry('cli-backed'),
      entry('cli-backed'),
      entry('cli-backed'),
      entry('cli-backed'),
      entry('partial'),
      entry('partial'),
    ];

    // when: the ratio is computed
    const result = computeProseRatio(entries);

    // then: ratio uses entries.length, including the informational row
    expect(result.totalRedLines).toBe(8);
    expect(result.proseOnly).toBe(2);
    expect(result.ratio).toBe(0.25);
    expect(result.exceeds).toBe(true);
  });

  it('when the target is not exceeded, should report exceeds false', () => {
    // given: 1 prose-only row among 100 entries against the 5% default
    const entries = [entry('prose-only'), ...Array.from({ length: 99 }, () => entry('cli-backed'))];

    // when: the ratio is computed
    const result = computeProseRatio(entries);

    // then: 1% is within the 5% default target
    expect(result.ratio).toBeCloseTo(0.01, 10);
    expect(result.exceeds).toBe(false);
  });

  it('when there are no entries, should return a zero ratio', () => {
    // given: an empty catalog
    // when: the ratio is computed
    const result = computeProseRatio([]);

    // then: no division by zero
    expect(result.totalRedLines).toBe(0);
    expect(result.ratio).toBe(0);
    expect(result.exceeds).toBe(false);
  });

  it('when informational rows are cli-backed, should not move proseOnly', () => {
    // given: an informational row whose backing is cli-backed
    const entries = [entry('cli-backed', true)];

    // when: the ratio is computed
    const result = computeProseRatio(entries);

    // then: it is counted as informational and as cli-backed, never as prose-only
    expect(result.informational).toBe(1);
    expect(result.cliBacked).toBe(1);
    expect(result.proseOnly).toBe(0);
    expect(result.discoveredProseOnly).toBe(0);
  });
});

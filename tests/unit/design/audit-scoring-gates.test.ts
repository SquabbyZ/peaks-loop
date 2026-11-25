import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type { AuditFinding } from '../../../src/services/design/audit/audit-finding.js';
import {
  isLowSample,
  scoreDimension,
  type DimensionScore
} from '../../../src/services/design/audit/audit-scoring.js';

declareDimensions('tests/unit/design/audit-scoring-gates.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const RATIO = { kind: 'ratio' } as const;
const COST = { kind: 'cost' } as const;

function finding(severity: AuditFinding['severity']): AuditFinding {
  return {
    dimension: 'spacing',
    severity,
    file: 'page.tsx',
    line: 1,
    value: '13px',
    expected: '12',
    humanText: '第 1 行不在刻度上。',
    techText: 'page.tsx:1 padding:13px not in tokenScale.space'
  };
}

function row(severity: AuditFinding['severity']): DimensionScore {
  return scoreDimension('spacing', [finding(severity)], { measured: 0, onContract: 0 });
}

describe('Scenario: behavior — the low-sample gate needs a ratio rule and a small sample', () => {
  it('when the rule kind and measured count vary, should flag only small ratio samples', () => {
    // given: ratio and cost rules measured at zero, one, four and five values
    // when: each combination is checked
    // then: only a ratio judged between one and four values is low-sample
    expect(isLowSample(RATIO, 0)).toBe(false);
    expect(isLowSample(RATIO, 1)).toBe(true);
    expect(isLowSample(RATIO, 4)).toBe(true);
    expect(isLowSample(RATIO, 5)).toBe(false);
    expect(isLowSample(COST, 1)).toBe(false);
  });
});

describe('Scenario: render — a ratio row reports whether it judged anything', () => {
  it('when a ratio row has no values and no findings, should be unjudged', () => {
    // given: a ratio dimension with measured 0 and no findings
    // when: the row is scored
    // then: judged is false and the ratio score is null, never 100
    const empty = scoreDimension('spacing', [], { measured: 0, onContract: 0 });
    expect(empty.judged).toBe(false);
    expect(empty.score).toBeNull();
  });

  it('when a ratio row has measured values or findings, should be judged', () => {
    // given: a row with measured values and no findings, and a row with one unmeasured finding
    // when: both are scored
    // then: either signal marks the row as judged
    const measured = scoreDimension('spacing', [], { measured: 4, onContract: 2 });
    expect(measured.judged).toBe(true);
    expect(measured.score).toBe(50);
    expect(row('unmeasured').judged).toBe(true);
  });

  it('when a cost row has hard and soft findings, should lose its documented cost', () => {
    // given: a cost row with one hard and one soft finding
    // when: it is scored
    // then: the base score minus both costs is reported, never below zero
    const scored = scoreDimension('contrast', [finding('hard'), finding('soft')]);
    expect(scored.score).toBeLessThan(100);
    expect(scored.score).toBeGreaterThanOrEqual(0);
    expect(scored.judged).toBe(true);
    expect(scored.measured).toBe(0);
  });
});

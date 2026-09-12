// tests/unit/services/codegraph/codegraph-exclude-integrity.test.ts
//
// 4-dimension unit test for the render half of
// `src/services/codegraph/codegraph-exclude-integrity.ts` (slice S2 of
// rid-2026-09-12-codegraph-exclude-integrity).
//
// The inspector itself is exercised end-to-end against real temp git
// work trees in `tests/unit/cli/codegraph-status-integrity.test.ts` and
// `tests/unit/services/codegraph/codegraph-exclude-repair.test.ts`. What
// is left — and what this file pins — is the pure rendering decision:
// a clean report must produce NO lines (the status command must not
// print a success banner nobody asked for), a gapped report must
// produce a bounded, locatable one, and the exit code must stay
// non-zero and distinct from the other codegraph codes.
//
// NOTE: glob literals contain the two-character sequence that ends a
// block comment, so every comment in this file uses `//` lines.
//
// Run with: pnpm vitest run tests/unit/services/codegraph/codegraph-exclude-integrity.test.ts

import { describe, expect, it } from 'vitest';

import {
  CODEGRAPH_INTEGRITY_EXIT_CODE,
  renderCodegraphExcludeIntegrityLines,
  type CodegraphExcludeIntegrityReport,
} from '../../../../src/services/codegraph/codegraph-exclude-integrity.js';
import { CODEGRAPH_INIT_CONFLICT_EXIT_CODE } from '../../../../src/services/codegraph/codegraph-service.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/services/codegraph/codegraph-exclude-integrity.test.ts', [
  'render',
  'behavior',
  'a11y',
], [
  {
    dim: 'integration',
    reason:
      'the inspector runs against real git work trees in codegraph-exclude-repair.test.ts and codegraph-status-integrity.test.ts; this file covers the pure renderer it feeds',
  },
]);

function makeReport(overrides: Partial<CodegraphExcludeIntegrityReport> = {}): CodegraphExcludeIntegrityReport {
  return {
    configPath: '/tmp/project/.codegraph/config.json',
    gap: false,
    trackedSourceCount: 1117,
    excludedTrackedCount: 0,
    violations: [],
    rulesToRemove: [],
    ruleImpacts: [],
    ...overrides,
  };
}

function makeViolations(count: number): CodegraphExcludeIntegrityReport['violations'] {
  return Array.from({ length: count }, (_unused, index) => ({
    path: `src/blocked/file-${index}.ts`,
    matchedRule: '**/artifacts/**',
  }));
}

describe('renderCodegraphExcludeIntegrityLines', () => {
  it('should print nothing at all for a clean report', () => {
    expect(renderCodegraphExcludeIntegrityLines(makeReport())).toEqual([]);
  });

  it('should lead with the gap size, then the rules, then the blocked files', () => {
    const lines = renderCodegraphExcludeIntegrityLines(
      makeReport({
        gap: true,
        excludedTrackedCount: 26,
        rulesToRemove: ['**/artifacts/**'],
        ruleImpacts: [{ rule: '**/artifacts/**', blockedCount: 26 }],
        violations: makeViolations(2),
      })
    );

    expect(lines[0]).toBe(
      '[FAIL] codegraph index is incomplete: 26 of 1117 tracked source files are excluded by 1 rule(s).'
    );
    expect(lines[1]).toContain('rule **/artifacts/** blocks 26 tracked file(s)');
    expect(lines[2]).toContain('excluded: src/blocked/file-0.ts <- **/artifacts/**');
    // The fix is always named, so an operator never has to guess.
    expect(lines[lines.length - 1]).toContain('peaks codegraph repair-exclude');
  });

  it('should bound the detail and say how much it elided', () => {
    const lines = renderCodegraphExcludeIntegrityLines(
      makeReport({
        gap: true,
        excludedTrackedCount: 40,
        rulesToRemove: Array.from({ length: 12 }, (_unused, index) => `**/rule-${index}/**`),
        ruleImpacts: Array.from({ length: 12 }, (_unused, index) => ({
          rule: `**/rule-${index}/**`,
          blockedCount: 1,
        })),
        violations: makeViolations(30),
      })
    );

    const text = lines.join('\n');
    expect(text).toContain('… and 2 more rule(s)');
    expect(text).toContain('… and 20 more file/rule pair(s)');
    // Bounded: 10 rules + 10 violations + headline + elisions + fix line.
    expect(lines.length).toBeLessThan(30);
  });
});

describe('CODEGRAPH_INTEGRITY_EXIT_CODE', () => {
  it('should be non-zero so a shell can gate on it', () => {
    expect(CODEGRAPH_INTEGRITY_EXIT_CODE).not.toBe(0);
  });

  it('should stay distinct from the init-conflict code so CI can tell them apart', () => {
    expect(CODEGRAPH_INTEGRITY_EXIT_CODE).not.toBe(CODEGRAPH_INIT_CONFLICT_EXIT_CODE);
  });
});

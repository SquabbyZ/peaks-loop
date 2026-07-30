// packages/peaks-loop-mut/tests/thresholds.test.ts
//
// 4-dimension unit test for peaks-loop-mut's pure threshold + types
// surface (src/services/mut/thresholds.ts + src/services/mut/types.ts)
// and the real-fs read in src/services/mut/report-loader.ts).
//
// `declareDimensions` is inlined here because the root helper at
// tests/unit/_setup/4dim-template.ts lives behind a '~' vitest alias
// (see vitest.config.ts in the main package). Workspace-package
// vitest configs do not inherit that alias, so importing the root
// helper by relative path would force a 4-level '..' that breaks
// any time the test moves. The 5-line duplication is intentional.
//
// Dimensions covered:
//   - render:    DEFAULT_THRESHOLDS shape + frozen; WeakPattern union
//                has the 5 documented values; MutReportSchema accepts
//                a minimal valid envelope
//   - behavior:  evaluateThresholds pass / fail / both-violated / boundary
//                semantics; MutReportSchema rejects invalid versions,
//                non-hex sha256, out-of-range killRate
//   - integration: loadMutReport returns null on missing file, null on
//                  corrupt JSON, null on schema-invalid, the parsed
//                  report on schema-valid (real fs reads in tmp)
//   - a11y:      not applicable — no user-facing text surface
//
// Run with: pnpm --filter peaks-loop-mut test

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Dim = 'render' | 'behavior' | 'integration' | 'a11y';
function declareDimensions(
  _file: string,
  covered: readonly Dim[],
  omitted: ReadonlyArray<{ dim: Dim; reason: string }> = [],
): void {
  const ALL: readonly Dim[] = ['render', 'behavior', 'integration', 'a11y'];
  const coveredSet = new Set(covered);
  const missing = ALL.filter((d) => !coveredSet.has(d) && !omitted.find((o) => o.dim === d));
  if (missing.length > 0) {
    throw new Error(`[${_file}] missing dimensions ${missing.join(', ')}; add a describe(...) or pass an omitted[] entry.`);
  }
}

declareDimensions(
  'packages/peaks-loop-mut/tests/thresholds.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'no user-facing text or exit code' }],
);

import {
  DEFAULT_THRESHOLDS,
  evaluateThresholds,
} from '../src/services/mut/thresholds.js';
import { loadMutReport, mutReportPath, MUT_REPORT_RELATIVE_PATH } from '../src/services/mut/report-loader.js';
import { MutReportSchema, WeakPatternSchema } from '../src/services/mut/types.js';

// We deliberately do NOT use withTmpWorkspacePerTest here: mut is a
// workspace package whose tests are run from packages/peaks-loop-mut/
// (vitest root), and the file we read is computed RELATIVE to
// process.cwd(). loadMutReport joins '.peaks', '_runtime', sessionId,
// and the relative path under process.cwd(). chdir-ing via the root
// helper would put us in a directory that has no `.peaks/` to read.
// Instead we plant the file in a deterministic relative path under
// the package root and chdir into its parent before each test.

const TMP_PARENT = join(process.cwd(), '.tmp-mut-test');

function validMinimalReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: '1.0',
    sha256: 'a'.repeat(64),
    generatedAt: '2026-07-30T00:00:00.000Z',
    inputSig: 'b'.repeat(64),
    mutation: {
      tool: 'stryker',
      mutantsTotal: 10,
      mutantsKilled: 8,
      mutantsSurvived: 2,
      mutantsTimeout: 0,
      killRate: 0.8,
      byFile: [],
    },
    assertions: {
      totalAssertions: 100,
      weakAssertions: 3,
      weakRate: 0.03,
      weakPatterns: [],
    },
    thresholds: {
      mutationKillRateMin: 0.8,
      weakAssertionRateMax: 0.05,
      passed: true,
    },
    followups: [],
    ...overrides,
  };
}

describe('render — DEFAULT_THRESHOLDS + WeakPattern + MutReportSchema', () => {
  it('DEFAULT_THRESHOLDS is frozen and has the documented values', () => {
    expect(Object.isFrozen(DEFAULT_THRESHOLDS)).toBe(true);
    expect(DEFAULT_THRESHOLDS.mutationKillRateMin).toBe(0.80);
    expect(DEFAULT_THRESHOLDS.weakAssertionRateMax).toBe(0.05);
  });

  it('WeakPatternSchema accepts the 5 documented patterns', () => {
    for (const p of ['toBeDefined', 'toBeTruthy', 'toEqual-self', 'expect-anything', 'toBe-self']) {
      expect(WeakPatternSchema.safeParse(p).success).toBe(true);
    }
  });

  it('WeakPatternSchema rejects unknown patterns', () => {
    expect(WeakPatternSchema.safeParse('not-a-pattern').success).toBe(false);
  });

  it('MutReportSchema accepts a minimal valid envelope', () => {
    const out = MutReportSchema.safeParse(validMinimalReport());
    expect(out.success).toBe(true);
  });

  it('MUT_REPORT_RELATIVE_PATH is the documented path', () => {
    expect(MUT_REPORT_RELATIVE_PATH).toBe('mut/mut-report.json');
  });
});

describe('render — mutReportPath composition', () => {
  it('mutReportPath composes .peaks/_runtime/<sid>/mut/mut-report.json with POSIX separators', () => {
    expect(mutReportPath('sid-1')).toBe('.peaks/_runtime/sid-1/mut/mut-report.json');
  });
});

describe('behavior — evaluateThresholds', () => {
  it('passes when both actuals are within the limits', () => {
    const out = evaluateThresholds(DEFAULT_THRESHOLDS, 0.85, 0.02);
    expect(out.passed).toBe(true);
    expect(out.violations).toEqual([]);
  });

  it('fails when actualKillRate < mutationKillRateMin (the only violation)', () => {
    const out = evaluateThresholds(DEFAULT_THRESHOLDS, 0.5, 0.02);
    expect(out.passed).toBe(false);
    expect(out.violations).toHaveLength(1);
    expect(out.violations[0]?.kind).toBe('mutationKillRateMin');
    expect(out.violations[0]?.actual).toBe(0.5);
    expect(out.violations[0]?.threshold).toBe(0.80);
  });

  it('fails when actualWeakRate > weakAssertionRateMax (the only violation)', () => {
    const out = evaluateThresholds(DEFAULT_THRESHOLDS, 0.85, 0.10);
    expect(out.passed).toBe(false);
    expect(out.violations).toHaveLength(1);
    expect(out.violations[0]?.kind).toBe('weakAssertionRateMax');
  });

  it('reports both violations when both are out of bounds', () => {
    const out = evaluateThresholds(DEFAULT_THRESHOLDS, 0.5, 0.10);
    expect(out.passed).toBe(false);
    expect(out.violations).toHaveLength(2);
  });

  it('boundary: actualKillRate == mutationKillRateMin is in-budget (no violation)', () => {
    const out = evaluateThresholds(DEFAULT_THRESHOLDS, 0.80, 0.02);
    expect(out.passed).toBe(true);
  });

  it('boundary: actualWeakRate == weakAssertionRateMax is in-budget (no violation)', () => {
    const out = evaluateThresholds(DEFAULT_THRESHOLDS, 0.85, 0.05);
    expect(out.passed).toBe(true);
  });

  it('honors a custom Thresholds object', () => {
    const out = evaluateThresholds(
      { mutationKillRateMin: 0.99, weakAssertionRateMax: 0.01 },
      0.98,
      0.005,
    );
    expect(out.passed).toBe(false);
    expect(out.violations[0]?.threshold).toBe(0.99);
  });
});

describe('behavior — MutReportSchema rejects invalid input', () => {
  it('rejects non-1.0 versions', () => {
    const out = MutReportSchema.safeParse(validMinimalReport({ version: '2.0' }));
    expect(out.success).toBe(false);
  });

  it('rejects sha256 that is not 64 hex chars', () => {
    const out = MutReportSchema.safeParse(validMinimalReport({ sha256: 'tooshort' }));
    expect(out.success).toBe(false);
  });

  it('rejects killRate > 1', () => {
    const out = MutReportSchema.safeParse(validMinimalReport({
      mutation: {
        tool: 'stryker',
        mutantsTotal: 10, mutantsKilled: 8, mutantsSurvived: 2, mutantsTimeout: 0,
        killRate: 1.5,
        byFile: [],
      },
    }));
    expect(out.success).toBe(false);
  });

  it('rejects killRate < 0', () => {
    const out = MutReportSchema.safeParse(validMinimalReport({
      mutation: {
        tool: 'stryker',
        mutantsTotal: 10, mutantsKilled: 8, mutantsSurvived: 2, mutantsTimeout: 0,
        killRate: -0.1,
        byFile: [],
      },
    }));
    expect(out.success).toBe(false);
  });

  it('rejects unknown mutation tool', () => {
    const out = MutReportSchema.safeParse(validMinimalReport({
      mutation: {
        tool: 'not-a-tool',
        mutantsTotal: 10, mutantsKilled: 8, mutantsSurvived: 2, mutantsTimeout: 0,
        killRate: 0.8,
        byFile: [],
      },
    }));
    expect(out.success).toBe(false);
  });
});

describe('integration — loadMutReport over real fs', () => {
  beforeEach(() => {
    mkdirSync(TMP_PARENT, { recursive: true });
    process.chdir(TMP_PARENT);
  });

  afterEach(() => {
    process.chdir(join(TMP_PARENT, '..'));
  });

  it('returns null when the report file does not exist', async () => {
    const out = await loadMutReport('no-such-sid');
    expect(out).toBeNull();
  });

  it('returns null for corrupt JSON (writes a stderr line, but no throw)', async () => {
    const sid = 'corrupt-sid';
    const dir = join(TMP_PARENT, '.peaks', '_runtime', sid, 'mut');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'mut-report.json'), 'not valid json {', 'utf8');

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const out = await loadMutReport(sid);
      expect(out).toBeNull();
      expect(stderrSpy).toHaveBeenCalled();
      const msg = String(stderrSpy.mock.calls[0]?.[0] ?? '');
      expect(msg).toMatch(/not valid JSON/);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('returns null for schema-invalid JSON (writes a stderr line)', async () => {
    const sid = 'invalid-sid';
    const dir = join(TMP_PARENT, '.peaks', '_runtime', sid, 'mut');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'mut-report.json'), JSON.stringify({ version: '2.0' }), 'utf8');

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const out = await loadMutReport(sid);
      expect(out).toBeNull();
      expect(stderrSpy).toHaveBeenCalled();
      const msg = String(stderrSpy.mock.calls[0]?.[0] ?? '');
      expect(msg).toMatch(/failed schema validation/);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('returns the parsed report for a schema-valid file', async () => {
    const sid = 'valid-sid';
    const dir = join(TMP_PARENT, '.peaks', '_runtime', sid, 'mut');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'mut-report.json'), JSON.stringify(validMinimalReport()), 'utf8');

    const out = await loadMutReport(sid);
    expect(out).not.toBeNull();
    expect(out?.version).toBe('1.0');
    expect(out?.mutation.killRate).toBe(0.8);
  });
});

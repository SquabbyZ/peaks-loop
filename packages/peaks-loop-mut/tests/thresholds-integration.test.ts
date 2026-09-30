// packages/peaks-loop-mut/tests/thresholds-integration.test.ts
//
// Integration half of the former `thresholds.test.ts` (split for the 300-line
// file cap). Covers ONLY the `integration` dimension: loadMutReport's real-fs
// read in src/services/mut/report-loader.ts. The render + behavior dimensions
// stay in thresholds.test.ts.
//
// `declareDimensions` is inlined here for the same reason as the sibling — the
// root helper at tests/unit/_setup/4dim-template.ts lives behind a '~' vitest
// alias (main package only) and workspace-package vitest configs do not inherit
// it, so importing by relative path would force a 4-level '..'. The 5-line
// duplication is intentional.
//
// Run with: pnpm --filter peaks-loop-mut test

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Dim = 'render' | 'behavior' | 'integration' | 'a11y';
function declareDimensions(
  _file: string,
  covered: readonly Dim[],
  omitted: ReadonlyArray<{ dim: Dim; reason: string }> = []
): void {
  const ALL: readonly Dim[] = ['render', 'behavior', 'integration', 'a11y'];
  const coveredSet = new Set(covered);
  const missing = ALL.filter((d) => !coveredSet.has(d) && !omitted.find((o) => o.dim === d));
  if (missing.length > 0) {
    throw new Error(
      `[${_file}] missing dimensions ${missing.join(', ')}; add a describe(...) or pass an omitted[] entry.`
    );
  }
}

declareDimensions(
  'packages/peaks-loop-mut/tests/thresholds-integration.test.ts',
  ['integration'],
  [
    { dim: 'render', reason: 'covered by thresholds.test.ts' },
    { dim: 'behavior', reason: 'covered by thresholds.test.ts' },
    { dim: 'a11y', reason: 'no user-facing text or exit code' }
  ]
);

import { loadMutReport } from '../src/services/mut/report-loader.js';

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
      byFile: []
    },
    assertions: {
      totalAssertions: 100,
      weakAssertions: 3,
      weakRate: 0.03,
      weakPatterns: []
    },
    thresholds: {
      mutationKillRateMin: 0.8,
      weakAssertionRateMax: 0.05,
      passed: true
    },
    followups: [],
    ...overrides
  };
}

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

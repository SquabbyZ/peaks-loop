// packages/peaks-loop-mut/tests/report-builder.test.ts
//
// The evaluated-axis half of buildMutReport. `peaks mut asserts` scans
// assertions only and writes an EMPTY mutation block; the shared threshold
// evaluation used to fail it unconditionally on `killRate 0 < 0.8`, so a
// clean assertion scan still reported `passed: false`. These tests pin the
// mode split: `asserts` decides on the weak-assertion rate alone, while
// `run` (and any caller that omits the mode) keeps the mutation gate.
//
// `declareDimensions` is inlined for the same reason as the sibling
// threshold tests — workspace-package vitest configs do not inherit the
// root '~' alias.
//
// Run with: pnpm --filter peaks-loop-mut test

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
  'packages/peaks-loop-mut/tests/report-builder.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'no UI surface; the sibling threshold tests cover the schema' },
    { dim: 'a11y', reason: 'no user-facing text or exit code' }
  ]
);

import { buildMutReport } from '../src/services/mut/report-builder.js';
import type { AssertionsReport, MutationReport } from '../src/services/mut/types.js';

const HEX_SIG = 'b'.repeat(64);

function emptyMutation(): MutationReport {
  return {
    tool: 'stryker',
    mutantsTotal: 0,
    mutantsKilled: 0,
    mutantsSurvived: 0,
    mutantsTimeout: 0,
    killRate: 0,
    byFile: []
  };
}

function mutationWith(killRate: number): MutationReport {
  return {
    tool: 'stryker',
    mutantsTotal: 10,
    mutantsKilled: Math.round(killRate * 10),
    mutantsSurvived: 10 - Math.round(killRate * 10),
    mutantsTimeout: 0,
    killRate,
    byFile: [{ file: 'src/add.ts', killRate, survived: [] }]
  };
}

function cleanAssertions(): AssertionsReport {
  return { totalAssertions: 60, weakAssertions: 0, weakRate: 0, weakPatterns: [] };
}

function weakAssertions(): AssertionsReport {
  return {
    totalAssertions: 100,
    weakAssertions: 10,
    weakRate: 0.1,
    weakPatterns: [
      {
        pattern: 'toBeTruthy',
        count: 10,
        examples: [{ file: 'src/add.test.ts', line: 5, code: '.toBeTruthy()' }]
      }
    ]
  };
}

describe('behavior — buildMutReport evaluated axis', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'peaks-mut-builder-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('when asserts mode sees a clean scan, should pass and mark mutation not evaluated', async () => {
    // given: the asserts path's stub mutation block plus a 0-weak scan
    // when: the report is built in asserts mode
    // then: passed is decided by the assertion axis alone
    const report = await buildMutReport({
      mode: 'asserts',
      inputSig: HEX_SIG,
      out: join(dir, 'mut-report.json'),
      mutation: emptyMutation(),
      assertions: cleanAssertions()
    });

    expect(report.thresholds.passed).toBe(true);
    expect(report.thresholds.evaluated).toEqual({ mutation: false, assertions: true });
    expect(report.followups).toEqual([]);
  });

  it('when asserts mode sees a weak rate over the max, should fail on assertions only', async () => {
    // given: the asserts path's stub mutation block plus a 10%-weak scan
    // when: the report is built in asserts mode
    // then: passed is false and only the weak-assertion followup is emitted
    const report = await buildMutReport({
      mode: 'asserts',
      inputSig: HEX_SIG,
      out: join(dir, 'mut-report.json'),
      mutation: emptyMutation(),
      assertions: weakAssertions()
    });

    expect(report.thresholds.passed).toBe(false);
    expect(report.thresholds.evaluated).toEqual({ mutation: false, assertions: true });
    expect(report.followups.map((f) => f.issue)).toEqual(['high_weak_assertions']);
  });

  it('when run mode sees a low kill rate, should still fail the mutation gate', async () => {
    // given: a 50% kill rate under the 80% minimum and a clean scan
    // when: the report is built in run mode
    // then: the mutation axis fails exactly as before
    const report = await buildMutReport({
      mode: 'run',
      inputSig: HEX_SIG,
      out: join(dir, 'mut-report.json'),
      mutation: mutationWith(0.5),
      assertions: cleanAssertions()
    });

    expect(report.thresholds.passed).toBe(false);
    expect(report.thresholds.evaluated).toEqual({ mutation: true, assertions: true });
    expect(report.followups.map((f) => f.issue)).toEqual(['low_kill_rate']);
  });

  it('when run mode sees zero mutants, should still fail the mutation gate', async () => {
    // given: an empty mutation block (killRate 0) and a clean scan
    // when: the report is built in run mode
    // then: 0 mutants still fail the mutation axis
    const report = await buildMutReport({
      mode: 'run',
      inputSig: HEX_SIG,
      out: join(dir, 'mut-report.json'),
      mutation: emptyMutation(),
      assertions: cleanAssertions()
    });

    expect(report.thresholds.passed).toBe(false);
    expect(report.thresholds.evaluated.mutation).toBe(true);
  });

  it('when the mode is omitted, should default to the unchanged run behaviour', async () => {
    // given: a low kill rate and a clean scan, with no explicit mode
    // when: every existing caller builds a report
    // then: the mutation gate is evaluated and fails as it always did
    const report = await buildMutReport({
      inputSig: HEX_SIG,
      out: join(dir, 'mut-report.json'),
      mutation: mutationWith(0.5),
      assertions: cleanAssertions()
    });

    expect(report.thresholds.passed).toBe(false);
    expect(report.thresholds.evaluated).toEqual({ mutation: true, assertions: true });
  });

  it('when run mode passes both axes, should report passed true', async () => {
    // given: a 100% kill rate and a clean scan
    // when: the report is built in run mode
    // then: passed stays true
    const report = await buildMutReport({
      mode: 'run',
      inputSig: HEX_SIG,
      out: join(dir, 'mut-report.json'),
      mutation: mutationWith(1),
      assertions: cleanAssertions()
    });

    expect(report.thresholds.passed).toBe(true);
  });
});

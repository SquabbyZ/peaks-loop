import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runIndependentCheck } from '~/src/services/capability-audit-service/independent-checker';
import {
  P0_JOURNEY_IDS,
  type CapabilityBaselineRow,
  type JourneyId
} from '~/src/services/capability-baseline/types';
import type { GuardContract, GuardRunResult } from '~/src/services/capability-guard-runner/types';

function row(journeyId: JourneyId, sourceFiles: ReadonlyArray<string> = []): CapabilityBaselineRow {
  return {
    journeyId,
    intent: 'intent',
    observable: { inputs: [], outputs: [], errors: [] },
    invariants: [`invariant-${journeyId}`],
    forbiddenChanges: [`forbidden-${journeyId}`],
    sourceFiles
  };
}

const ROWS: ReadonlyArray<CapabilityBaselineRow> = P0_JOURNEY_IDS.map((j) => row(j));

const CONTRACTS: ReadonlyArray<GuardContract> = ROWS.map((r) => ({
  journeyId: r.journeyId,
  kind: 'workflow-trace',
  source: { baselineRow: r.journeyId, invariant: r.invariants[0]! },
  execute: async () => ({
    journeyId: r.journeyId,
    contract: 'workflow-trace',
    status: 'pass',
    artifactPath: 'a'
  }),
  evidence: { kind: 'workflow-trace', artifact: 'a' }
}));

function results(ids: ReadonlyArray<JourneyId>): ReadonlyArray<GuardRunResult> {
  return ids.map((j) => ({
    journeyId: j,
    contract: 'workflow-trace',
    status: 'pass',
    artifactPath: 'a'
  }));
}

const ALL = results(P0_JOURNEY_IDS);

let proj = '';
afterEach(() => {
  if (proj) rmSync(proj, { recursive: true, force: true });
  proj = '';
});

describe('runIndependentCheck', () => {
  it('is consistent when the frozen set, the observation set and the bindings all agree', () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-chk-'));
    const r = runIndependentCheck({
      projectRoot: proj,
      baselineRows: ROWS,
      contracts: CONTRACTS,
      guardResults: ALL
    });
    expect(r.verdict).toBe('consistent');
    expect(r.findings).toEqual([]);
    expect(r.coverage).toEqual({
      observations: 15,
      observationsExpected: 15,
      invariantsFrozen: 15,
      invariantsArmed: 15,
      forbiddenChangesUnverified: 15
    });
  });

  // ---- injection: a checker that cannot fail is a rubber stamp ----

  it('drifts when a journey is missing from the observation set', () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-chk-'));
    const r = runIndependentCheck({
      projectRoot: proj,
      baselineRows: ROWS,
      contracts: CONTRACTS,
      guardResults: ALL.filter((g) => g.journeyId !== 'J09')
    });
    expect(r.verdict).toBe('drifted');
    expect(r.findings.map((f) => [f.code, f.journeyId])).toEqual([
      ['OBSERVATION_INCOMPLETE', 'J09']
    ]);
  });

  it('drifts when the same journey is observed twice', () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-chk-'));
    const r = runIndependentCheck({
      projectRoot: proj,
      baselineRows: ROWS,
      contracts: CONTRACTS,
      guardResults: [...ALL, ALL[0]!]
    });
    expect(r.verdict).toBe('drifted');
    expect(r.findings.map((f) => f.code)).toContain('OBSERVATION_INCOMPLETE');
  });

  it('drifts when an observation is not a frozen journey', () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-chk-'));
    const r = runIndependentCheck({
      projectRoot: proj,
      baselineRows: ROWS.filter((x) => x.journeyId !== 'J09'),
      contracts: CONTRACTS,
      guardResults: ALL
    });
    const codes = r.findings.map((f) => f.code);
    expect(r.verdict).toBe('drifted');
    expect(codes).toContain('BASELINE_ROW_SET_INVALID');
    expect(codes).toContain('OBSERVATION_INCOMPLETE');
  });

  it('drifts when a frozen sourceFiles entry is gone from disk', () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-chk-'));
    const withBinding: ReadonlyArray<CapabilityBaselineRow> = ROWS.map((r) =>
      r.journeyId === 'J01' ? row('J01', ['src/keep.ts', 'src/gone.ts']) : r
    );
    mkdirSync(join(proj, 'src'), { recursive: true });
    writeFileSync(join(proj, 'src', 'keep.ts'), '');
    const r = runIndependentCheck({
      projectRoot: proj,
      baselineRows: withBinding,
      contracts: CONTRACTS,
      guardResults: ALL
    });
    expect(r.verdict).toBe('drifted');
    expect(r.findings.map((f) => [f.code, f.journeyId, f.detail.includes('src/gone.ts')])).toEqual([
      ['SOURCE_FILE_MISSING', 'J01', true]
    ]);
  });

  // ---- coverage disclosure, not a verdict input ----

  it('reports how many frozen invariants are armed without drifting on the rest', () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-chk-'));
    // 15 frozen invariants, only 1 of them cited by a contract.
    const halfArmed: ReadonlyArray<GuardContract> = CONTRACTS.slice(0, 1);
    const r = runIndependentCheck({
      projectRoot: proj,
      baselineRows: ROWS,
      contracts: halfArmed,
      guardResults: ALL
    });
    expect(r.coverage.invariantsArmed).toBe(1);
    expect(r.coverage.invariantsFrozen).toBe(15);
    // An unarmed frozen invariant is disclosed, not treated as product drift.
    expect(r.verdict).toBe('consistent');
  });

  it('does not read the guard statuses — a failing contract is the runner verdict input, not this one', () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-chk-'));
    const failing = ALL.map((g) => ({ ...g, status: 'fail' as const }));
    const r = runIndependentCheck({
      projectRoot: proj,
      baselineRows: ROWS,
      contracts: CONTRACTS,
      guardResults: failing
    });
    // The checker's own subject is the observation SET, not the outcomes; a
    // failing contract is reported by `runAudit`, which sees both.
    expect(r.verdict).toBe('consistent');
    expect(r.coverage.observations).toBe(15);
  });
});

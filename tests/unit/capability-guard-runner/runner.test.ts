import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  exitCodeForGuardSummary,
  runAllGuards,
  runGuard
} from '~/src/services/capability-guard-runner/runner';
import { GUARD_CONTRACTS, getGuardContract } from '~/src/services/capability-guard-runner/registry';
import type { GuardContract } from '~/src/services/capability-guard-runner/types';

// `assertBaselineRef` now resolves the contract's row out of the real frozen
// baseline, so these contracts are pinned against the repo root and the
// invariant text is verbatim baseline text.
const REPO = resolve(__dirname, '..', '..', '..');
const J01_INVARIANT = 'The CLI verb is never shown to the user as a required input';

const okContract: GuardContract = {
  journeyId: 'J01',
  kind: 'envelope-arg-shapes',
  source: { baselineRow: 'J01', invariant: J01_INVARIANT },
  execute: async () => ({
    journeyId: 'J01',
    contract: 'envelope-arg-shapes',
    status: 'pass',
    artifactPath: 'N/A'
  }),
  evidence: {
    kind: 'envelope-arg-shapes',
    artifact: 'tests/integration/capability-guard/J01-envelope-arg-shapes.test.ts'
  }
};

const failContract: GuardContract = {
  ...okContract,
  execute: async () => ({
    journeyId: 'J01',
    contract: 'envelope-arg-shapes',
    status: 'fail',
    diff: { before: 'a', after: 'b', reason: 'inv-1 broken' },
    artifactPath: 'N/A'
  })
};

const ctx = (contract: GuardContract) => ({
  projectRoot: REPO,
  sessionId: 's',
  contract,
  baselineInvariant: 'auto'
});

describe('Scenario: capability-guard-runner/runner', () => {
  it('when invoked, should runGuard returns pass on a green contract', async () => {
    const r = await runGuard(okContract, ctx(okContract));
    expect(r.status).toBe('pass');
  });
  it('when invoked, should runGuard returns fail on a red contract', async () => {
    const r = await runGuard(failContract, ctx(failContract));
    expect(r.status).toBe('fail');
    expect(r.diff?.reason).toBe('inv-1 broken');
  });
  it('when invoked, should runAllGuards aggregates pass / fail / skipped counts', async () => {
    const summary = await runAllGuards([okContract, failContract], ctx(okContract));
    expect(summary.pass).toBe(1);
    expect(summary.fail).toBe(1);
    expect(summary.total).toBe(2);
  });
  it('when invoked, should refuse a contract without a baseline reference', async () => {
    const bad: GuardContract = { ...okContract, source: { baselineRow: 'J01', invariant: '' } };
    await expect(runGuard(bad, ctx(bad))).rejects.toThrow(/GUARD_CONTRACT_MISSING_BASELINE_REF/);
  });
  it('when invoked, should refuse an invariant that is not verbatim in the frozen baseline', async () => {
    const fabricated: GuardContract = {
      ...okContract,
      source: { baselineRow: 'J01', invariant: 'The user must type a CLI verb to proceed' }
    };
    await expect(runGuard(fabricated, ctx(fabricated))).rejects.toThrow(/not a verbatim invariant/);
  });
  it('when invoked, should refuse a contract bound to a journey absent from the baseline', async () => {
    const ghost: GuardContract = {
      ...okContract,
      source: { baselineRow: 'J99' as never, invariant: J01_INVARIANT }
    };
    await expect(runGuard(ghost, ctx(ghost))).rejects.toThrow(/is not in the frozen baseline/);
  });
  it('when invoked, should record a throwing contract as a fail instead of aborting the run', async () => {
    const boom: GuardContract = {
      ...okContract,
      execute: async () => {
        throw new Error('probe exploded');
      }
    };
    const summary = await runAllGuards([okContract, boom], ctx(okContract));
    expect(summary.pass).toBe(1);
    expect(summary.fail).toBe(1);
    expect(summary.results[1]?.diff?.after).toMatch(/probe exploded/);
  });
  it('when invoked, should map guard summaries onto distinct exit codes', () => {
    expect(exitCodeForGuardSummary({ fail: 0, skipped: 0 })).toBe(0);
    expect(exitCodeForGuardSummary({ fail: 1, skipped: 0 })).toBe(1);
    expect(exitCodeForGuardSummary({ fail: 0, skipped: 1 })).toBe(2);
  });
  it('when invoked, should register exactly the 15 P0 journeys', () => {
    expect(GUARD_CONTRACTS).toHaveLength(15);
    expect(GUARD_CONTRACTS.map((c) => c.journeyId)).toEqual([
      'J01',
      'J02',
      'J03',
      'J04',
      'J05',
      'J06',
      'J07',
      'J08',
      'J09',
      'J10',
      'J11',
      'J12',
      'J13',
      'J14',
      'J15'
    ]);
    expect(getGuardContract('J05')?.kind).toBe('workflow-trace');
  });
});

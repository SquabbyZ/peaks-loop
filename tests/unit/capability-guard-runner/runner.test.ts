import { describe, expect, it } from 'vitest';
import { runAllGuards, runGuard } from '~/src/services/capability-guard-runner/runner';
import type { GuardContract } from '~/src/services/capability-guard-runner/types';

const okContract: GuardContract = {
  journeyId: 'J01',
  kind: 'envelope-arg-shapes',
  source: { baselineRow: 'J01', invariant: 'inv-1' },
  execute: async () => ({ journeyId: 'J01', contract: 'envelope-arg-shapes', status: 'pass', artifactPath: 'N/A' }),
  evidence: { kind: 'envelope-arg-shapes', artifact: 'tests/integration/capability-guard/J01-envelope-arg-shapes.test.ts' }
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

describe("Scenario: capability-guard-runner/runner", () => {
  it("when invoked, should runGuard returns pass on a green contract", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const r = await runGuard(okContract, { projectRoot: '/', sessionId: 's', contract: okContract, baselineInvariant: 'inv-1' });
    expect(r.status).toBe('pass');
  });
  it("when invoked, should runGuard returns fail on a red contract", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const r = await runGuard(failContract, { projectRoot: '/', sessionId: 's', contract: failContract, baselineInvariant: 'inv-1' });
    expect(r.status).toBe('fail');
    expect(r.diff?.reason).toBe('inv-1 broken');
  });
  it("when invoked, should runAllGuards aggregates pass / fail / skipped counts", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const summary = await runAllGuards([okContract, failContract], { projectRoot: '/', sessionId: 's', contract: okContract, baselineInvariant: 'inv-1' });
    expect(summary.pass).toBe(1);
    expect(summary.fail).toBe(1);
    expect(summary.total).toBe(2);
  });
  it("when invoked, should refuses a contract without a baseline reference", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const bad: GuardContract = { ...okContract, source: { baselineRow: 'J01' as any, invariant: '' as any } };
    await expect(runGuard(bad, { projectRoot: '/', sessionId: 's', contract: bad, baselineInvariant: '' })).rejects.toThrow(/GUARD_CONTRACT_MISSING_BASELINE_REF/);
  });
});

// src/services/capability-guard-runner/runner.ts
import type { GuardContract, GuardContext, GuardRunResult } from './types.js';

function assertBaselineRef(contract: GuardContract): void {
  if (!contract.source.baselineRow || !contract.source.invariant) {
    throw new Error('GUARD_CONTRACT_MISSING_BASELINE_REF: contract must reference a baseline row and invariant');
  }
}

export async function runGuard(contract: GuardContract, ctx: GuardContext): Promise<GuardRunResult> {
  assertBaselineRef(contract);
  return contract.execute(ctx);
}

export async function runAllGuards(
  contracts: ReadonlyArray<GuardContract>,
  ctx: GuardContext
): Promise<{ readonly pass: number; readonly fail: number; readonly skipped: number; readonly total: number; readonly results: ReadonlyArray<GuardRunResult> }> {
  const results: GuardRunResult[] = [];
  for (const c of contracts) {
    results.push(await runGuard(c, ctx));
  }
  return {
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    total: results.length,
    results
  };
}

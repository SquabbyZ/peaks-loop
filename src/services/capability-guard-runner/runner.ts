// src/services/capability-guard-runner/runner.ts
import { readBaselineFile } from '../capability-baseline/store.js';
import type { CapabilityBaselineRow } from '../capability-baseline/types.js';
import type { GuardContract, GuardContext, GuardRunResult } from './types.js';

/**
 * Resolve the contract's declared baseline row out of the frozen baseline and
 * assert the declared invariant is verbatim text in that row.
 *
 * Before this, the check was `if (!source.baselineRow || !source.invariant)`,
 * i.e. it only asserted the two fields were truthy. Nothing ever read the
 * baseline, so a contract could name a journey / invariant that does not exist
 * in the frozen file and still run to a green result.
 */
export function assertBaselineRef(
  contract: GuardContract,
  projectRoot: string
): CapabilityBaselineRow {
  const r = readBaselineFile(projectRoot);
  if (!r.ok) {
    throw new Error(
      `GUARD_CONTRACT_MISSING_BASELINE_REF: ${contract.journeyId} cannot read the frozen baseline at ${projectRoot} (${r.error.code}: ${r.error.message})`
    );
  }
  const row = r.file.rows.find((x) => x.journeyId === contract.source.baselineRow);
  if (!row) {
    throw new Error(
      `GUARD_CONTRACT_MISSING_BASELINE_REF: ${contract.journeyId} references baseline row ${contract.source.baselineRow}, which is not in the frozen baseline`
    );
  }
  const declared = contract.source.invariant;
  if (typeof declared !== 'string' || declared.trim().length === 0) {
    throw new Error(
      `GUARD_CONTRACT_MISSING_BASELINE_REF: ${contract.journeyId} declares an empty invariant`
    );
  }
  if (!row.invariants.includes(declared)) {
    throw new Error(
      `GUARD_CONTRACT_MISSING_BASELINE_REF: ${contract.journeyId} declares invariant "${declared}", which is not a verbatim invariant of baseline row ${row.journeyId}`
    );
  }
  return row;
}

export async function runGuard(
  contract: GuardContract,
  ctx: GuardContext
): Promise<GuardRunResult> {
  assertBaselineRef(contract, ctx.projectRoot);
  return contract.execute({ ...ctx, contract });
}

/**
 * Run every contract and aggregate. A contract that throws (bad baseline
 * reference, unreadable source file, a probe that blows up) is recorded as a
 * `fail` result rather than aborting the whole run — the gate has to be able
 * to say "this journey is broken", not just crash.
 */
export async function runAllGuards(
  contracts: ReadonlyArray<GuardContract>,
  ctx: GuardContext
): Promise<{
  readonly pass: number;
  readonly fail: number;
  readonly skipped: number;
  readonly total: number;
  readonly results: ReadonlyArray<GuardRunResult>;
}> {
  const results: GuardRunResult[] = [];
  for (const c of contracts) {
    try {
      results.push(await runGuard(c, ctx));
    } catch (e) {
      results.push({
        journeyId: c.journeyId,
        contract: c.kind,
        status: 'fail',
        diff: {
          before: 'contract runs against the frozen baseline',
          after: (e as Error).message,
          reason: `${c.journeyId} contract could not run`
        },
        artifactPath: c.evidence.artifact
      });
    }
  }
  return {
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    total: results.length,
    results
  };
}

/**
 * Exit-code contract for a guard summary. `skipped` must not be
 * indistinguishable from `pass`: a run that quietly skipped work is a
 * different outcome from a run that verified work, so it gets its own code.
 */
export function exitCodeForGuardSummary(summary: {
  readonly fail: number;
  readonly skipped: number;
}): 0 | 1 | 2 {
  if (summary.fail > 0) return 1;
  if (summary.skipped > 0) return 2;
  return 0;
}

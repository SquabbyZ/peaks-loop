import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runAudit } from '~/src/services/capability-audit-service/runner';
import {
  P0_JOURNEY_IDS,
  type CapabilityBaselineRow
} from '~/src/services/capability-baseline/types';
import type { GuardContract, GuardRunResult } from '~/src/services/capability-guard-runner/types';

const ROWS: ReadonlyArray<CapabilityBaselineRow> = P0_JOURNEY_IDS.map((journeyId) => ({
  journeyId,
  intent: 'intent',
  observable: { inputs: [], outputs: [], errors: [] },
  invariants: [`invariant-${journeyId}`],
  forbiddenChanges: [`forbidden-${journeyId}`],
  sourceFiles: []
}));

const CONTRACTS: ReadonlyArray<GuardContract> = ROWS.map((row) => ({
  journeyId: row.journeyId,
  kind: 'workflow-trace',
  source: { baselineRow: row.journeyId, invariant: row.invariants[0]! },
  execute: async () => ({
    journeyId: row.journeyId,
    contract: 'workflow-trace',
    status: 'pass',
    artifactPath: 'a'
  }),
  evidence: { kind: 'workflow-trace', artifact: 'a' }
}));

function results(
  statusFor: (j: CapabilityBaselineRow['journeyId']) => GuardRunResult['status']
): ReadonlyArray<GuardRunResult> {
  return CONTRACTS.map((c) => ({
    journeyId: c.journeyId,
    contract: c.kind,
    status: statusFor(c.journeyId),
    artifactPath: 'a'
  }));
}

let proj = '';
afterEach(() => {
  if (proj) rmSync(proj, { recursive: true, force: true });
  proj = '';
});

describe('5th-dim injection', () => {
  it('a drifted audit forces the 5th dim to fail', async () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-inj-'));
    // J07's contract genuinely fails, so the audit must report `drifted` — not
    // `inconclusive`. A failed guard contract is concrete evidence of
    // deviation; `inconclusive` is reserved for "no evaluation ran".
    const audit = await runAudit({
      projectRoot: proj,
      sessionId: 'i',
      journeyId: 'J01',
      scorerMode: 'live',
      baselineRows: ROWS,
      contracts: CONTRACTS,
      guardSummary: {
        pass: P0_JOURNEY_IDS.length - 1,
        fail: 1,
        skipped: 0,
        total: P0_JOURNEY_IDS.length,
        results: results((j) => (j === 'J07' ? 'fail' : 'pass'))
      }
    });
    expect(audit.verdict).toBe('drifted');
    expect(audit.degraded).toBe(false);
  });

  it('a narrowed observation set drifts even when every contract that ran passed', async () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-inj-'));
    // The `pass: 14 / fail: 0` shape is the one that looks identical to green.
    // Only the independent checker can see that the frozen set has 15 rows.
    const audit = await runAudit({
      projectRoot: proj,
      sessionId: 'i',
      journeyId: 'J01',
      scorerMode: 'live',
      baselineRows: ROWS,
      contracts: CONTRACTS,
      guardSummary: {
        pass: P0_JOURNEY_IDS.length - 1,
        fail: 0,
        skipped: 0,
        total: P0_JOURNEY_IDS.length - 1,
        results: results(() => 'pass').filter((g) => g.journeyId !== 'J09')
      }
    });
    expect(audit.verdict).toBe('drifted');
    expect(audit.findings?.map((f) => [f.code, f.journeyId])).toEqual([
      ['OBSERVATION_INCOMPLETE', 'J09']
    ]);
  });
});

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

const EMPTY_ROW = (journeyId: CapabilityBaselineRow['journeyId']): CapabilityBaselineRow => ({
  journeyId,
  intent: 'intent',
  observable: { inputs: [], outputs: [], errors: [] },
  invariants: [`invariant-${journeyId}`],
  forbiddenChanges: [`forbidden-${journeyId}`],
  sourceFiles: []
});

const ROWS: ReadonlyArray<CapabilityBaselineRow> = P0_JOURNEY_IDS.map(EMPTY_ROW);

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

/** The full frozen observation set, all green. */
function allPass(): ReadonlyArray<GuardRunResult> {
  return CONTRACTS.map((c) => ({
    journeyId: c.journeyId,
    contract: c.kind,
    status: 'pass' as const,
    artifactPath: 'a'
  }));
}

const FULL_SUMMARY = {
  pass: P0_JOURNEY_IDS.length,
  fail: 0,
  skipped: 0,
  total: P0_JOURNEY_IDS.length,
  results: allPass()
};

let proj = '';
afterEach(() => {
  if (proj) rmSync(proj, { recursive: true, force: true });
  proj = '';
});

describe('runAudit (independent eval)', () => {
  it('never reports consistent when the scorer is a stub', async () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-aud-'));
    const r = await runAudit({
      projectRoot: proj,
      sessionId: 'a',
      journeyId: 'J01',
      scorerMode: 'stub',
      baselineRows: ROWS,
      contracts: CONTRACTS,
      guardSummary: FULL_SUMMARY
    });
    // The stub runs no check at all, so there is no verdict to trust.
    expect(r.verdict).toBe('inconclusive');
    expect(r.degraded).toBe(true);
    expect(r.requiresUserDecision).toBe(true);
  });

  it('returns verdict=consistent when the live checker is clean and the guards agree', async () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-aud-'));
    const r = await runAudit({
      projectRoot: proj,
      sessionId: 'a',
      journeyId: 'J01',
      scorerMode: 'live',
      baselineRows: ROWS,
      contracts: CONTRACTS,
      guardSummary: FULL_SUMMARY
    });
    expect(r.verdict).toBe('consistent');
    expect(r.degraded).toBe(false);
    expect(r.findings).toEqual([]);
    expect(r.coverage?.observations).toBe(P0_JOURNEY_IDS.length);
  });

  it('scores one dimension per guard result', async () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-aud-'));
    const r = await runAudit({
      projectRoot: proj,
      sessionId: 'a',
      journeyId: 'J01',
      scorerMode: 'live',
      baselineRows: ROWS,
      contracts: CONTRACTS,
      guardSummary: {
        pass: P0_JOURNEY_IDS.length - 1,
        fail: 1,
        skipped: 0,
        total: P0_JOURNEY_IDS.length,
        results: allPass().map((g) =>
          g.journeyId === 'J02'
            ? { ...g, status: 'fail' as const, diff: { before: 'x', after: 'y', reason: 'z' } }
            : g
        )
      }
    });
    const byId = new Map(r.dimensions.map((d) => [d.journeyId, d.consistencyScore]));
    expect(byId.get('J01')).toBe(1);
    expect(byId.get('J02')).toBe(0);
    expect(r.dimensions).toHaveLength(P0_JOURNEY_IDS.length);
  });
});

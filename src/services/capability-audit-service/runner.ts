import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crossCheck } from './cross-check.js';
import { runIndependentCheck } from './independent-checker.js';
import type { CapabilityAuditResult, AuditDimension } from './types.js';
import type { CapabilityBaselineRow, JourneyId } from '../capability-baseline/types.js';
import type { GuardContract, GuardRunResult } from '../capability-guard-runner/types.js';

/**
 * `stub` means the "independent" verdict came from a hard-coded response, not
 * from a separate context. A stub is not an evaluation, so an audit that used
 * one is marked `degraded` and can never report `consistent`.
 *
 * `live` runs the deterministic independent checker: a real separate-context
 * evaluation that needs no credentials, which is why it is the only kind that
 * can run inside the secretless OIDC publish gate.
 */
export type AuditScorerMode = 'stub' | 'live';

export interface RunAuditInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly journeyId: JourneyId;
  readonly scorerMode: AuditScorerMode;
  /** The frozen claim set under audit. */
  readonly baselineRows: ReadonlyArray<CapabilityBaselineRow>;
  /** The arming witness: which frozen invariants some contract enforces. */
  readonly contracts: ReadonlyArray<GuardContract>;
  readonly guardSummary: {
    readonly pass: number;
    readonly fail: number;
    readonly skipped: number;
    readonly total: number;
    readonly results: ReadonlyArray<GuardRunResult>;
  };
}

function scoreFor(status: GuardRunResult['status']): number {
  return status === 'pass' ? 1 : status === 'fail' ? 0 : 0.5;
}

export async function runAudit(input: RunAuditInput): Promise<CapabilityAuditResult> {
  const degraded = input.scorerMode === 'stub';
  // A stub run performs no evaluation, so the checker is not run either — its
  // result would be misread as an evaluation that happened.
  const check = degraded
    ? null
    : runIndependentCheck({
        projectRoot: input.projectRoot,
        baselineRows: input.baselineRows,
        contracts: input.contracts,
        guardResults: input.guardSummary.results
      });

  const xc = crossCheck({
    guardPass: input.guardSummary.pass,
    guardFail: input.guardSummary.fail,
    // A degraded run has no independent verdict to compare; 0/0 keeps the
    // cross-check shape without inventing one.
    independentPass: check?.verdict === 'consistent' ? 1 : 0,
    independentFail: check?.verdict === 'drifted' ? 1 : 0,
    karpathy: 'skipped'
  });

  // S1's rule is unchanged and load-bearing: a run that performed no separate
  // evaluation can never be `consistent`. S11 adds the live branch. Every
  // concrete deviation — a failed guard contract, or a finding from the
  // independent checker — reports `drifted` instead of hiding behind
  // `inconclusive`. So `inconclusive` is now reachable only when no evaluation
  // ran at all, which is what it should mean.
  let verdict: CapabilityAuditResult['verdict'] = 'consistent';
  if (degraded) verdict = 'inconclusive';
  else if (input.guardSummary.fail > 0) verdict = 'drifted';
  else if ((check?.findings.length ?? 0) > 0) verdict = 'drifted';

  // One dimension per journey actually run, scored from the guard result —
  // previously this was a single row whose score was derived from the stub.
  const dimensions: AuditDimension[] = input.guardSummary.results.map((g) => {
    // When the contract fails, include the diff detail in the evidence summary
    // so the gate step log (and any artifact) carries a real diagnostic
    // instead of just "workflow-trace → fail". The summary is bounded so a
    // runaway diff can't bloat every dimension; the contract itself is the
    // authoritative source.
    const detail =
      g.status === 'fail' && g.diff ? ` | ${g.diff.reason}: ${g.diff.after}`.slice(0, 4000) : '';
    return {
      journeyId: g.journeyId,
      consistencyScore: scoreFor(g.status),
      evidence: [
        {
          kind: 'guard-run',
          ref: `capability-guard-runner:${g.journeyId}`,
          summary: `${g.contract} → ${g.status}${detail}`
        }
      ]
    };
  });
  if (dimensions.length === 0) {
    dimensions.push({
      journeyId: input.journeyId,
      consistencyScore: verdict === 'consistent' ? 1 : verdict === 'drifted' ? 0 : 0.5,
      evidence: [
        {
          kind: 'guard-run',
          ref: 'capability-guard-runner:0',
          summary: 'no contract results were supplied'
        }
      ]
    });
  }

  const independentRef = degraded
    ? 'audit-independent-checker:stub'
    : 'audit-independent-checker:deterministic';
  const first = dimensions[0]!;
  dimensions[0] = {
    ...first,
    evidence: [
      ...first.evidence,
      {
        kind: 'independent-eval',
        ref: independentRef,
        summary:
          check === null
            ? 'degraded: stub scorer (no independent context ran); the verdict was not derived from an evaluation'
            : `independent verdict: ${check.verdict}; observations ${String(check.coverage.observations)}/${String(check.coverage.observationsExpected)}; invariants armed ${String(check.coverage.invariantsArmed)}/${String(check.coverage.invariantsFrozen)}; findings: ${check.findings.length === 0 ? 'none' : check.findings.map((f) => `${f.code}(${f.journeyId})`).join(',')}`
      }
    ]
  };

  const auditId = `audit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const out: CapabilityAuditResult = {
    auditId,
    auditedAt: new Date().toISOString(),
    verdict,
    dimensions,
    crossCheck: xc,
    requiresUserDecision: verdict === 'inconclusive',
    degraded,
    findings: check === null ? null : check.findings,
    coverage: check === null ? null : check.coverage
  };

  const dir = join(input.projectRoot, '.peaks', '_runtime', input.sessionId, 'capability-audit');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${auditId}.json`), JSON.stringify(out, null, 2));
  return out;
}

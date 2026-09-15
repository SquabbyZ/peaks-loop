import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crossCheck } from './cross-check.js';
import type { CapabilityAuditResult, AuditDimension } from './types.js';
import type { JourneyId } from '../capability-baseline/types.js';
import type { GuardRunResult } from '../capability-guard-runner/types.js';

/**
 * `stub` means the "independent" verdict came from a hard-coded response, not
 * from a separate context. A stub is not an evaluation, so an audit that used
 * one is marked `degraded` and can never report `consistent`.
 */
export type AuditScorerMode = 'stub' | 'live';

export interface RunAuditInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly journeyId: JourneyId;
  readonly scorerMode: AuditScorerMode;
  readonly llmRunner: { call(system: string, user: string, opts: { maxTokens: number }): Promise<{ output: string; tokens: { input: number; output: number } }> };
  readonly guardSummary: { readonly pass: number; readonly fail: number; readonly skipped: number; readonly total: number; readonly results: ReadonlyArray<GuardRunResult> };
}

const SYSTEM = 'You are an INDEPENDENT audit scorer. Compare the supplied capability baseline to the supplied current behavior summary. Output a single JSON object: {"verdict":"consistent" | "drifted" | "inconclusive"}. No prose.';

function scoreFor(status: GuardRunResult['status']): number {
  return status === 'pass' ? 1 : status === 'fail' ? 0 : 0.5;
}

export async function runAudit(input: RunAuditInput): Promise<CapabilityAuditResult> {
  const degraded = input.scorerMode === 'stub';
  const userPayload = JSON.stringify({ baselineJourneyId: input.journeyId, guard: input.guardSummary });
  const r = await input.llmRunner.call(SYSTEM, userPayload, { maxTokens: 200 });
  const { verdict: independentVerdict } = JSON.parse(r.output) as { verdict: 'consistent' | 'drifted' | 'inconclusive' };

  const xc = crossCheck({
    guardPass: input.guardSummary.pass,
    guardFail: input.guardSummary.fail,
    independentPass: independentVerdict === 'consistent' ? 1 : 0,
    independentFail: independentVerdict === 'drifted' ? 1 : 0,
    karpathy: 'skipped'
  });

  // A stub verdict is ignored for the outcome: `{"verdict":"consistent"}` from a
  // hard-coded runner is a restatement of the stub, not evidence about the
  // product. Live runs keep the previous cross-check behaviour.
  let verdict: CapabilityAuditResult['verdict'] = degraded ? 'inconclusive' : independentVerdict;
  if (!degraded && xc.guardVsAudit === 'diverge') verdict = 'inconclusive';

  // One dimension per journey actually run, scored from the guard result —
  // previously this was a single row whose score was derived from the stub.
  const dimensions: AuditDimension[] = input.guardSummary.results.map((g) => ({
    journeyId: g.journeyId,
    consistencyScore: scoreFor(g.status),
    evidence: [{ kind: 'guard-run', ref: `capability-guard-runner:${g.journeyId}`, summary: `${g.contract} → ${g.status}` }]
  }));
  if (dimensions.length === 0) {
    dimensions.push({
      journeyId: input.journeyId,
      consistencyScore: verdict === 'consistent' ? 1 : verdict === 'drifted' ? 0 : 0.5,
      evidence: [{ kind: 'guard-run', ref: 'capability-guard-runner:0', summary: 'no contract results were supplied' }]
    });
  }

  const independentRef = degraded ? 'audit-llm-context:stub' : 'audit-llm-context';
  const first = dimensions[0]!;
  dimensions[0] = {
    ...first,
    evidence: [
      ...first.evidence,
      {
        kind: 'independent-eval',
        ref: independentRef,
        summary: degraded
          ? `degraded: stub scorer (not an independent context) returned ${independentVerdict}; ignored for the verdict`
          : `independent verdict: ${independentVerdict}`
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
    degraded
  };

  const dir = join(input.projectRoot, '.peaks', '_runtime', input.sessionId, 'capability-audit');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${auditId}.json`), JSON.stringify(out, null, 2));
  return out;
}

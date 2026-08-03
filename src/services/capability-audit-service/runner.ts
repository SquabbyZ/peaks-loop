import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crossCheck } from './cross-check.js';
import type { CapabilityAuditResult, AuditDimension } from './types.js';
import type { JourneyId } from '../capability-baseline/types.js';
import type { GuardRunResult } from '../capability-guard-runner/types.js';

export interface RunAuditInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly journeyId: JourneyId;
  readonly llmRunner: { call(system: string, user: string, opts: { maxTokens: number }): Promise<{ output: string; tokens: { input: number; output: number } }> };
  readonly guardSummary: { readonly pass: number; readonly fail: number; readonly skipped: number; readonly total: number; readonly results: ReadonlyArray<GuardRunResult> };
}

const SYSTEM = 'You are an INDEPENDENT audit scorer. Compare the supplied capability baseline to the supplied current behavior summary. Output a single JSON object: {"verdict":"consistent" | "drifted" | "inconclusive"}. No prose.';

export async function runAudit(input: RunAuditInput): Promise<CapabilityAuditResult> {
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

  let verdict: CapabilityAuditResult['verdict'] = independentVerdict;
  if (xc.guardVsAudit === 'diverge') verdict = 'inconclusive';

  const dimensions: AuditDimension[] = [{
    journeyId: input.journeyId,
    consistencyScore: verdict === 'consistent' ? 1 : verdict === 'drifted' ? 0 : 0.5,
    evidence: [
      { kind: 'guard-run', ref: `capability-guard-runner:${input.guardSummary.total}`, summary: `${input.guardSummary.pass} pass / ${input.guardSummary.fail} fail` },
      { kind: 'independent-eval', ref: 'audit-llm-context', summary: `independent verdict: ${independentVerdict}` }
    ]
  }];

  const auditId = `audit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const out: CapabilityAuditResult = {
    auditId,
    auditedAt: new Date().toISOString(),
    verdict,
    dimensions,
    crossCheck: xc,
    requiresUserDecision: verdict === 'inconclusive'
  };

  const dir = join(input.projectRoot, '.peaks', '_runtime', input.sessionId, 'capability-audit');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${auditId}.json`), JSON.stringify(out, null, 2));
  return out;
}

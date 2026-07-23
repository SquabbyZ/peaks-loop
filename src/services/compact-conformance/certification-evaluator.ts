/**
 * Certification evaluator — Phase 3 Task 3.4.
 *
 * Maps a `CompactConformanceReport` (or a list of `CompactConformanceCaseResult`)
 * to the maximum `EffectiveCertification`. Callers cannot request or
 * force a level — the evaluator computes the ceiling from evidence.
 */
import type { CompactConformanceCaseResult, CompactConformanceReport } from './conformance-types.js';
import { ALL_CASES, type ConformanceCase } from './conformance-cases.js';
import type { EffectiveCertification } from '../compact-providers/provider-certification-policy.js';

export interface CertificationEvaluation {
  readonly level: EffectiveCertification;
  readonly failedStrongCases: readonly string[];
  readonly skippedStrongCases: readonly string[];
}

function rankOf(kind: EffectiveCertification['kind']): number {
  switch (kind) {
    case 'certified-strong': return 3;
    case 'native-only': return 2;
    case 'safe-handoff': return 1;
    case 'unsupported': return 0;
  }
}

function minLevel(a: EffectiveCertification['kind'], b: EffectiveCertification['kind']): EffectiveCertification['kind'] {
  return rankOf(a) <= rankOf(b) ? a : b;
}

function classify(cases: readonly CompactConformanceCaseResult[]): CertificationEvaluation {
  const strongByCaseId = new Map<string, ConformanceCase>();
  for (const c of ALL_CASES) {
    if (c.strong) strongByCaseId.set(c.caseId, c);
  }
  const byId = new Map<string, CompactConformanceCaseResult>();
  for (const r of cases) byId.set(r.caseId, r);

  const failedStrong: string[] = [];
  const skippedStrong: string[] = [];

  let level: EffectiveCertification['kind'] = 'certified-strong';
  for (const [caseId, def] of strongByCaseId) {
    const r = byId.get(caseId);
    if (!r) continue; // missing results count as skipped
    if (r.status === 'skipped') {
      skippedStrong.push(caseId);
      level = minLevel(level, 'native-only');
      continue;
    }
    if (r.status === 'failed') {
      failedStrong.push(caseId);
      level = minLevel(level, 'safe-handoff');
      continue;
    }
    // passed → no change; remains certified-strong
  }

  // If any strong case is missing entirely (no result), drop to native-only
  // (conformance surface is incomplete).
  for (const caseId of strongByCaseId.keys()) {
    if (!byId.has(caseId)) {
      skippedStrong.push(caseId);
      level = minLevel(level, 'native-only');
    }
  }

  return { level: { kind: level }, failedStrongCases: failedStrong, skippedStrongCases: skippedStrong };
}

export function evaluateCertification(
  input: CompactConformanceReport | readonly CompactConformanceCaseResult[]
): CertificationEvaluation {
  const cases: readonly CompactConformanceCaseResult[] = Array.isArray(input)
    ? input
    : (input as CompactConformanceReport).cases;
  return classify(cases);
}

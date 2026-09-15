import { auditGoal, IncompleteAuditError } from '../../audit/audit-goal-service.js';
import type { LlmRunner } from '../../audit/audit-goal-service.js';
import type { GuardContext, GuardRunResult } from '../types.js';
import { combineProbes, fail, missingSourceFiles, pass, probe, requireBaselineRow } from './_shared.js';

/** The six dimensions the frozen baseline names, in the baseline's own order. */
const SIX_DIMENSIONS: ReadonlyArray<string> = [
  'correctness', 'completeness', 'scope', 'risks', 'alternatives', 'constraints'
];

function runnerReturning(output: string): LlmRunner {
  return { call: async () => ({ output, tokens: { input: 1, output: 1 } }) };
}

function envelope(dimensions: ReadonlyArray<string>, severity = 'info'): string {
  return JSON.stringify({
    summary: 's',
    audit: dimensions.map((dimension) => ({ dimension, finding: 'f', severity })),
    proposedGoal: 'g',
    successCriteria: ['c'],
    roughEffort: 'small',
    confidence: 'high',
    rationale: 'r'
  });
}

/**
 * Behavioural probe: drive `auditGoal()` with a complete and an incomplete
 * payload and assert it accepts exactly one of them. Counting `dimension`
 * occurrences in the source would have passed even if the six-element guard
 * were replaced by a comment.
 */
export async function runJ04Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const row = requireBaselineRow(ctx);
  const missing = missingSourceFiles(ctx, row);

  let completeAccepted = false;
  let completeCount = -1;
  try {
    const out = await auditGoal({ need: 'n' }, runnerReturning(envelope(SIX_DIMENSIONS)));
    completeAccepted = true;
    completeCount = out.audit.length;
  } catch {
    completeAccepted = false;
  }

  let fiveRejected = false;
  let rejectName = 'none';
  try {
    await auditGoal({ need: 'n' }, runnerReturning(envelope(SIX_DIMENSIONS.slice(0, 5))));
  } catch (e) {
    fiveRejected = true;
    rejectName = (e as Error).name;
  }

  // Any one dimension dropped must be refused — not just the last one.
  let eachDropRejected = true;
  const accepted = new Set<string>();
  for (const dropped of SIX_DIMENSIONS) {
    const dims = SIX_DIMENSIONS.filter((d) => d !== dropped);
    try {
      await auditGoal({ need: 'n' }, runnerReturning(envelope(dims)));
      eachDropRejected = false;
      accepted.add(dropped);
    } catch {
      /* expected */
    }
  }

  const result = combineProbes([
    probe(missing.length === 0, `baseline sourceFiles present (${row.sourceFiles.length})`),
    probe(completeAccepted, 'six-dimension audit is accepted'),
    probe(completeCount === 6, `accepted audit carries exactly 6 dimensions (saw ${completeCount})`),
    probe(fiveRejected, 'five-dimension audit is rejected'),
    probe(rejectName === 'IncompleteAuditError', `rejection is IncompleteAuditError (saw ${rejectName}, ${IncompleteAuditError.name})`),
    probe(eachDropRejected, `dropping any single dimension is rejected (accepted: ${[...accepted].join(',') || 'none'})`)
  ]);

  const artifact = row.sourceFiles[0] ?? 'src/services/audit/audit-goal-service.ts';
  if (result.ok) return pass(ctx, artifact);
  return fail(
    ctx,
    artifact,
    'auditGoal() accepts a complete six-dimension payload and rejects any five-dimension payload',
    result.detail,
    'J04 invariant broken: the audit does not cover exactly six dimensions'
  );
}

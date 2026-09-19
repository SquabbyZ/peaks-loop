import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  IncompleteFinalReviewError,
  MAX_EVIDENCE_BYTES_PER_FILE,
  outputBudgetForEvidence,
  prepareFinalReview,
  resolveOutputBudget,
  undeliverableDimensions
} from '../../final-review/final-review-service.js';
import type { LlmRunner } from '../../final-review/final-review-service.js';
import type { GuardContext, GuardRunResult } from '../types.js';
import {
  combineProbes,
  fail,
  missingSourceFiles,
  pass,
  probe,
  requireBaselineRow
} from './_shared.js';

/** The four dimensions the frozen baseline names. The 5th is NOT one of them. */
const FOUR_DIMENSIONS: ReadonlyArray<string> = [
  'functional-completeness',
  'problem-resolution',
  'no-new-bugs',
  'existing-functionality-intact'
];
const FIFTH_DIMENSION = 'capability-consistency';

type UndeliverableInput = Parameters<typeof undeliverableDimensions>[0];
type CollectedEvidence = UndeliverableInput[number];

/**
 * One oversized, omitted source that backs `dimension`. `omitted` + over-cap +
 * zero delivered bytes is the structural case: nothing can ever deliver it.
 */
function undeliverableSource(dimension: string, totalBytes: number): CollectedEvidence {
  return {
    source: {
      key: `k-${dimension}`,
      label: dimension,
      segments: [`${dimension}.md`],
      supports: [dimension],
      delivery: { kind: 'whole' }
    },
    relativePath: `${dimension}.md`,
    absolutePath: `/nonexistent/${dimension}.md`,
    status: 'omitted',
    totalBytes,
    includedBytes: 0,
    content: '',
    reason: 'over-cap'
  } as unknown as CollectedEvidence;
}

function reviewJson(dimensions: ReadonlyArray<string>): string {
  return JSON.stringify({
    rid: 'J05-fixture',
    generatedAt: new Date(0).toISOString(),
    dimensions: dimensions.map((dimension) => ({
      dimension,
      verdict: 'pass',
      summary: 's',
      evidence: [],
      confidence: 'high'
    })),
    overallSummary: 's',
    allPass: true,
    needsAttention: []
  });
}

function runnerReturning(output: string): LlmRunner {
  return { call: async () => ({ output, tokens: { input: 1, output: 1024 } }) };
}

/**
 * Drive the real 4-dimension gate: a reply covering three of four dimensions
 * must be refused, a reply covering all four must be accepted. Reading the
 * four strings out of `final-review-service.ts` proved only that the literals
 * were still typed somewhere in the file.
 */
async function probePrepareFinalReview(): Promise<{
  readonly rejected: boolean;
  readonly accepted: boolean;
  readonly detail: string;
}> {
  const root = mkdtempSync(join(tmpdir(), 'cbl-J05-'));
  try {
    const sessionId = 'guard-J05';
    mkdirSync(join(root, '.peaks', '_runtime', sessionId, 'audit-goal'), { recursive: true });
    writeFileSync(
      join(root, '.peaks', '_runtime', sessionId, 'audit-goal', 'J05-fixture.json'),
      JSON.stringify({ successCriteria: ['c'] })
    );
    const opts = { projectRoot: root, sessionId };

    let rejected = false;
    let rejectName = 'none';
    try {
      await prepareFinalReview('J05-fixture', {
        ...opts,
        llmRunner: runnerReturning(reviewJson(FOUR_DIMENSIONS.slice(0, 3)))
      });
    } catch (e) {
      rejected = (e as Error).name === IncompleteFinalReviewError.name;
      rejectName = (e as Error).name;
    }

    let accepted = false;
    let acceptError = '';
    try {
      const out = await prepareFinalReview('J05-fixture', {
        ...opts,
        llmRunner: runnerReturning(reviewJson(FOUR_DIMENSIONS))
      });
      accepted = out.dimensions.length === 4;
    } catch (e) {
      acceptError = `${(e as Error).name}: ${(e as Error).message.slice(0, 160)}`;
    }

    return {
      rejected,
      accepted,
      detail: `three-dimension reply rejected=${String(rejected)} (${rejectName}); four-dimension reply accepted=${String(accepted)}${acceptError ? ` [${acceptError}]` : ''}`
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export async function runJ05Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const row = requireBaselineRow(ctx);
  const missing = missingSourceFiles(ctx, row);

  const prepared = await probePrepareFinalReview();

  const oversized = FOUR_DIMENSIONS.map((d) =>
    undeliverableSource(d, MAX_EVIDENCE_BYTES_PER_FILE + 1000)
  );
  const reported = undeliverableDimensions(oversized as UndeliverableInput).map((r) => r.dimension);
  const fifthOnly = undeliverableDimensions([
    undeliverableSource(FIFTH_DIMENSION, MAX_EVIDENCE_BYTES_PER_FILE + 1000)
  ] as UndeliverableInput);

  const floor = outputBudgetForEvidence(0);
  const ceiling = outputBudgetForEvidence(Number.MAX_SAFE_INTEGER);
  let badOverrideThrows = false;
  try {
    resolveOutputBudget(0, { PEAKS_FINAL_REVIEW_MAX_OUTPUT_TOKENS: 'abc' });
  } catch {
    badOverrideThrows = true;
  }

  const result = combineProbes([
    probe(missing.length === 0, `baseline sourceFiles present (${row.sourceFiles.length})`),
    probe(prepared.rejected, `a three-dimension review is refused (${prepared.detail})`),
    probe(prepared.accepted, `a four-dimension review is accepted (${prepared.detail})`),
    probe(
      reported.length === 4 && FOUR_DIMENSIONS.every((d) => reported.includes(d as never)),
      `the canonical dimension set is exactly the four baseline dimensions (reported: ${reported.join(',') || 'none'})`
    ),
    probe(
      fifthOnly.length === 0,
      `the fifth dimension is not part of the required set (reported: ${fifthOnly.length})`
    ),
    probe(
      MAX_EVIDENCE_BYTES_PER_FILE === 10240,
      `per-file evidence cap divides the total by four (${String(MAX_EVIDENCE_BYTES_PER_FILE)})`
    ),
    probe(
      floor === 15288 && ceiling === 32000,
      `output budget is clamped on both ends (${String(floor)} / ${String(ceiling)})`
    ),
    probe(
      badOverrideThrows,
      'a non-integer budget override throws instead of falling back silently'
    )
  ]);

  const artifact = row.sourceFiles[0] ?? 'src/services/final-review/final-review-service.ts';
  if (result.ok) return pass(ctx, artifact);
  return fail(
    ctx,
    artifact,
    'every final review contains exactly four dimensions, and ambiguous ones never auto-pass',
    result.detail,
    'J05 invariant broken: the final review no longer enforces exactly four dimensions'
  );
}

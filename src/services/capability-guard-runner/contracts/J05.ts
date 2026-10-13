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
import type { DimensionKind } from '../../final-review/final-review-types.js';
import type { GuardContext, GuardRunResult } from '../types.js';
import {
  combineProbes,
  fail,
  missingSourceFiles,
  pass,
  probe,
  requireBaselineRow,
  type Probe
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
 * An oversized source that backs `dimension`, in whichever of the two states
 * the allocator can leave it.
 *
 * F3 (review 2026-10-13) — this used to build the omitted shape behind an
 * `as unknown as CollectedEvidence` cast that omitted `excerpt`, so a `found`
 * over-cap source built here would have been reported as "no deliverable
 * source" while a cap-sized head of it had been inlined. The cast is gone and
 * `excerpt` is declared, so the state the report distinguishes cannot be
 * expressed wrongly from this helper.
 */
function overCapSource(dimension: string, totalBytes: number, inlined: boolean): CollectedEvidence {
  return {
    source: {
      key: `k-${dimension}`,
      label: dimension,
      segments: [`${dimension}.md`],
      // The fixture deliberately fabricates dimension names (the fifth one is
      // not a `DimensionKind`), so this ONE field is asserted, not inferred —
      // the rest of the record is fully typed.
      supports: [dimension as DimensionKind],
      delivery: { kind: 'whole' }
    },
    relativePath: `${dimension}.md`,
    absolutePath: `/nonexistent/${dimension}.md`,
    status: inlined ? 'found' : 'omitted',
    totalBytes,
    includedBytes: inlined ? MAX_EVIDENCE_BYTES_PER_FILE : 0,
    excerpt: inlined,
    content: inlined ? 'x'.repeat(MAX_EVIDENCE_BYTES_PER_FILE) : '',
    reason: inlined ? '' : 'over-cap'
  };
}

/**
 * One oversized, omitted source that backs `dimension`. `omitted` + over-cap +
 * zero delivered bytes is the structural case: nothing can ever deliver it.
 */
function undeliverableSource(dimension: string, totalBytes: number): CollectedEvidence {
  return overCapSource(dimension, totalBytes, false);
}

/** `dimension=excerpt|silent` per entry — what the report says ARRIVED. */
function excerptState(report: ReturnType<typeof undeliverableDimensions>): string {
  return report.map((r) => `${r.dimension}=${r.excerptDelivered ? 'excerpt' : 'silent'}`).join(',');
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

/** Measure the output-budget clamp and the refusal of a bad override. */
function probeOutputBudget(): {
  readonly floor: number;
  readonly ceiling: number;
  readonly badOverrideThrows: boolean;
} {
  const floor = outputBudgetForEvidence(0);
  const ceiling = outputBudgetForEvidence(Number.MAX_SAFE_INTEGER);
  let badOverrideThrows = false;
  try {
    resolveOutputBudget(0, { PEAKS_FINAL_REVIEW_MAX_OUTPUT_TOKENS: 'abc' });
  } catch {
    badOverrideThrows = true;
  }
  return { floor, ceiling, badOverrideThrows };
}

/**
 * The over-cap evidence states, as probes.
 *
 * F3 (review 2026-10-13) is the pair that matters: the SAME oversized source,
 * once inlined and once not, has to be reported as two DIFFERENT things. Both
 * are driven here so the report cannot answer "nothing arrived" about a source
 * whose cap-sized head is in the reviewer's prompt.
 *
 * Extracted from `runJ05Contract` so that function stays inside the
 * function-length rule.
 */
function overCapEvidenceProbes(): readonly Probe[] {
  const reported = undeliverableDimensions(
    FOUR_DIMENSIONS.map((d) => undeliverableSource(d, MAX_EVIDENCE_BYTES_PER_FILE + 1000))
  );
  const dimensions = reported.map((r) => r.dimension);
  const fifthOnly = undeliverableDimensions([
    undeliverableSource(FIFTH_DIMENSION, MAX_EVIDENCE_BYTES_PER_FILE + 1000)
  ]);
  const excerptOnly = undeliverableDimensions([
    overCapSource(FOUR_DIMENSIONS[0] as string, MAX_EVIDENCE_BYTES_PER_FILE + 1000, true)
  ]);
  return [
    probe(
      dimensions.length === FOUR_DIMENSIONS.length &&
        FOUR_DIMENSIONS.every((d) => dimensions.includes(d as never)),
      `the canonical dimension set is exactly the four baseline dimensions (reported: ${dimensions.join(',') || 'none'})`
    ),
    probe(
      fifthOnly.length === 0,
      `the fifth dimension is not part of the required set (reported: ${fifthOnly.length})`
    ),
    probe(
      excerptOnly.length === 1 &&
        excerptOnly[0]?.excerptDelivered === true &&
        excerptOnly[0]?.sources[0]?.excerptBytes === MAX_EVIDENCE_BYTES_PER_FILE,
      `an over-cap source that WAS inlined is reported as an excerpt, not as nothing arrived (reported: ${excerptState(excerptOnly)})`
    ),
    probe(
      reported.length === FOUR_DIMENSIONS.length && reported.every((r) => !r.excerptDelivered),
      `an over-cap source that was NOT inlined is reported as nothing arrived (reported: ${excerptState(reported)})`
    )
  ];
}

export async function runJ05Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const row = requireBaselineRow(ctx);
  const missing = missingSourceFiles(ctx, row);

  const prepared = await probePrepareFinalReview();
  const { floor, ceiling, badOverrideThrows } = probeOutputBudget();

  const result = combineProbes([
    probe(missing.length === 0, `baseline sourceFiles present (${row.sourceFiles.length})`),
    probe(prepared.rejected, `a three-dimension review is refused (${prepared.detail})`),
    probe(prepared.accepted, `a four-dimension review is accepted (${prepared.detail})`),
    ...overCapEvidenceProbes(),
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

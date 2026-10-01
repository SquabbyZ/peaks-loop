// tests/unit/final-review/final-review-service.test.ts
//
// D1 regression suite for `prepareFinalReview()`.
//
// The gate this service implements is the ONLY terminator of the 10% human /
// 90% LLM loop, so a dishonest gate is worse than no gate: SKILL.md reads
// `allPass === true` as a clean handoff. Before this fix the service handed the
// reviewer LLM nothing but the approval criteria — no tools, no diff, no test
// results, no filesystem — so the honest answer was 4/4 `inconclusive` and the
// dangerous answer was an invented `pass`.
//
// Every test here is written to FAIL against the pre-fix service. The one that
// carries the defect's core property is "never returns pass when every evidence
// source is missing": the fake runner shouts 4/4 pass and the service must
// refuse to relay it.
//
// Split in C wave 7 (file-size): the remaining scenario families live in the
// sibling `final-review-service-*.test.ts` files beside this one, and the
// shared fixtures moved verbatim to `final-review-service-helpers.ts`.

import { describe, expect, it } from 'vitest';
import {
  IncompleteFinalReviewError,
  MAX_EVIDENCE_BYTES_PER_FILE,
  MAX_EVIDENCE_BYTES_TOTAL,
  MAX_OUTPUT_TOKENS,
  MIN_OUTPUT_TOKENS,
  outputBudgetForEvidence,
  prepareFinalReview,
} from '~/src/services/final-review/final-review-service';
import {
  RID,
  SESSION_ID,
  REQUIRED,
  allVerdicts,
  captureRunner,
  makeGitProject,
  makeProject,
  reviewJson,
  writeAllEvidence,
  writeAuditGoal,
  type Verdict,
} from './final-review-service-helpers.js';
import { HEAVY_SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

describe('prepareFinalReview — on-disk evidence (D1)', () => {
  it(
    'inlines every present evidence source into the prompt',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const root = makeGitProject();
      writeAuditGoal(root, ['AC1: the widget renders', 'AC2: exit code 0']);
      writeAllEvidence(root);

      const { runner, calls } = captureRunner(
        reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
      );
      const out = await prepareFinalReview(RID, {
        projectRoot: root,
        sessionId: SESSION_ID,
        llmRunner: runner
      });

      expect(calls).toHaveLength(1);
      const prompt = calls[0]?.userPrompt ?? '';
      for (const marker of [
        'MARKER-QA-TEST-REPORT',
        'MARKER-QA-TEST-CASES',
        'MARKER-QA-SECURITY',
        'MARKER-QA-PERFORMANCE',
        'MARKER-RD-CODE-REVIEW',
        'MARKER-RD-SECURITY-REVIEW',
        'MARKER-RD-TECH-DOC',
        'MARKER-RD-BUG-ANALYSIS',
        'MARKER-PRD-HANDOFF'
      ]) {
        expect(prompt).toContain(marker);
      }
      expect(prompt).toContain('AC1: the widget renders');
      expect(prompt).toContain('STATUS: FOUND');

      // Evidence existed and backed the passes — including the pre/post baseline
      // the 4th dimension needs — so an honest 4/4 pass survives.
      expect(out.allPass).toBe(true);
      expect(out.needsAttention).toEqual([]);
    }
  );

  it('never returns pass when every evidence source is missing (core D1 property)', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    // No evidence files at all.

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    // (a) The prompt must SAY what is missing, not silently skip it.
    const prompt = calls[0]?.userPrompt ?? '';
    expect(prompt).toContain('MISSING');
    expect(prompt).toContain('no evidence available from');
    expect(prompt).toContain('qa/test-reports');
    expect(prompt).toContain('rd/tech-doc.md');
    // The capsule is rid-scoped since `2026-09-14-prd-capsule-rid-scoping`;
    // `prd/handoff.md` is now only the legacy tier, so with nothing on disk
    // the path the prompt must name is the slice's own.
    expect(prompt).toContain(`prd/handoff-${RID}.md`);

    // (b) The model answered 4/4 pass + allPass:true. The service must not relay
    //     that: with nothing on disk, no dimension can be a pass.
    expect(out.dimensions).toHaveLength(4);
    for (const dimension of out.dimensions) {
      expect(dimension.verdict).toBe('inconclusive');
      expect(dimension.confidence).toBe('low');
    }
    expect(out.allPass).toBe(false);
    expect([...out.needsAttention].sort()).toEqual([...REQUIRED].sort());
  });

  it('downgrades only the pass verdicts; an honest fail is never softened', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);

    const verdicts = { ...allVerdicts('pass'), 'problem-resolution': 'fail' as Verdict };
    const { runner } = captureRunner(
      reviewJson(verdicts, { allPass: false, needsAttention: ['problem-resolution'] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const byDimension = new Map(out.dimensions.map((d) => [d.dimension, d.verdict]));
    expect(byDimension.get('problem-resolution')).toBe('fail');
    expect(byDimension.get('functional-completeness')).toBe('inconclusive');
    expect(out.allPass).toBe(false);
    expect(out.needsAttention).toContain('problem-resolution');
    expect(out.needsAttention).toContain('functional-completeness');
  });

  it('keeps the prompt bounded when the evidence files are oversized', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    // 9 sources x 40 KB on disk = 360 KB of raw evidence.
    writeAllEvidence(root, 'X'.repeat(40 * 1024));

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const prompt = calls[0]?.userPrompt ?? '';
    // Bounded by the byte budget plus the FIXED scaffolding, not by the 360 KB
    // that is actually on disk. The scaffolding is what is left after the
    // allocator spends the whole budget on the first four cap-sized units:
    // measured 8,646 bytes here — the evidence rules, nine status blocks and,
    // new in H2, the reachability block that names this fixture's four
    // undeliverable dimensions (~1.5 KB, 13 source lines). The allowance is
    // 10 KiB rather than 8 KiB for exactly that reason, and it is still an
    // order of magnitude below what a 360 KB evidence set would put here.
    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(
      MAX_EVIDENCE_BYTES_TOTAL + 10 * 1024
    );
    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThan(MAX_EVIDENCE_BYTES_PER_FILE * 9);
    // Truncation and budget exhaustion are both stated, never silent.
    expect(prompt).toContain('TRUNCATED');
    expect(prompt).toContain('MISSING (omitted)');
  });

  it('does not widen a conservative verdict set the model already flagged', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeAllEvidence(root);

    // 4/4 pass but the model itself refuses to call it clean.
    const { runner } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: false, needsAttention: ['no-new-bugs'] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    expect(out.allPass).toBe(false);
    expect(out.needsAttention).toContain('no-new-bugs');
  });
});

// ---------------------------------------------------------------------------
// F3 — the pre/post-diff gate exempted one cause of a missing baseline.
//
// The gate's job is structural: a `pass` on `existing-functionality-intact`
// whose supporting evidence is absent must be downgraded. It excluded one cause
// of absence — "this project is not a git work tree" — on the reasoning that a
// non-git consumer would otherwise be permanently red. Both halves of that are
// wrong. The permanently red verdict is the HONEST one (nothing was ever
// compared: the dimension really has not been assessed), and green-with-no-
// evidence is a forged clean handoff. And supplying a REASON for the missing
// evidence is exactly the exemption the structural gate exists to refuse — a
// `pass` whose evidence is all missing is downgraded elsewhere, and it must not
// be let through here by explaining the absence away.
//
// Measured, before the change: non-git project, every evidence source present,
// model replies 4/4 pass ⇒ `existing-functionality-intact` verdict=pass,
// evidence.length=0, allPass=true.
// ---------------------------------------------------------------------------
describe('prepareFinalReview — the pre/post-diff gate covers every cause (F3)', () => {
  it('downgrades an evidence-free pass on a non-git project instead of relaying it', async () => {
    const root = makeProject(); // deliberately NOT a git work tree
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeAllEvidence(root);

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    // The reviewer is told the baseline cannot exist, and told why.
    const prompt = calls[0]?.userPrompt ?? '';
    expect(prompt).toContain('STATUS: UNAVAILABLE');
    expect(prompt).toContain('not inside a git work tree');

    const dimension = out.dimensions.find((d) => d.dimension === 'existing-functionality-intact');
    // The three measured facts of the defect, asserted directly: the verdict is
    // downgraded, there is no fabricated `pre-post-diff` evidence, and the
    // envelope is not a clean handoff.
    expect(dimension?.verdict).toBe('inconclusive');
    expect(dimension?.confidence).toBe('low');
    expect(
      (dimension?.evidence ?? []).filter((item) => item.kind === 'pre-post-diff')
    ).toHaveLength(0);
    expect(out.allPass).toBe(false);
    expect(out.needsAttention).toContain('existing-functionality-intact');
    // The CAUSE of the missing evidence is named in the reason — named as the
    // cause, not treated as the licence to trust the claim.
    expect(dimension?.summary).toContain('pre-post-diff-gate');
    expect(dimension?.summary).toContain('not a git work tree');

    // Exactly one dimension is narrowed: this gate must not redden the review.
    const others = out.dimensions.filter((d) => d.dimension !== 'existing-functionality-intact');
    expect(others).toHaveLength(3);
    for (const other of others) expect(other.verdict).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// D1 layer 3 — the OUTPUT budget.
//
// Layer 1 (above) raised the prompt to 32 KiB of inlined evidence but left the
// output ceiling hard-coded at 3000 tokens, so 3/3 real provider runs returned
// no usable envelope (2x JSON cut off mid-string). These three tests pin the
// fix: the ceiling follows the evidence, and a truncated reply says so.
//
// All three FAIL against the pre-fix service (a constant `maxTokens: 3000` and
// a bare "LLM output is not valid JSON" message).
// ---------------------------------------------------------------------------
describe('prepareFinalReview — output budget (D1 layer 3)', () => {
  /**
   * Measured against the REAL provider on this repo's own machine, rid
   * `2026-09-12-codegraph-exclude-integrity`, 9 sources / 32,768 bytes
   * inlined, `deepseek-flash[1M]` via `api.deepseek.com/anthropic`.
   *
   * The 4775 this used to hold was the number that produced the FIRST fix —
   * and it did not reproduce. Re-measured 2026-09-12 (QA 3/3 red, orchestrator
   * 3/3 red on a byte-identical prompt), the same pack needs **10108** output
   * tokens: `max_tokens=7096` (what the old formula derived) truncated,
   * `max_tokens=8192` truncated with only 574 visible characters, and only
   * `16000`/`32000` completed. Pinning the budget to the disproven 4775 is
   * what left the shipped gate flaky.
   */
  const MEASURED_OUTPUT_TOKENS_FOR_MAX_PACK = 10108;
  const PRE_FIX_MAX_TOKENS = 3000;

  const fourPasses = (): string =>
    reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] });

  it('scales the output ceiling with the inlined evidence, never below the pre-fix value', async () => {
    const smallRoot = makeProject();
    writeAuditGoal(smallRoot, ['AC1']);
    writeAllEvidence(smallRoot); // ~0.6 KB of markers: nothing to cite in depth

    const bigRoot = makeProject();
    writeAuditGoal(bigRoot, ['AC1']);
    writeAllEvidence(bigRoot, 'X'.repeat(40 * 1024)); // saturates the 40 KB input cap

    const small = captureRunner(fourPasses());
    await prepareFinalReview(RID, {
      projectRoot: smallRoot,
      sessionId: SESSION_ID,
      llmRunner: small.runner
    });
    const big = captureRunner(fourPasses());
    await prepareFinalReview(RID, {
      projectRoot: bigRoot,
      sessionId: SESSION_ID,
      llmRunner: big.runner
    });

    const smallBudget = small.calls[0]?.maxTokens ?? 0;
    const bigBudget = big.calls[0]?.maxTokens ?? 0;

    // No evidence set is worse off than it was before this fix.
    expect(smallBudget).toBeGreaterThanOrEqual(PRE_FIX_MAX_TOKENS);
    expect(smallBudget).toBeGreaterThanOrEqual(MIN_OUTPUT_TOKENS);
    // A bigger pack buys a bigger ceiling — the property the constant broke.
    expect(bigBudget).toBeGreaterThan(smallBudget);
    // Tied to the measurement, not to a magic number: the biggest pack the input
    // caps allow must clear what the real provider actually needed for it.
    expect(bigBudget).toBeGreaterThanOrEqual(MEASURED_OUTPUT_TOKENS_FOR_MAX_PACK);
    // ...while staying inside what a Messages-API-compatible model will accept.
    expect(bigBudget).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS);
    // The saturated pack is priced by its inlined bytes, not by the 360 KB on disk.
    expect(bigBudget).toBe(outputBudgetForEvidence(MAX_EVIDENCE_BYTES_TOTAL));
  });

  it('reports a truncated reply as an output-budget failure, not as bad JSON', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root);

    const full = fourPasses();
    // The observed failure mode: the reply stops in the middle of the envelope,
    // which lands mid-string and with the root object still open.
    const truncated = full.slice(0, Math.floor(full.length * 0.7));

    const { runner } = captureRunner(truncated);
    const error: unknown = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IncompleteFinalReviewError);
    const message = (error as Error).message;
    // A reader must be able to tell "raise the budget" from "fix the schema".
    expect(message).toContain('TRUNCATED');
    expect(message).toContain('OUTPUT-BUDGET');
    expect(message).toContain('maxTokens=');
    expect(message).not.toContain('is not valid JSON');
  });

  it('names the exhausted budget when a parseable reply is missing a dimension', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root);

    const partial = JSON.stringify({
      rid: RID,
      generatedAt: '2026-09-12T00:00:00.000Z',
      dimensions: REQUIRED.slice(0, 3).map((dimension) => ({
        dimension,
        verdict: 'pass',
        summary: 's',
        evidence: [],
        confidence: 'high'
      })),
      overallSummary: 'cut short after the third dimension',
      allPass: false,
      needsAttention: []
    });

    // The provider reports it stopped exactly at the ceiling it was given.
    const { runner } = captureRunner(partial, (maxTokens) => maxTokens);
    const error: unknown = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IncompleteFinalReviewError);
    const message = (error as Error).message;
    expect(message).toContain('Missing required dimensions');
    expect(message).toContain('hit the output budget');
    expect(message).toContain('maxTokens=');
  });
});

describe('prepareFinalReview — output contract', () => {
  it('throws IncompleteFinalReviewError on non-JSON output', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root);

    const { runner } = captureRunner('not json at all');
    await expect(
      prepareFinalReview(RID, { projectRoot: root, sessionId: SESSION_ID, llmRunner: runner })
    ).rejects.toBeInstanceOf(IncompleteFinalReviewError);
  });

  it('throws IncompleteFinalReviewError when a required dimension is absent', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root);

    const partial = JSON.stringify({
      rid: RID,
      generatedAt: '2026-09-12T00:00:00.000Z',
      dimensions: REQUIRED.slice(0, 3).map((dimension) => ({
        dimension,
        verdict: 'pass',
        summary: 's',
        evidence: [],
        confidence: 'high'
      })),
      overallSummary: 'partial',
      allPass: false,
      needsAttention: []
    });
    const { runner } = captureRunner(partial);
    await expect(
      prepareFinalReview(RID, { projectRoot: root, sessionId: SESSION_ID, llmRunner: runner })
    ).rejects.toBeInstanceOf(IncompleteFinalReviewError);
  });

  it('still throws when the approved audit goal is unreadable', async () => {
    const root = makeProject();
    const { runner } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    await expect(
      prepareFinalReview(RID, { projectRoot: root, sessionId: SESSION_ID, llmRunner: runner })
    ).rejects.toThrow(/Cannot read approved goal/);
  });
});

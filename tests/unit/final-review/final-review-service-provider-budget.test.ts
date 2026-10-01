// tests/unit/final-review/final-review-service-provider-budget.test.ts
//
// N4 output-budget/empty-reply/truncation-signal and the F1 floor blocks,
// split verbatim out of `final-review-service.test.ts` (C wave 7 file-size
// work).

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EmptyReviewReplyError,
  HARD_MAX_OUTPUT_TOKENS,
  IncompleteFinalReviewError,
  MAX_EMPTY_REPLY_ATTEMPTS,
  MAX_EVIDENCE_BYTES_TOTAL,
  MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS_ENV,
  MIN_OUTPUT_TOKENS,
  REASONING_HEADROOM_TOKENS,
  outputBudgetForEvidence,
  prepareFinalReview,
  resolveOutputBudget,
  type LlmRunner
} from '~/src/services/final-review/final-review-service';
import {
  RID,
  SESSION_ID,
  REQUIRED,
  allVerdicts,
  captureRunner,
  dimensionsCovered,
  fourPassesJson,
  makeGitProject,
  makeProject,
  parseRenderedSources,
  reviewJson,
  writeAllEvidence,
  writeAuditGoal,
  writeRealSizedEvidence
} from './final-review-service-helpers.js';
import {
  HEAVY_SUBPROCESS_TEST_TIMEOUT_MS,
  SUBPROCESS_TEST_TIMEOUT_MS
} from '../_setup/subprocess-timeouts.js';

// ---------------------------------------------------------------------------
// N4 — the output budget was BELOW what the bound model needs, and the gate it
// controls was therefore flaky (measured 3/3 red twice, independently).
//
// The first fix derived `3000 + bytes/8` and called 8192 "a backstop only: it
// does not bind today". Both halves of that were wrong on the machine the gate
// ships on: the 4775-token measurement did not reproduce (the same pack needs
// 10108), and 8192 did bind. Two aggravating facts the model has to account
// for: `max_tokens` also caps hidden reasoning on a reasoning model (8192
// bought 574 visible characters), and the endpoint's usage reporting is not
// trustworthy in either direction (~32 KiB prompt reported as
// `input_tokens: 150`), so a single arithmetic signal cannot carry the
// diagnosis.
// ---------------------------------------------------------------------------
describe('prepareFinalReview — the output budget survives the real provider (N4)', () => {
  /**
   * The value that was EMPIRICALLY OBSERVED to truncate, on the same machine
   * and prompt, AFTER the first raise: 10 real runs, 2 failures, both genuine
   * truncation, and the second one reported BOTH the structural and the usage
   * signal at `maxTokens=13240`.
   *
   * This is the assertion that matters. A budget merely above the last
   * SUCCESS (10108) is not above the requirement, because the requirement
   * moves with the model's reasoning spend.
   */
  const OBSERVED_TRUNCATION_AT_MAX_PACK = 13_240;

  const fourPasses = (): string =>
    reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] });

  it('should derive a budget that clears the RE-MEASURED need for the largest pack', () => {
    const derived = outputBudgetForEvidence(MAX_EVIDENCE_BYTES_TOTAL);

    // Before the fix this was 7096 — below the 10108 the same pack actually
    // needed, which is why the shipped gate truncated 3/3.
    expect(derived).toBeGreaterThanOrEqual(10108);
    // ...and above the value that was still truncating after the first raise.
    expect(derived).toBeGreaterThan(OBSERVED_TRUNCATION_AT_MAX_PACK);
    // The ceiling no longer "does not bind": it is above the derived value.
    expect(derived).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS);
    // The reasoning headroom the 8:1 bytes-per-token term cannot see.
    expect(outputBudgetForEvidence(0)).toBeGreaterThanOrEqual(
      MIN_OUTPUT_TOKENS + REASONING_HEADROOM_TOKENS
    );
  });

  it('should pass the re-measured budget to the runner for a saturated evidence pack', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root, 'X'.repeat(40 * 1024)); // saturates the 40 KB input cap

    const { runner, calls } = captureRunner(fourPasses());
    await prepareFinalReview(RID, { projectRoot: root, sessionId: SESSION_ID, llmRunner: runner });

    expect(calls[0]?.maxTokens).toBeGreaterThanOrEqual(10108);
  });

  it(`should let ${MAX_OUTPUT_TOKENS_ENV} raise the ceiling without a code change`, () => {
    const derived = outputBudgetForEvidence(MAX_EVIDENCE_BYTES_TOTAL);
    // The failure message told the operator to "raise the budget" while no
    // surface could raise it. It can now.
    expect(
      resolveOutputBudget(MAX_EVIDENCE_BYTES_TOTAL, { [MAX_OUTPUT_TOKENS_ENV]: '32000' })
    ).toBe(32000);
    expect(
      resolveOutputBudget(MAX_EVIDENCE_BYTES_TOTAL, { [MAX_OUTPUT_TOKENS_ENV]: '32000' })
    ).toBeGreaterThan(derived);
    // Unset keeps the derived budget.
    expect(resolveOutputBudget(MAX_EVIDENCE_BYTES_TOTAL, {})).toBe(derived);
    expect(resolveOutputBudget(MAX_EVIDENCE_BYTES_TOTAL, { [MAX_OUTPUT_TOKENS_ENV]: '   ' })).toBe(
      derived
    );
    // Out-of-range is clamped, not refused: a call still gets made.
    expect(resolveOutputBudget(0, { [MAX_OUTPUT_TOKENS_ENV]: '999999' })).toBe(
      HARD_MAX_OUTPUT_TOKENS
    );
    expect(resolveOutputBudget(0, { [MAX_OUTPUT_TOKENS_ENV]: '1' })).toBe(MIN_OUTPUT_TOKENS);
  });

  it(`should fail LOUDLY on an unusable ${MAX_OUTPUT_TOKENS_ENV} instead of ignoring it`, () => {
    // A lever that silently does nothing is the defect this lever exists to
    // fix, so a bad value names itself instead of falling back.
    for (const bad of ['abc', '0', '-1', '12.5', '10k']) {
      expect(() => resolveOutputBudget(0, { [MAX_OUTPUT_TOKENS_ENV]: bad })).toThrow(
        new RegExp(MAX_OUTPUT_TOKENS_ENV)
      );
    }
  });

  it('should use the env budget for the real call', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root, 'X'.repeat(40 * 1024));

    const { runner, calls } = captureRunner(fourPasses());
    const saved = process.env[MAX_OUTPUT_TOKENS_ENV];
    process.env[MAX_OUTPUT_TOKENS_ENV] = '32000';
    try {
      await prepareFinalReview(RID, {
        projectRoot: root,
        sessionId: SESSION_ID,
        llmRunner: runner
      });
    } finally {
      if (saved === undefined) delete process.env[MAX_OUTPUT_TOKENS_ENV];
      else process.env[MAX_OUTPUT_TOKENS_ENV] = saved;
    }

    expect(calls[0]?.maxTokens).toBe(32000);
  });
});

describe('prepareFinalReview — an empty reply is its own failure mode (N4)', () => {
  /**
   * The runner's fixed wording for a response with no text block — measured
   * 2/3 on this repo's machine, alongside the truncation it was previously
   * conflated with.
   */
  function emptyReplyRunner(): { runner: LlmRunner; attempts: () => number } {
    let attempts = 0;
    const runner: LlmRunner = {
      async call() {
        attempts += 1;
        throw new Error('LLM reply from https://example.invalid/v1/messages carried no text block');
      }
    };
    return { runner, attempts: () => attempts };
  }

  it('should retry an empty reply and return the review when a later attempt answers', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root);

    let attempts = 0;
    const runner: LlmRunner = {
      async call() {
        attempts += 1;
        if (attempts === 1) {
          throw new Error(
            'LLM reply from https://example.invalid/v1/messages carried no text block'
          );
        }
        return { output: fourPassesJson(), tokens: { input: 10, output: 10 } };
      }
    };

    const review = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    // The 2/3 failure measured on this machine is intermittent — one retry
    // turns it back into a completed review instead of a red gate.
    expect(attempts).toBe(2);
    expect(review.dimensions).toHaveLength(4);
  });

  it('should classify a persistent empty reply as EMPTY, never as truncation', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root);

    const { runner, attempts } = emptyReplyRunner();
    const error: unknown = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    }).catch((caught: unknown) => caught);

    expect(attempts()).toBe(MAX_EMPTY_REPLY_ATTEMPTS);
    expect(error).toBeInstanceOf(EmptyReviewReplyError);
    const message = (error as Error).message;
    // The two failure modes must not be confused: "raise the budget" is the
    // WRONG advice for an empty reply.
    expect(message).toContain('NO TEXT BLOCK');
    expect(message).toContain('EMPTY-REPLY');
    expect(message).toContain('NOT an output-budget truncation');
    expect(message).toContain('no text block');
  });

  it('should not retry a transport failure that is not an empty reply', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root);

    let attempts = 0;
    const runner: LlmRunner = {
      async call() {
        attempts += 1;
        throw new Error('LLM request to https://example.invalid/v1/messages failed: HTTP 500');
      }
    };

    await expect(
      prepareFinalReview(RID, { projectRoot: root, sessionId: SESSION_ID, llmRunner: runner })
    ).rejects.toThrow(/HTTP 500/);
    expect(attempts).toBe(1);
  });
});

describe('prepareFinalReview — which signal diagnosed the truncation (N4)', () => {
  it('should report the STRUCTURAL signal when the reply ends mid-structure', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root);

    const full = reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] });
    // Cut mid-string with the root object still open, and a provider that
    // reports nothing useful — the ONLY usable signal is the structure.
    const { runner } = captureRunner(full.slice(0, Math.floor(full.length * 0.7)), 0);
    const error: unknown = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IncompleteFinalReviewError);
    const message = (error as Error).message;
    expect(message).toContain('TRUNCATED');
    expect(message).toContain('structural');
    // ...and it says where the lever is.
    expect(message).toContain(MAX_OUTPUT_TOKENS_ENV);
  });

  it('should NOT blame the budget for a malformed reply that is structurally closed', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1']);
    writeAllEvidence(root);

    // A complete-but-wrong document: braces closed, no truncation. The old
    // code said "not valid JSON" here and still must.
    const { runner } = captureRunner('{ "this is": not json }', 0);
    const error: unknown = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IncompleteFinalReviewError);
    const message = (error as Error).message;
    expect(message).toContain('not valid JSON');
    expect(message).not.toContain('TRUNCATED');
  });
});

describe('prepareFinalReview — the floor protects the source the GATE needs (F1)', () => {
  it(
    'delivers BOTH contract sources whole at the real machine sizes',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // Measured on this repo's own run: the ten units sum to ~78 KB against a
      // 40,960-byte budget, so six sources must lose. Pre-F1 the two that lost
      // were the two the delivery gates rest on — necessarily, because both sit
      // last in the order and neither was a floor holder — and two of the four
      // dimensions were `inconclusive` on every run.
      const root = makeGitProject();
      writeAuditGoal(root, ['AC1: the widget renders']);
      writeRealSizedEvidence(root);

      const { runner, calls } = captureRunner(
        reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
      );
      const out = await prepareFinalReview(RID, {
        projectRoot: root,
        sessionId: SESSION_ID,
        llmRunner: runner
      });

      const prompt = calls[0]?.userPrompt ?? '';
      const rendered = parseRenderedSources(prompt);
      const handoff = rendered.find((s) => s.key === 'prd-handoff');
      const ppd = rendered.find((s) => s.key === 'final-review-pre-post-diff');

      // The approved-scope contract arrives WHOLE — 8,164 of 8,164 bytes, which is
      // the `whole` delivery rule and, before F1, was unreachable because the
      // budget was spent before source 8 was opened.
      expect(handoff?.status).toBe('found');
      expect(handoff?.includedBytes).toBe(8164);
      // The baseline the 4th dimension is defined by arrives too, whole, and the
      // conclusion travels with it.
      expect(ppd?.status).toBe('found');
      expect(prompt).toContain('VERDICT: ');

      // The two dimensions that were structurally locked to `inconclusive` are
      // judged on delivered evidence, and neither delivery gate fires.
      const functional = out.dimensions.find((d) => d.dimension === 'functional-completeness');
      const intact = out.dimensions.find((d) => d.dimension === 'existing-functionality-intact');
      expect(functional?.verdict).toBe('pass');
      expect(functional?.confidence).toBe('high');
      expect(functional?.summary).not.toContain('scope-contract-gate');
      expect(intact?.verdict).toBe('pass');
      expect(intact?.summary).not.toContain('pre-post-diff-gate');

      // All four dimensions have delivered evidence — 4/4, not 2/4.
      expect([...dimensionsCovered(prompt)].sort()).toEqual([...REQUIRED].sort());
      expect(out.allPass).toBe(true);
      expect(out.needsAttention).toEqual([]);

      // The floor is what makes it affordable, and the arithmetic is the one QA
      // verified: the three gate-source units fit the total.
      const artifact = join(root, '.peaks', '_runtime', SESSION_ID, 'final-review', 'api-diff.txt');
      expect(8164 + statSync(artifact).size).toBeLessThan(MAX_EVIDENCE_BYTES_TOTAL);
    }
  );

  it(
    'keeps a floor on the gate sources even when the gate source is not the first mention',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // The property, stated as arithmetic rather than as an example: whatever
      // the allocator does, the sources whose delivery the gates depend on may
      // not be the ones it starves. Pre-F1 `qa-test-report` (index 0) held
      // `functional-completeness`'s floor and `rd/tech-doc` (index 6) held
      // `existing-functionality-intact`'s — the first is the source the budget can
      // never starve anyway, and the second is the source prompt rule 6 declares
      // INSUFFICIENT for that dimension.
      const root = makeGitProject();
      writeAuditGoal(root, ['AC1: the widget renders']);
      writeRealSizedEvidence(root);

      const { runner, calls } = captureRunner(
        reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
      );
      await prepareFinalReview(RID, {
        projectRoot: root,
        sessionId: SESSION_ID,
        llmRunner: runner
      });

      const rendered = parseRenderedSources(calls[0]?.userPrompt ?? '');
      // `rd/tech-doc.md` is the source F1 took the floor from, and it is the one
      // that loses now — a redundant design-intent document, not the comparison.
      expect(rendered.find((s) => s.key === 'rd-tech-doc')?.status).toBe('omitted');
      expect(rendered.find((s) => s.key === 'prd-handoff')?.status).toBe('found');
      expect(rendered.find((s) => s.key === 'final-review-pre-post-diff')?.status).toBe('found');
    }
  );
});

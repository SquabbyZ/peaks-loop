// src/services/final-review/final-review-reviewer.ts
//
// The reviewer call itself: the system prompt, the empty-reply retry
// classification and the output-budget diagnostics that turn a truncated
// reply into a diagnosable error. Hoisted verbatim from
// final-review-service.ts (C wave 7 file-size split).

import type { LlmRunner } from './final-review-contract.js';

const SYSTEM_PROMPT = `You are preparing a 4-dimension business review for human acceptance. Produce a JSON response with EXACTLY these fields:
- rid (string)
- generatedAt (ISO timestamp)
- dimensions (array of EXACTLY 4 objects, one per dimension: functional-completeness, problem-resolution, no-new-bugs, existing-functionality-intact; each with dimension, verdict (pass | fail | inconclusive), summary, evidence (list of {kind, description, [artifact], [link]}), confidence (high | medium | low))
- overallSummary (one paragraph)
- allPass (boolean)
- needsAttention (list of dimension names that need human attention)

Output ONLY valid JSON, no prose.`;

/**
 * N4 — the reply carried no text block at all.
 *
 * Measured 2/3 on this repo's own machine, and it is NOT truncation: the
 * provider answered with a response whose `content` has no `text` block (a
 * reasoning-only turn, a refusal, or a content filter), so there is no JSON to
 * parse and no budget to raise — an operator sent to "raise the budget" for
 * this failure would be sent the wrong way. It gets its own class, its own
 * `code`, and a message that says so, so it is diagnosable instead of being
 * flattened into "not valid JSON".
 */
export class EmptyReviewReplyError extends Error {
  readonly code = 'EMPTY_FINAL_REVIEW_REPLY' as const;
  constructor(message: string) {
    super(message);
    this.name = 'EmptyReviewReplyError';
  }
}

/**
 * How many times an empty reply is retried before it is reported. The failure
 * was 2/3 on the observed machine — intermittent, not systematic — so a small
 * bounded retry converts most of it into a completed review, while 3 attempts
 * keeps a genuinely broken provider from being hammered.
 */
export const MAX_EMPTY_REPLY_ATTEMPTS = 3;

/** The runner's own wording for "the response had no text block to return". */
function isEmptyReplyError(error: unknown): boolean {
  return error instanceof Error && /no text block/i.test(error.message);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The facts an operator needs to tell a budget problem from a format problem. */
export function describeOutputBudget(
  maxTokens: number,
  outputTokens: number,
  characters: number
): string {
  return `output budget: maxTokens=${maxTokens}, provider-reported output tokens=${outputTokens}, characters returned=${characters}`;
}

/**
 * N4 — say WHICH signal diagnosed the truncation, and flag the provider's usage
 * numbers when they are the only thing pointing at the ceiling. Measured on
 * this repo's machine: `input_tokens: 150` for a ~32 KiB prompt, so a reporter
 * that cannot count the input should not be trusted to count the output.
 */
export function describeTruncationSignal(
  structurallyCut: boolean,
  ceilingReached: boolean
): string {
  if (structurallyCut && ceilingReached) {
    return 'reply ends mid-structure AND provider-reported output reached the ceiling';
  }
  if (structurallyCut) {
    return 'reply ends mid-structure (structural)';
  }
  return 'provider-reported output reached the ceiling only — the provider’s usage reporting is not trustworthy on its own, so verify before raising anything';
}

/**
 * N4 — call the reviewer, retrying an EMPTY reply a bounded number of times.
 *
 * The empty reply is a separate failure mode from truncation and was measured
 * at 2/3 on this repo's machine. It is intermittent, so a bounded retry turns
 * most occurrences back into a completed review; when it does not, the caller
 * gets `EmptyReviewReplyError` — classified and diagnosable — instead of a
 * truncation message that sends the operator to raise a budget that was never
 * the problem.
 *
 * The classification reads the runner's message because `LlmRunner` is a
 * structural interface here (this module deliberately does not depend on the
 * concrete provider module); "no text block" is the runner's own fixed wording
 * for a response with no text content.
 */
export async function callReviewer(
  runner: LlmRunner,
  userPrompt: string,
  budget: { readonly maxTokens: number; readonly derivedMaxTokens: number }
): Promise<{ output: string; tokens: { input: number; output: number } }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_EMPTY_REPLY_ATTEMPTS; attempt += 1) {
    try {
      return await runner.call(SYSTEM_PROMPT, userPrompt, { maxTokens: budget.maxTokens });
    } catch (error) {
      if (!isEmptyReplyError(error)) throw error;
      lastError = error;
    }
  }
  throw new EmptyReviewReplyError(
    `The provider returned NO TEXT BLOCK on ${String(MAX_EMPTY_REPLY_ATTEMPTS)}/${String(MAX_EMPTY_REPLY_ATTEMPTS)} attempts — this is an EMPTY-REPLY failure, NOT an output-budget truncation: the response carried no text content (a reasoning-only turn, a refusal, or a content filter), so there was no JSON to parse and raising the budget would not have helped. ${describeOutputBudget(budget.maxTokens, 0, 0)}. Last provider error: ${errorText(lastError)}`
  );
}

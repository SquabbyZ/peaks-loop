// src/services/final-review/final-review-runner.ts
//
// The orchestration of prepareFinalReview. Hoisted from
// final-review-service.ts (C wave 7 file-size split): the body is
// HEAD-verbatim with the goal read, the prompt assembly, the reply
// parsing, the dimension-presence check and the gate chain each lifted
// into a named step so every function stays under the repo
// function-length rule. The service module re-exports prepareFinalReview
// so no importer changed; the gates it calls are the service module's
// own (guard C keeps them there), which is why this file imports the
// service module back.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyPrePostDiffVerdict,
  producePrePostDiff,
  type PrePostDiffConclusion,
  type PrePostDiffResult
} from './pre-post-diff.js';
import { collectEvidence } from './final-review-evidence-collect.js';
import {
  PRE_POST_DIFF_SOURCE_KEY,
  type CollectedEvidence
} from './final-review-evidence-sources.js';
import {
  MAX_OUTPUT_TOKENS_ENV,
  outputBudgetForEvidence,
  resolveOutputBudget
} from './final-review-output-budget.js';
import {
  EVIDENCE_RULES,
  renderDeliveryReachabilityStatus,
  renderEvidenceSection,
  renderPrePostDiffStatus
} from './final-review-prompt.js';
import {
  callReviewer,
  describeOutputBudget,
  describeTruncationSignal
} from './final-review-reviewer.js';
import {
  clampInconclusiveConfidence,
  enforceEvidenceBackedVerdicts
} from './final-review-gates.js';
import {
  enforceDeliveryReachability,
  undeliverableDimensions,
  type UndeliverableDimensionEvidence
} from './final-review-delivery.js';
import { REQUIRED_DIMENSIONS } from './final-review-evidence-budget.js';
import { enforceStructuralDriftAttention, summarizeVerdicts } from './final-review-verdicts.js';
import {
  IncompleteFinalReviewError,
  type PrepareFinalReviewOptions
} from './final-review-contract.js';
import {
  dimensionsWithEvidence,
  enforcePrePostDiffAvailability,
  enforceScopeContractDelivery,
  attachPrePostDiffEvidence,
  looksTruncated,
  prePostDiffDelivered
} from './final-review-service.js';
import type { DimensionEvidence, DimensionKind, FinalReviewOutput } from './final-review-types.js';

interface ReviewerResponse {
  readonly output: string;
  readonly tokens: { readonly input: number; readonly output: number };
}

function readApprovedGoal(
  opts: PrepareFinalReviewOptions,
  rid: string
): { readonly successCriteria: readonly string[] } {
  const auditGoalPath = join(
    opts.projectRoot,
    '.peaks',
    '_runtime',
    opts.sessionId,
    'audit-goal',
    `${rid}.json`
  );
  try {
    return JSON.parse(readFileSync(auditGoalPath, 'utf8')) as {
      successCriteria: readonly string[];
    };
  } catch (err) {
    throw new Error(`Cannot read approved goal from ${auditGoalPath}: ${(err as Error).message}`);
  }
}

function assembleUserPrompt(args: {
  readonly approvedGoal: { readonly successCriteria: readonly string[] };
  readonly evidence: readonly CollectedEvidence[];
  readonly prePostDiff: PrePostDiffResult;
  readonly ppdDelivered: boolean;
  readonly reachabilityStatus: string;
}): string {
  const { approvedGoal, evidence, ppdDelivered, prePostDiff, reachabilityStatus } = args;
  return [
    `Approved goal's success criteria: ${JSON.stringify(approvedGoal.successCriteria)}`,
    '',
    '## On-disk evidence',
    'You have NO tools and NO filesystem access — the blocks below are ALL the evidence that exists for this review. They were collected read-only by the service; nothing was executed.',
    '',
    renderEvidenceSection(evidence),
    '',
    renderPrePostDiffStatus(prePostDiff, ppdDelivered),
    '',
    ...(reachabilityStatus === '' ? [] : [reachabilityStatus, '']),
    EVIDENCE_RULES,
    '',
    'Prepare the 4-dim review evidence.'
  ].join('\n');
}

function parseReviewerReply(response: ReviewerResponse, maxTokens: number): FinalReviewOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.output);
  } catch (err) {
    const budget = describeOutputBudget(maxTokens, response.tokens.output, response.output.length);
    // N4 — the STRUCTURAL judgement is primary: `looksTruncated()` reads the
    // reply itself and needs no cooperation from the provider. The
    // `output_tokens >= maxTokens` comparison is kept as a corroborating
    // signal, but it cannot be the only one: this endpoint reported
    // `input_tokens: 150` for a ~32 KiB prompt, so its usage numbers are not
    // trustworthy on their own, and a provider that under-reports a truncated
    // reply would otherwise have it filed below as "not valid JSON" — sending
    // an operator to look for a schema bug that does not exist. Which signal
    // fired is reported, so the diagnosis is auditable rather than inferred.
    const structurallyCut = looksTruncated(response.output);
    const ceilingReached = response.tokens.output >= maxTokens;
    if (structurallyCut || ceilingReached) {
      throw new IncompleteFinalReviewError(
        `LLM output was TRUNCATED by the output budget before the 4-dim envelope was complete — this is an OUTPUT-BUDGET failure, not a malformed reply. Raise the budget: it scales with inlined evidence bytes, and ${MAX_OUTPUT_TOKENS_ENV} overrides it outright for this run. Signal: ${describeTruncationSignal(structurallyCut, ceilingReached)}. ${budget}. Parser said: ${(err as Error).message}`
      );
    }
    throw new IncompleteFinalReviewError(
      `LLM output is not valid JSON: ${(err as Error).message} (${budget})`
    );
  }
  return parsed as FinalReviewOutput;
}

function ensureRequiredDimensions(
  output: FinalReviewOutput,
  response: ReviewerResponse,
  maxTokens: number
): void {
  const presentDimensions = new Set<DimensionKind>(
    output.dimensions.map((d: DimensionEvidence) => d.dimension)
  );
  const missing = REQUIRED_DIMENSIONS.filter((d) => !presentDimensions.has(d));
  if (missing.length > 0) {
    // A reply that stopped at the ceiling and still parsed is still a budget
    // problem, so the same diagnosis is attached here. N4: the structural
    // reading counts too — a reply cut off mid-array parses only because the
    // envelope it produced happened to be closed early.
    const budgetExhausted = response.tokens.output >= maxTokens || looksTruncated(response.output);
    throw new IncompleteFinalReviewError(
      `Missing required dimensions: ${missing.join(', ')}${
        budgetExhausted
          ? ` — the provider hit the output budget and the reply was cut short (${describeOutputBudget(maxTokens, response.tokens.output, response.output.length)}); raise the budget instead of retrying blindly.`
          : ''
      }`
    );
  }
}

function applyVerdictGates(args: {
  readonly dimensions: readonly DimensionEvidence[];
  readonly evidence: readonly CollectedEvidence[];
  readonly prePostDiff: PrePostDiffResult;
  readonly undeliverable: readonly UndeliverableDimensionEvidence[];
}): readonly DimensionEvidence[] {
  const { dimensions, evidence, prePostDiff, undeliverable } = args;
  return attachPrePostDiffEvidence(
    enforceDeliveryReachability(
      enforceScopeContractDelivery(
        enforcePrePostDiffAvailability(
          enforceEvidenceBackedVerdicts(
            clampInconclusiveConfidence(dimensions),
            dimensionsWithEvidence(evidence)
          ),
          prePostDiff,
          evidence
        ),
        evidence
      ),
      undeliverable
    ),
    prePostDiff,
    evidence
  );
}

export async function prepareFinalReview(
  rid: string,
  opts: PrepareFinalReviewOptions
): Promise<FinalReviewOutput> {
  const approvedGoal = readApprovedGoal(opts, rid);

  // The pre/post baseline diff is produced BEFORE the read phase: it is the one
  // step in this service that runs a command (`git`, read-only) and writes a
  // file, and it has to finish first because its artifact is also an evidence
  // source below. Everything after this line is still pure file reading.
  const prePostDiff = producePrePostDiff({
    projectRoot: opts.projectRoot,
    sessionId: opts.sessionId,
    ...(opts.baseRef === undefined ? {} : { baseRef: opts.baseRef })
  });

  const evidence = collectEvidence(
    opts.projectRoot,
    opts.sessionId,
    rid,
    prePostDiff.status === 'computed'
  );

  // F-BLOCK: the fourth dimension needs the baseline to have been DELIVERED,
  // not merely computed, so the delivery fact is measured on the collected
  // evidence (what the prompt carries) rather than read off the producer's
  // status (what exists on disk).
  const ppdDelivered = prePostDiffDelivered(evidence);

  // H2: a dimension whose every on-disk source is structurally undeliverable is
  // a fact about the EVIDENCE, so it is measured where the evidence is and
  // stated in both the prompt and the envelope — an always-red dimension that
  // explains itself is a finding; one that does not is noise.
  const undeliverable = undeliverableDimensions(evidence);
  const reachabilityStatus = renderDeliveryReachabilityStatus(undeliverable);

  const userPrompt = assembleUserPrompt({
    approvedGoal,
    evidence,
    prePostDiff,
    ppdDelivered,
    reachabilityStatus
  });

  // D1 layer 3: the ceiling follows the evidence actually inlined, so the two
  // sides of the call cannot drift apart again. N4 adds the env lever on top.
  const includedEvidenceBytes = evidence.reduce((sum, item) => sum + item.includedBytes, 0);
  const derivedMaxTokens = outputBudgetForEvidence(includedEvidenceBytes);
  const maxTokens = resolveOutputBudget(includedEvidenceBytes);

  const response = await callReviewer(opts.llmRunner, userPrompt, { maxTokens, derivedMaxTokens });

  const output = parseReviewerReply(response, maxTokens);
  ensureRequiredDimensions(output, response, maxTokens);

  // F2: what the DELIVERED conclusion says. Read before the verdicts are
  // assembled, because a detected drift has to reach `needsAttention` whatever
  // the reviewer answered. `null` — nothing delivered — is NOT
  // `indeterminate`: see `enforceStructuralDriftAttention`.
  const ppdBlock = evidence.find((item) => item.source.key === PRE_POST_DIFF_SOURCE_KEY);
  const ppdConclusion: PrePostDiffConclusion | null =
    ppdBlock !== undefined && ppdDelivered ? classifyPrePostDiffVerdict(ppdBlock.content) : null;

  // D1: the verdicts must rest on evidence that actually existed, and the
  // derived summary flags must match the verdicts — see the helpers above.
  const gated = enforceStructuralDriftAttention(output.dimensions, ppdConclusion);

  const dimensions = applyVerdictGates({
    dimensions: gated.dimensions,
    evidence,
    prePostDiff,
    undeliverable
  });

  // H2 adds nothing to `mustAttend` on purpose: `enforceDeliveryReachability`
  // has already made every undeliverable dimension non-`pass`, so it is in
  // `needsAttention` (and `allPass` is false) through the verdict route. A
  // second flag for the same dimension would be a check whose result nothing
  // reads — the shape this primitive exists to catch.
  const { allPass, needsAttention } = summarizeVerdicts(dimensions, output, [
    ...(gated.mustAttend ? (['existing-functionality-intact'] as const) : [])
  ]);

  return { ...output, dimensions, allPass, needsAttention };
}

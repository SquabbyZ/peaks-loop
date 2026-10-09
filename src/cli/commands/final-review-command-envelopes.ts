// src/cli/commands/final-review-command-envelopes.ts
//
// Every envelope `peaks prepare-final-review` can print, and the error-code
// mapping behind the failure one. Split out of `final-review-commands.ts`; the
// codes, messages, data fields and next-action strings are unchanged.

import { fail, ok, type ResultEnvelope } from 'peaks-loop-shared/result';

import { IncompleteFinalReviewError } from '../../services/final-review/final-review-service.js';
import { LlmBindingError, LlmRequestError } from '../../services/llm/anthropic-runner.js';
import type { FinalReviewOutput } from '../../services/final-review/final-review-types.js';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import { emptyFinalReviewData, type FinalReviewData } from './final-review-command-shared.js';

/** The two inputs a refusal envelope names, plus why it was refused. */
export type PrepareRefusal = {
  readonly rid: string;
  readonly code: string;
  readonly message: string;
  readonly sessionId: string;
  readonly auditGoalPath: string;
  readonly nextActions: string[];
};

/** Print one refusal envelope and mark the process failed. */
export function emitPrepareFailure(
  io: ProgramIO,
  json: boolean | undefined,
  refusal: PrepareRefusal,
  missingEnv?: readonly string[]
): void {
  printResult(
    io,
    fail<FinalReviewData>(
      'final-review.prepare',
      refusal.code,
      refusal.message,
      emptyFinalReviewData(refusal.rid, refusal.sessionId, refusal.auditGoalPath, missingEnv),
      refusal.nextActions
    ),
    json ?? false
  );
  process.exitCode = 1;
}

/** Where a resolved run reads its audit goal from. */
export type PrepareGoalPath = {
  readonly sessionId: string;
  readonly auditGoalPath: string;
};

/**
 * Stub path: surface a structured "scaffold ready" envelope.
 *
 * The service is NOT called here — the stub runner answers the audit-goal
 * shape, not the 4-dim review shape, so running it through
 * `prepareFinalReview()` would only manufacture a malformed review. The
 * envelope confirms the route is wired end-to-end and reports the audit-goal
 * path the service WOULD read.
 */
export function emitStubEnvelope(
  io: ProgramIO,
  rid: string,
  goal: PrepareGoalPath,
  json: boolean | undefined
): void {
  const data: FinalReviewData = {
    status: 'scaffold-only',
    rid,
    sessionId: goal.sessionId,
    auditGoalPath: goal.auditGoalPath,
    serviceWired: true,
    providerBinding: 'stub'
  };
  const envelope: ResultEnvelope<FinalReviewData> = ok(
    'final-review.prepare',
    data,
    [],
    [
      'Stub provider: no 4-dim review was performed. This envelope only proves the route is wired and reachable.',
      `Audit-goal file is present at: ${goal.auditGoalPath}`,
      'Re-run with `--llm-provider anthropic` to produce a real review.'
    ]
  );
  printResult(io, envelope, json ?? false);
}

/** The success envelope of a real-provider run. */
export function emitReviewEnvelope(
  io: ProgramIO,
  result: {
    readonly rid: string;
    readonly goal: PrepareGoalPath;
    readonly model: string;
    readonly review: FinalReviewOutput;
    readonly json: boolean | undefined;
  }
): void {
  const { rid, goal, model, review, json } = result;
  const data: FinalReviewData = {
    status: 'review-complete',
    rid,
    sessionId: goal.sessionId,
    auditGoalPath: goal.auditGoalPath,
    serviceWired: true,
    providerBinding: 'anthropic-messages-api',
    model,
    review
  };
  const envelope: ResultEnvelope<FinalReviewData> = ok(
    'final-review.prepare',
    data,
    review.allPass
      ? []
      : [
          `Dimensions needing human attention: ${review.needsAttention.join(', ') || 'none flagged'}.`
        ],
    [
      `4-dim review produced by anthropic-messages-api (model: ${model}).`,
      `allPass: ${String(review.allPass)}.`
    ]
  );
  printResult(io, envelope, json ?? false);
}

/**
 * Map a thrown error to the CLI's error code. The LLM-layer errors already
 * carry codes precise enough to act on (`LLM_CREDENTIAL_MISSING`,
 * `LLM_REQUEST_FAILED`, …), so they are passed through rather than flattened
 * into one opaque failure.
 */
export function finalReviewErrorCode(error: unknown): string {
  if (
    error instanceof LlmBindingError ||
    error instanceof LlmRequestError ||
    error instanceof IncompleteFinalReviewError
  ) {
    return error.code;
  }
  return 'FINAL_REVIEW_FAILED';
}

export function finalReviewNextActions(code: string): string[] {
  switch (code) {
    case 'LLM_CREDENTIAL_MISSING':
      return [
        'Export ANTHROPIC_AUTH_TOKEN (or ANTHROPIC_API_KEY) in the environment that launches peaks, then re-run.',
        'For an offline scaffold instead of a review, re-run with `--llm-provider stub` — it performs NO review.'
      ];
    case 'LLM_MODEL_MISSING':
      return [
        'Export ANTHROPIC_MODEL (or CLAUDE_CODE_SUBAGENT_MODEL) in the environment that launches peaks, then re-run.'
      ];
    case 'LLM_REQUEST_FAILED':
      return [
        'Check ANTHROPIC_BASE_URL and network reachability, then re-run — a transport failure produces no review.'
      ];
    case 'INCOMPLETE_FINAL_REVIEW':
      return [
        'The LLM reply was not valid JSON or omitted a required dimension; re-run so the gate is never read as complete.'
      ];
    default:
      return ['Re-run with `--llm-provider stub` to validate the CLI route without a real LLM.'];
  }
}

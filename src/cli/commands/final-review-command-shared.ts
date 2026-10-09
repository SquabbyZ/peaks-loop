// src/cli/commands/final-review-command-shared.ts
//
// What `peaks prepare-final-review` reports: the envelope's data shape, its
// provider vocabulary, and the placeholder a failure carries. Split out of
// `final-review-commands.ts`; every value and every field name is unchanged.

import type { FinalReviewOutput } from '../../services/final-review/final-review-types.js';

/** Whitelist of supported `--llm-provider` values for `peaks prepare-final-review`. */
export const SUPPORTED_LLM_PROVIDERS = ['anthropic', 'stub'] as const;
export type SupportedLlmProvider = (typeof SUPPORTED_LLM_PROVIDERS)[number];

/**
 * Default stays `stub` (unlike `peaks audit goal`, whose default is the real
 * provider): the scaffold route is what CI and the registered e2e contract
 * exercise without credentials, and the stub envelope is labelled
 * `status: 'scaffold-only'` / `providerBinding: 'stub'` so it can never be
 * read as a review.
 */
export const DEFAULT_LLM_PROVIDER: SupportedLlmProvider = 'stub';

export function isSupportedLlmProvider(value: string): value is SupportedLlmProvider {
  return (SUPPORTED_LLM_PROVIDERS as readonly string[]).includes(value);
}

export type FinalReviewStatus = 'scaffold-only' | 'review-complete' | 'not-applicable';

/**
 * Which LLM produced this envelope. `unknown` is reserved for failure
 * envelopes, where no binding was ever established.
 */
export type FinalReviewProviderBinding = 'stub' | 'anthropic-messages-api' | 'unknown';

export interface FinalReviewData {
  readonly status: FinalReviewStatus;
  readonly rid: string;
  readonly sessionId: string;
  readonly auditGoalPath: string;
  readonly serviceWired: boolean;
  readonly providerBinding: FinalReviewProviderBinding;
  /** Model id the bound provider answered with (real-provider runs only). */
  readonly model?: string;
  /** The 4-dim review the service produced (real-provider runs only). */
  readonly review?: FinalReviewOutput;
  /**
   * Environment variables that were absent when binding failed. Surfaced on
   * `data` because `fail()` redacts `message` through
   * `redactSensitiveErrorMessage`, whose catch-all pattern matches the words
   * `token` / `api_key` and would blank out the very names an operator needs.
   */
  readonly missingEnv?: readonly string[];
}

/**
 * Empty placeholder used by `fail()` envelopes. `status` is
 * `'not-applicable'` on the error path so consumers can tell
 * "this is a placeholder on a failure" apart from "this is a real
 * scaffold-only success".
 */
export function emptyFinalReviewData(
  rid: string,
  sessionId: string,
  auditGoalPath: string,
  missingEnv?: readonly string[]
): FinalReviewData {
  return {
    status: 'not-applicable',
    rid,
    sessionId,
    auditGoalPath,
    serviceWired: false,
    providerBinding: 'unknown',
    ...(missingEnv === undefined ? {} : { missingEnv })
  };
}

export type PrepareFinalReviewOptions = {
  project: string;
  sessionId: string;
  llmProvider?: string;
  base?: string;
  json?: boolean;
};

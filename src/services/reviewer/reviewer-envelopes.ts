/**
 * reviewer-envelopes.ts — pure builders for the ReviewerEnvelope.
 *
 * A skip is not a pass: every builder for a review that produced no verdict
 * returns `passed: false` + `gateAction: 'warn'`, so a consumer reading only
 * those two fields cannot see green (backlog §7.10 ②). `passed: true` is
 * reachable only through `stampEnvelope`, which takes an already-validated
 * model reply.
 */
import { deriveModelFamily } from './model-family.js';
import type { ReviewerProviderConfig } from './reviewer-config.js';
import type { ReviewerEnvelope } from './reviewer-types.js';

export const REVIEWER_ID = 'third-party-reviewer-v2.14.0';

export function buildSkippedEnvelope(reason: string): ReviewerEnvelope {
  return {
    reviewerId: REVIEWER_ID,
    modelId: 'skipped',
    modelFamily: 'skipped',
    passed: false,
    violations: [],
    gateAction: 'warn',
    reason
  };
}

export function buildProviderErrorEnvelope(
  provider: ReviewerProviderConfig,
  error: string
): ReviewerEnvelope {
  return {
    reviewerId: REVIEWER_ID,
    modelId: provider.model,
    modelFamily: deriveModelFamily(provider.model).modelFamily,
    passed: false,
    violations: [],
    gateAction: 'warn',
    reason: `skipped: provider ${provider.name} error (${error}); fallbackOnError=skip`
  };
}

export function buildInvalidReplyEnvelope(provider: ReviewerProviderConfig): ReviewerEnvelope {
  return {
    reviewerId: REVIEWER_ID,
    modelId: provider.model,
    modelFamily: deriveModelFamily(provider.model).modelFamily,
    passed: false,
    violations: [],
    gateAction: 'warn',
    reason: `provider ${provider.name} returned non-conforming JSON; treated as warn`
  };
}

/** Stamp the family from the model we actually called — the LLM cannot choose it. */
export function stampEnvelope(
  validated: ReviewerEnvelope,
  provider: ReviewerProviderConfig
): ReviewerEnvelope {
  return {
    ...validated,
    modelId: provider.model,
    modelFamily: deriveModelFamily(provider.model).modelFamily,
    reviewerId: REVIEWER_ID
  };
}

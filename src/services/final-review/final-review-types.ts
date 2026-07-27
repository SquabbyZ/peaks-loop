/**
 * `prepareFinalReview()` — the 4-dimension business review primitive that gates
 * end-of-workflow human acceptance in the 10% human / 90% LLM workflow.
 *
 * Contract:
 *   - Reads the approved audit-goal JSON from
 *     `.peaks/_runtime/<sessionId>/audit-goal/<rid>.json`.
 *   - Calls an injected `LlmRunner` exactly once with a 4-dim review prompt.
 *   - Parses the LLM output as JSON and validates that the `dimensions`
 *     array covers ALL four required dimensions
 *     (functional-completeness, problem-resolution, no-new-bugs,
 *     existing-functionality-intact).
 *   - Throws `IncompleteFinalReviewError` if the JSON is malformed or any
 *     required dimension is missing. Callers MUST treat this as a gate
 *     failure (return to human for re-prompting) — autonomous work must
 *     never proceed on a partial review.
 */

export type DimensionKind =
  | 'functional-completeness'
  | 'problem-resolution'
  | 'no-new-bugs'
  | 'existing-functionality-intact';

export type DimensionVerdict = 'pass' | 'fail' | 'inconclusive';
export type EvidenceKind =
  | 'test-result'
  | 'test-coverage'
  | 'manual-spot-check'
  | 'pre-post-diff'
  | 'regression-suite'
  | 'ac-mapping';
export type DimensionConfidence = 'high' | 'medium' | 'low';

export interface EvidenceItem {
  readonly kind: EvidenceKind;
  readonly description: string;
  readonly artifact?: string;
  readonly link?: string;
}

export interface DimensionEvidence {
  readonly dimension: DimensionKind;
  readonly verdict: DimensionVerdict;
  readonly summary: string;
  readonly evidence: readonly EvidenceItem[];
  readonly confidence: DimensionConfidence;
}

export interface FinalReviewOutput {
  readonly rid: string;
  readonly generatedAt: string;
  readonly dimensions: readonly DimensionEvidence[];
  readonly overallSummary: string;
  readonly allPass: boolean;
  readonly needsAttention: readonly DimensionKind[];
}

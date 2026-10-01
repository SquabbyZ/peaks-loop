// src/services/final-review/final-review-contract.ts
//
// The caller-facing contract of the final-review service: the inline
// LlmRunner copy, the prepare() options and the incomplete-review error.
// Hoisted verbatim from final-review-service.ts (C wave 7 file-size
// split); the service module re-exports all three so no importer's path
// or symbol changed.

// Inline copy of LlmRunner interface from src/services/audit/audit-goal-service.ts.
// Carried into peaks-loop/final-review so the module stays self-contained.
// (no back-dep on main peaks-loop, which would create a workspace:* circular
// trap). Source of truth lives in audit/audit-goal-service.ts.
export interface LlmRunner {
  call(
    systemPrompt: string,
    userPrompt: string,
    opts: { maxTokens: number }
  ): Promise<{
    output: string;
    tokens: { input: number; output: number };
  }>;
}

export interface PrepareFinalReviewOptions {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly llmRunner: LlmRunner;
  /**
   * Explicit base ref for the pre/post baseline diff. Unset ⇒ the producer
   * resolves the merge-base with the upstream default branch itself, and
   * reports the dimension `unavailable` when it cannot.
   */
  readonly baseRef?: string;
}

export class IncompleteFinalReviewError extends Error {
  readonly code = 'INCOMPLETE_FINAL_REVIEW' as const;
  constructor(message: string) {
    super(message);
    this.name = 'IncompleteFinalReviewError';
  }
}

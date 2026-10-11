// src/services/final-review/final-review-contract.ts
//
// The caller-facing contract of the final-review service: the inline
// LlmRunner copy, the prepare() options and the incomplete-review error.
// Hoisted verbatim from final-review-service.ts (C wave 7 file-size
// split); the service module re-exports all three so no importer's path
// or symbol changed.
//
// It also carries the pre/post-diff producer's contract with its consumers:
// where its artifact lands, what its conclusion line says, the shapes it
// returns and the reader for that conclusion line. Moved here by the file-size
// split that took `pre-post-diff.ts` back under the cap; `pre-post-diff.ts`
// re-exports every name, so no importer's path or symbol changed either.

/**
 * A completed model call's token accounting: the two counts an observability
 * reader sums, plus a tag saying whether the provider reported them or the
 * runner estimated them. `source` is optional so a runner that always has
 * provider numbers — or a test fake — need not state it.
 */
export interface LlmTokenUsage {
  readonly input: number;
  readonly output: number;
  readonly source?: 'provider' | 'estimated';
}

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
    tokens: LlmTokenUsage;
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
  /**
   * Called once per COMPLETED review, with the model call's token accounting,
   * immediately before this function returns. The `token-usage` emission
   * belongs in the caller (the CLI holds the session binding and owns the
   * emit), so the service reports the numbers instead of writing observability
   * itself. Optional: a caller that has nowhere to put them simply omits it.
   */
  readonly onLlmTokens?: (tokens: LlmTokenUsage) => void;
}

export class IncompleteFinalReviewError extends Error {
  readonly code = 'INCOMPLETE_FINAL_REVIEW' as const;
  constructor(message: string) {
    super(message);
    this.name = 'IncompleteFinalReviewError';
  }
}

/* ------------------------------------------------------------------ *
 * The pre/post-diff producer's contract, in full: its artifact, the
 * conclusion that artifact opens with, the shapes it returns, and the
 * reader for that conclusion. Hoisted verbatim from pre-post-diff.ts
 * (file-size split); pre-post-diff.ts re-exports every name.
 * ------------------------------------------------------------------ */

/** Path segments (under `.peaks/_runtime/<sessionId>/`) the artifact lands at. */
export const API_DIFF_ARTIFACT_SEGMENTS = ['final-review', 'api-diff.txt'] as const;

/**
 * The literal that opens the artifact's conclusion line.
 *
 * Exported because the consumer must be able to test for the CONCLUSION, not
 * for a byte count (F-BLOCK-1BYTE): one byte of `api-diff.txt` satisfied
 * "status: found" while conveying nothing, and the delivery gate it fed then let
 * a `pass` stand on a comparison nobody saw. The producer writes the line this
 * marker opens and `final-review-service.ts` requires it in the delivered
 * bytes, so the two cannot drift apart into the same hole again.
 */
export const PRE_POST_DIFF_VERDICT_MARKER = 'VERDICT: ';

/**
 * The three conclusions the artifact may open with, exported as the same
 * literals the verdict writer interpolates.
 *
 * They are constants because reading the conclusion is now part of the
 * consumer's job (F2): the pre/post-diff source is the one source whose
 * conclusion had a machine-readable form all along, and the envelope threw it
 * away — a delivered `STRUCTURAL DRIFT DETECTED` produced `allPass: true` with
 * an empty `needsAttention`. A consumer that must classify the conclusion may
 * only do so against the producer's own literals, never against a re-typed
 * copy of them.
 */
export const PRE_POST_DIFF_NO_DRIFT = 'NO STRUCTURAL DRIFT';
export const PRE_POST_DIFF_ADDITIONS_ONLY = 'ADDITIONS ONLY';
export const PRE_POST_DIFF_DRIFT_DETECTED = 'STRUCTURAL DRIFT DETECTED';

/**
 * What the artifact's conclusion LINE says, read from the bytes a consumer
 * actually received.
 *
 * `indeterminate` is not "nothing to report": it is "the line is there (or is
 * not) and this consumer cannot classify it", which for a drift DETECTOR is a
 * fact a human has to see — see `enforceStructuralDriftAttention`.
 */
export type PrePostDiffConclusion =
  'no-drift' | 'additions-only' | 'drift-detected' | 'indeterminate';

/**
 * Classify the delivered conclusion. Pure and total: a caller passes the bytes
 * it received (possibly a head slice) and gets back what the artifact says.
 *
 * Only the FIRST `VERDICT:` line is read. The artifact's header promises the
 * verdict "is repeated nowhere" and that it is the file's conclusion, so a
 * later line cannot be the answer, and reading further would let a document's
 * prose masquerade as its conclusion.
 */
export function classifyPrePostDiffVerdict(content: string): PrePostDiffConclusion {
  const line = content
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(PRE_POST_DIFF_VERDICT_MARKER));
  if (line === undefined) return 'indeterminate';
  const conclusion = line.slice(PRE_POST_DIFF_VERDICT_MARKER.length);
  if (conclusion.startsWith(PRE_POST_DIFF_DRIFT_DETECTED)) return 'drift-detected';
  if (conclusion.startsWith(PRE_POST_DIFF_ADDITIONS_ONLY)) return 'additions-only';
  if (conclusion.startsWith(PRE_POST_DIFF_NO_DRIFT)) return 'no-drift';
  return 'indeterminate';
}

export interface PrePostDiffComputed {
  readonly status: 'computed';
  readonly summary: string;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly content: string;
}

export interface PrePostDiffUnavailable {
  readonly status: 'unavailable';
  /** Why no baseline exists, in the operator's terms. */
  readonly reason: string;
  /**
   * `true` when the project root IS a git work tree — i.e. a baseline was
   * expected to be computable and was not. That distinction shapes the REASON
   * the operator is given (a tooling failure to fix, versus a project that has
   * no baseline to offer), and the service refuses a `pass` on this dimension
   * either way: "not a git repository" is the CAUSE of the missing evidence,
   * never a licence to trust the claim the evidence was supposed to support.
   */
  readonly inGitWorkTree: boolean;
}

export type PrePostDiffResult = PrePostDiffComputed | PrePostDiffUnavailable;

export interface ProducePrePostDiffOptions {
  readonly projectRoot: string;
  readonly sessionId: string;
  /** Explicit base ref. Unset ⇒ merge-base with the upstream default branch. */
  readonly baseRef?: string;
}

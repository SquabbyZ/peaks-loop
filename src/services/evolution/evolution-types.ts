import { z } from "zod";

/**
 * EvolutionEvaluation — spec §4.4 / §6.
 *
 * The Darwin-style ratchet stores one row per evolution round. The
 * table is the durable evidence of the round; the in-memory
 * `EvolutionProposal` is the create payload; the in-memory
 * `EvolutionEvaluation` is the post-skeptic aggregation.
 *
 * Hard rules from spec §6.1 (enforced at the service layer, NOT
 * only in the Zod schema — defense in depth):
 *
 *   1. Single editable asset per round (target_count === 1).
 *   2. Single optimization dimension per round (dimensions.length === 1).
 *   3. Independent-context evaluation (author_id !== evaluator_id).
 *   4. Regression skeptic (skeptic_id !== evaluator_id and
 *      skeptic_id !== author_id; skeptic is a SEPARATE agent).
 *   5. Score delta threshold (score_delta >= score_delta_min).
 *   6. User confirmation (user_confirmation_pointer is set on `keep`).
 *   7. No self-scored evolution (the author cannot be the scorer).
 *
 * Out of scope (deferred to later slices):
 *   - Crystallization event integration (M5).
 *   - Revert audit trail table (M5 / M7).
 */

/* ---------------------------------------------------------------------- */
/* Target kind — §4.4                                                      */
/* ---------------------------------------------------------------------- */

export const EvolutionTargetKindSchema = z.enum([
  "loop",
  "bee",
  "policy",
  "gate",
  "evaluator",
]);
export type EvolutionTargetKind = z.infer<typeof EvolutionTargetKindSchema>;

export const EVOLUTION_TARGET_KINDS: readonly EvolutionTargetKind[] = [
  "loop",
  "bee",
  "policy",
  "gate",
  "evaluator",
] as const;

/* ---------------------------------------------------------------------- */
/* Verdict — §4.4                                                          */
/* ---------------------------------------------------------------------- */

export const EvolutionVerdictSchema = z.enum([
  "keep",
  "revert",
  "needs-user-decision",
]);
export type EvolutionVerdict = z.infer<typeof EvolutionVerdictSchema>;

export const EVOLUTION_VERDICTS: readonly EvolutionVerdict[] = [
  "keep",
  "revert",
  "needs-user-decision",
] as const;

/* ---------------------------------------------------------------------- */
/* Proposal — the create payload. AC-8 enforces single object / dim.     */
/* ---------------------------------------------------------------------- */

/**
 * A reusable id pattern for `target_release_id`. The actual identity
 * (e.g. kebab-case for loop ids, integer for bee ids) varies by
 * target_kind; we keep this as a non-empty string and let the
 * service layer validate per target_kind.
 */
const TargetReleaseIdSchema = z.string().min(1).max(256);

/**
 * EvolutionProposal — the create payload.
 *
 * `single_object` and `single_optimization_dimension` are boolean
 * markers the LLM must declare at proposal time. The service layer
 * rejects proposals that violate them. The `target_count` is always
 * 1; `dimensions` is always length 1.
 *
 * `before_score` / `after_score` are per-dimension scores on the
 * 0..10 scale; the proposal is rejected at `keep` time when
 * `after_score - before_score < score_delta_min` (default 1.0).
 */
export const EvolutionProposalInputSchema = z.object({
  target_kind: EvolutionTargetKindSchema,
  target_release_id: TargetReleaseIdSchema,
  /**
   * Single optimization dimension (AC-8). Multi-dimension proposals
   * must be split into multiple rounds.
   */
  optimization_dimension: z
    .string()
    .trim()
    .min(1, "optimization_dimension is required (single dimension per round)")
    .max(200),
  before_snapshot: z.record(z.unknown()).default({}),
  after_snapshot: z.record(z.unknown()).default({}),
  diff: z.record(z.unknown()).default({}),
  before_score: z
    .number()
    .finite("before_score must be a finite number")
    .min(0, "before_score must be >= 0")
    .max(10, "before_score must be <= 10"),
  after_score: z
    .number()
    .finite("after_score must be a finite number")
    .min(0, "after_score must be >= 0")
    .max(10, "after_score must be <= 10"),
  score_delta_min: z
    .number()
    .finite("score_delta_min must be a finite number")
    .min(0, "score_delta_min must be >= 0")
    .default(1.0),
  author_id: z
    .string()
    .trim()
    .min(1, "author_id is required")
    .max(200),
  /**
   * The LLM-side marker that this proposal targets a SINGLE object
   * (AC-8). Multi-object proposals must be split into multiple
   * rounds. The service layer rejects proposals with
   * `single_object !== true`.
   */
  single_object: z.literal(true, {
    errorMap: () => ({
      message:
        "single_object must be true (multi-object proposals must be split into multiple rounds)",
    }),
  }),
  /**
   * The LLM-side marker that this proposal targets a SINGLE
   * optimization dimension (AC-8). The service layer rejects
   * proposals with `single_optimization_dimension !== true`.
   */
  single_optimization_dimension: z.literal(true, {
    errorMap: () => ({
      message:
        "single_optimization_dimension must be true (multi-dimension proposals must be split into multiple rounds)",
    }),
  }),
  rubric: z.record(z.unknown()).default({}),
  red_lines: z.array(z.string().min(1).max(2000)).default([]),
  source_traces: z.array(z.string().min(1).max(256)).default([]),
});
export type EvolutionProposalInput = z.input<typeof EvolutionProposalInputSchema>;

/**
 * The PERSISTED proposal shape — adds `dimensions` (a length-1
 * array) and `target_count` (always 1) for storage. The
 * `optimization_dimension` scalar is normalized into the
 * `dimensions` array on persist.
 */
export const EvolutionProposalSchema = EvolutionProposalInputSchema.extend({
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^eval-[0-9a-f-]{8,}$/, {
      message:
        "id must start with 'eval-' followed by a hex/UUID-ish suffix",
    }),
  dimensions: z
    .array(z.string().min(1).max(200))
    .length(1, "dimensions must be exactly length 1 (AC-8)"),
  target_count: z.literal(1),
  schema_version: z
    .literal("peaks.evolution/1")
    .default("peaks.evolution/1"),
  created_at: z.string().datetime(),
  score_delta: z.number().finite(),
});
export type EvolutionProposal = z.infer<typeof EvolutionProposalSchema>;

/* ---------------------------------------------------------------------- */
/* Evaluation — post-skeptic aggregation.                                   */
/* ---------------------------------------------------------------------- */

/**
 * The independent evaluator's verdict. AC-12 / AC-13: the evaluator
 * is a SEPARATE sub-agent that only sees the evaluation package.
 */
export const IndependentEvaluatorResultSchema = z.object({
  score: z
    .number()
    .finite()
    .min(0, "evaluator score must be >= 0")
    .max(10, "evaluator score must be <= 10"),
  riskTags: z.array(z.string().min(1).max(200)).default([]),
  refuteParagraph: z
    .string()
    .trim()
    .min(1, "refuteParagraph is required (one paragraph of independent-context rebuttal)")
    .max(8000),
});
export type IndependentEvaluatorResult = z.infer<
  typeof IndependentEvaluatorResultSchema
>;

/**
 * The regression skeptic's verdict. AC-14: a separate sub-agent
 * that attempts to refute the proposal.
 */
export const RegressionSkepticResultSchema = z.object({
  driftRisks: z.array(z.string().min(1).max(2000)).default([]),
  overfitRisks: z.array(z.string().min(1).max(2000)).default([]),
  safetyRegressionRisks: z.array(z.string().min(1).max(2000)).default([]),
  blocker: z.string().trim().min(1).max(2000).optional(),
});
export type RegressionSkepticResult = z.infer<
  typeof RegressionSkepticResultSchema
>;

/**
 * The full evolution evaluation row as persisted. Differs from the
 * proposal in that it carries the evaluator + skeptic verdicts, the
 * `score_delta` (computed), and the final `verdict` aggregation.
 *
 * Field semantics — see spec §4.4 for full prose. Highlights:
 *
 *   - `evaluator_id` and `skeptic_id` are SEPARATE agents (AC-14).
 *   - `user_confirmation_pointer` is a path/ID to a user choice
 *     record; it is REQUIRED for `verdict = 'keep'` (AC-15: user
 *     confirmation is the final gate).
 *   - `brief_pointer` is a path/ID to the evidence brief used in
 *     the recommendation (spec §4.7 / §10 RL-7).
 */
export const EvolutionEvaluationInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^eval-[0-9a-f-]{8,}$/, {
      message:
        "id must start with 'eval-' followed by a hex/UUID-ish suffix",
    }),
  proposal: EvolutionProposalSchema,
  evaluator_id: z
    .string()
    .trim()
    .min(1, "evaluator_id is required (independent scorer; AC-12)")
    .max(200),
  skeptic_id: z
    .string()
    .trim()
    .min(1, "skeptic_id is required (regression skeptic; AC-14)")
    .max(200),
  evaluator_result: IndependentEvaluatorResultSchema,
  skeptic_result: RegressionSkepticResultSchema,
  verdict: EvolutionVerdictSchema,
  user_confirmation_pointer: z
    .string()
    .trim()
    .min(1, "user_confirmation_pointer is required (AC-15)")
    .max(512)
    .optional(),
  brief_pointer: z
    .string()
    .trim()
    .min(1, "brief_pointer is required (spec §4.4)")
    .max(512)
    .optional(),
  schema_version: z
    .literal("peaks.evolution/1")
    .default("peaks.evolution/1"),
  created_at: z.string().datetime(),
});
export type EvolutionEvaluationInput = z.input<
  typeof EvolutionEvaluationInputSchema
>;

/**
 * The PERSISTED evolution evaluation row. Differs from the input
 * in that `score_delta` is computed and stored.
 */
export const EvolutionEvaluationSchema = EvolutionEvaluationInputSchema.extend({
  score_delta: z.number().finite(),
});
export type EvolutionEvaluation = z.infer<typeof EvolutionEvaluationSchema>;

/**
 * Default for `score_delta_min` per spec §6.1 #5.
 */
export const EVOLUTION_DEFAULT_DELTA_MIN = 1.0;

/**
 * Convenience: strict-parse an unknown payload into an
 * EvolutionEvaluation row. Throws ZodError on failure.
 */
export function parseEvolutionEvaluation(input: unknown): EvolutionEvaluation {
  return EvolutionEvaluationSchema.parse(input) as EvolutionEvaluation;
}

/**
 * Convenience: safe-parse that returns a Result-like shape so
 * callers (CLI / service layer) can render findings without
 * try/catch noise.
 */
export function safeParseEvolutionEvaluation(
  input: unknown
):
  | { ok: true; row: EvolutionEvaluation }
  | { ok: false; findings: Array<{ path: string; message: string }> } {
  const r = EvolutionEvaluationSchema.safeParse(input);
  if (r.success) return { ok: true, row: r.data as EvolutionEvaluation };
  return {
    ok: false,
    findings: r.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  };
}

/**
 * Convenience: strict-parse an unknown payload into an
 * EvolutionProposal. Throws ZodError on failure.
 */
export function parseEvolutionProposal(input: unknown): EvolutionProposal {
  return EvolutionProposalSchema.parse(input) as EvolutionProposal;
}

import { z } from 'zod';

/**
 * Evolution schema limits + the two leaf independent-verdict schemas.
 *
 * Relocated verbatim from `evolution-types.ts` so that module stays under the
 * repo file-size cap. Everything here is built from `zod` and the limit
 * constants alone, so this module has no back-edge into `evolution-types.ts`;
 * that module re-exports the schemas and their inferred types from its own
 * path, so every importer keeps using the path it already imports from.
 */

/* ---------------------------------------------------------------------- */
/* PRD-002b slice 2 — schema-limit constants extracted from inline         */
/* `.max(N)` calls so the no-magic-numbers rule stops flagging the        */
/* constraint values. Names describe the field, not just the number.     */
/* ---------------------------------------------------------------------- */
export const EVO_TARGET_RELEASE_ID_MAX = 256;
export const EVO_OPTIMIZATION_DIMENSION_MAX = 200;
export const EVO_AUTHOR_ID_MAX = 200;
export const EVO_RISK_TAG_MAX = 200;
export const EVO_RED_LINE_MAX = 2000;
export const EVO_SOURCE_TRACE_MAX = 256;
export const EVO_EVAL_ID_MAX = 128;
export const EVO_DIMENSION_ITEM_MAX = 200;
export const EVO_SCORING_SCALE_MAX = 10;
export const EVO_REFUTE_PARAGRAPH_MAX = 8000;
export const EVO_SKEPTIC_RISK_MAX = 2000;
export const EVO_POINTER_MAX = 512;

/**
 * The independent evaluator's verdict. AC-12 / AC-13: the evaluator
 * is a SEPARATE sub-agent that only sees the evaluation package.
 */
export const IndependentEvaluatorResultSchema = z.object({
  score: z
    .number()
    .finite()
    .min(0, 'evaluator score must be >= 0')
    .max(EVO_SCORING_SCALE_MAX, 'evaluator score must be <= 10'),
  riskTags: z.array(z.string().min(1).max(EVO_RISK_TAG_MAX)).default([]),
  refuteParagraph: z
    .string()
    .trim()
    .min(1, 'refuteParagraph is required (one paragraph of independent-context rebuttal)')
    .max(EVO_REFUTE_PARAGRAPH_MAX)
});
export type IndependentEvaluatorResult = z.infer<typeof IndependentEvaluatorResultSchema>;

/**
 * The regression skeptic's verdict. AC-14: a separate sub-agent
 * that attempts to refute the proposal.
 */
export const RegressionSkepticResultSchema = z.object({
  driftRisks: z.array(z.string().min(1).max(EVO_SKEPTIC_RISK_MAX)).default([]),
  overfitRisks: z.array(z.string().min(1).max(EVO_SKEPTIC_RISK_MAX)).default([]),
  safetyRegressionRisks: z.array(z.string().min(1).max(EVO_SKEPTIC_RISK_MAX)).default([]),
  blocker: z.string().trim().min(1).max(EVO_SKEPTIC_RISK_MAX).optional()
});
export type RegressionSkepticResult = z.infer<typeof RegressionSkepticResultSchema>;

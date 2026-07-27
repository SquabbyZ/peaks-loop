import { z } from "zod";
import {
  EvidenceBriefSchema,
  type EvidenceBrief,
} from "./crystallization-types.js";

/**
 * EvidenceBriefBuilder — spec §4.7 / §10 RL-7.
 *
 * The brief is a 4-section natural-language projection that MUST
 * accompany every user-facing recommendation. The shape guard is
 * encoded in `EvidenceBriefSchema` (see crystallization-types.ts);
 * this module is the LLM-side entry point that PRODUCES the brief
 * from a finished trace + evaluator summary and the validator that
 * REFUSES to render a recommendation payload without all 4 sections.
 *
 * Hard rules (mirrored from spec):
 *
 *   1. Every section must be a non-empty NL string (1-2 sentences
 *      for what_happened / why_it_matters / what_learned; 1
 *      sentence for what_action). An empty section is a hard
 *      `MISSING_BRIEF_SECTION` error.
 *
 *   2. The build path is lenient on raw prose and strict on the
 *      final shape — `buildEvidenceBrief` calls
 *      `EvidenceBriefSchema.parse(...)` so a partial brief throws
 *      before reaching the database.
 *
 *   3. `renderRecommendationPayload` refuses to return a
 *      recommendation envelope unless the brief passes the 4-section
 *      guard. This is the CLI's single source of truth for "may I
 *      show this to the user?".
 *
 *   4. The `evaluator_summary` is a separate field on the
 *      crystallization_event row (spec §4.5) and is NOT part of the
 *      brief. It feeds the broader recommendation envelope.
 *
 * Out of scope (deferred to later slices):
 *   - LLM-authored brief generation from live trace evidence (M8 dogfood).
 *   - brief rewrite-on-update semantics.
 */

/* ---------------------------------------------------------------------- */
/* Input shapes — the builder is the only place these normalize.          */
/* ---------------------------------------------------------------------- */

/**
 * The minimum viable trace shape that the builder needs to render
 * a brief. The trace is the EVIDENCE; the builder is format-stable
 * so a future slice can swap in a richer trace source without
 * editing every caller.
 */
export const BriefTraceInputSchema = z.object({
  trace_id: z.string().trim().min(1).max(256),
  /**
   * The full NL recap of the run. Required for what_happened.
   * 1-2 sentences is the spec guidance; the builder does not
   * truncate, but tests passing multi-paragraph input will be
   * warned at the Zod boundary (max 4000 chars per section).
   */
  what_happened: z.string().trim().min(1).max(4000),
  /**
   * The "why this matters" recap. Required for why_it_matters.
   */
  why_it_matters: z.string().trim().min(1).max(4000),
  /**
   * Failure-mode and preference-extraction recap. Required for
   * what_learned.
   */
  what_learned: z.string().trim().min(1).max(4000),
  /**
   * The recommended action. Required for what_action (1
   * sentence per spec).
   */
  what_action: z.string().trim().min(1).max(4000),
  /**
   * Optional structured bullets (e.g. "4 phases, 3 gates passed,
   * 1 evaluator verdict"). Counts are allowed at this layer; the
   * brief section is the NL primary (RL-7).
   */
  bullets: z.array(z.string().trim().min(1).max(1000)).default([]),
  /**
   * Source trace ids backing the brief (the column on
   * crystallization_event spec §4.5).
   */
  source_trace_pointers: z
    .array(z.string().trim().min(1).max(256))
    .default([]),
});
export type BriefTraceInput = z.input<typeof BriefTraceInputSchema>;

/**
 * The summary emitted by the independent evaluators (spec §4.5
 * `evaluator_summary` field). Optional for the brief builder — the
 * brief can be built without it, but a filled evaluator_summary
 * flows into the recommendation envelope.
 */
export const EvaluatorSummarySchema = z.object({
  one_liner: z.string().trim().max(1000).default(""),
  risk_tags: z.array(z.string().trim().min(1).max(200)).default([]),
});
export type EvaluatorSummary = z.input<typeof EvaluatorSummarySchema>;

/* ---------------------------------------------------------------------- */
/* Recommendation envelope — the CLI renders this.                       */
/* ---------------------------------------------------------------------- */

export const RecommendationPayloadSchema = z.object({
  brief: EvidenceBriefSchema,
  bullets: z.array(z.string().trim().min(1).max(1000)).default([]),
  source_trace_pointers: z
    .array(z.string().trim().min(1).max(256))
    .default([]),
  evaluator_summary: EvaluatorSummarySchema.default({
    one_liner: "",
    risk_tags: [],
  }),
});
export type RecommendationPayload = z.infer<
  typeof RecommendationPayloadSchema
>;

/* ---------------------------------------------------------------------- */
/* Errors                                                                 */
/* ---------------------------------------------------------------------- */

export class BriefSectionError extends Error {
  readonly code = "MISSING_BRIEF_SECTION" as const;
  readonly findings: ReadonlyArray<{ path: string; message: string }>;
  constructor(
    message: string,
    findings: ReadonlyArray<{ path: string; message: string }> = []
  ) {
    super(message);
    this.name = "BriefSectionError";
    this.findings = findings;
  }
}

/* ---------------------------------------------------------------------- */
/* Builder                                                                */
/* ---------------------------------------------------------------------- */

/**
 * Build a 4-section EvidenceBrief from a finished trace recap.
 *
 * The function is STRICT: it parses the input trace through
 * `BriefTraceInputSchema`, then parses the assembled brief through
 * `EvidenceBriefSchema`. Any missing section throws
 * `BriefSectionError(MISSING_BRIEF_SECTION)` — the same code that
 * `safeParseEvidenceBrief` returns — so a single error code is the
 * user-facing signal for "brief incomplete, do not render".
 *
 * Brief-section related ZodErrors (e.g. `min(1)` on a section) are
 * translated to `BriefSectionError` so callers only handle one
 * shape of failure. Non-section ZodErrors (e.g. invalid `trace_id`)
 * are re-raised unchanged.
 *
 * NOTE: callers who already have raw NL strings can also call
 * `parseEvidenceBrief` directly; this function is the opinionated
 * shape for trace -> brief.
 */
export function buildEvidenceBrief(
  trace: BriefTraceInput,
  evaluatorSummary?: EvaluatorSummary
): EvidenceBrief {
  let parsedTrace: BriefTraceInput;
  try {
    parsedTrace = BriefTraceInputSchema.parse(trace);
  } catch (err) {
    throw translateBriefZodError(err);
  }

  // Assemble the 4 sections verbatim from the trace recap. The Zod
  // parser below re-asserts the 4-section guard.
  const candidate = {
    what_happened: parsedTrace.what_happened,
    why_it_matters: parsedTrace.why_it_matters,
    what_learned: parsedTrace.what_learned,
    what_action: parsedTrace.what_action,
  };

  const result = EvidenceBriefSchema.safeParse(candidate);
  if (!result.success) {
    const findings = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw new BriefSectionError(
      "evidence_brief must contain all 4 sections (what_happened, why_it_matters, what_learned, what_action) with non-empty content (spec §4.7 / RL-7)",
      findings
    );
  }
  // Silence the unused-var lint on evaluatorSummary at this layer —
  // the builder currently does not consume it (the brief is NL
  // primary), but the surface is preserved for callers via
  // `renderRecommendationPayload` below.
  void evaluatorSummary;
  return result.data as EvidenceBrief;
}

/**
 * Translate a ZodError raised on a brief-section path into a
 * `BriefSectionError`. Non-brief errors are re-raised.
 */
function translateBriefZodError(err: unknown): never {
  if (err instanceof z.ZodError) {
    const issues = err.issues;
    const allBrief = issues.every((i) =>
      BRIEF_SECTION_KEYS.has(i.path.join("."))
    );
    if (allBrief) {
      const findings = issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      throw new BriefSectionError(
        "evidence_brief must contain all 4 sections (what_happened, why_it_matters, what_learned, what_action) with non-empty content (spec §4.7 / RL-7)",
        findings
      );
    }
  }
  throw err;
}

const BRIEF_SECTION_KEYS = new Set([
  "what_happened",
  "why_it_matters",
  "what_learned",
  "what_action",
]);

/**
 * Render the user-facing recommendation envelope (brief + bullets +
 * trace pointers + evaluator summary). The function refuses to
 * return a payload unless ALL 4 brief sections are present — this
 * is the single CLI-facing gate per spec §10 RL-7.
 *
 * On success, returns the validated `RecommendationPayload`. On a
 * missing-section brief, throws `BriefSectionError`.
 */
export function renderRecommendationPayload(
  trace: BriefTraceInput,
  evaluatorSummary: EvaluatorSummary = { one_liner: "", risk_tags: [] }
): RecommendationPayload {
  const brief = buildEvidenceBrief(trace, evaluatorSummary);
  const payload = RecommendationPayloadSchema.parse({
    brief,
    bullets: trace.bullets ?? [],
    source_trace_pointers: trace.source_trace_pointers ?? [],
    evaluator_summary: evaluatorSummary,
  });
  return payload;
}

/**
 * Convenience: validate an arbitrary unknown payload AS IF it were a
 * recommendation envelope. Returns a Result-like shape so the CLI can
 * render a structured MISSING_BRIEF_SECTION error without try/catch
 * noise.
 */
export function safeRenderRecommendationPayload(
  input: unknown
):
  | { ok: true; payload: RecommendationPayload }
  | {
      ok: false;
      code?: "MISSING_BRIEF_SECTION";
      findings: Array<{ path: string; message: string }>;
    } {
  const r = RecommendationPayloadSchema.safeParse(input);
  if (r.success) return { ok: true, payload: r.data };
  const findings = r.error.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
  // Map brief failures to MISSING_BRIEF_SECTION. A failure is
  // recognized as brief iff (a) every issue points at the brief or
  // its sections, OR (b) the explicit refine message is present.
  const isBrief = r.error.issues.every(
    (i) =>
      i.message.includes("evidence_brief must contain all 4 sections") ||
      BRIEF_SECTION_KEYS.has(i.path.join(".")) ||
      i.path[0] === "brief" ||
      (i.path.length >= 2 && i.path[0] === "brief")
  );
  return isBrief
    ? { ok: false, code: "MISSING_BRIEF_SECTION", findings }
    : { ok: false, findings };
}

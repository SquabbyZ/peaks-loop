import { z } from "zod";

/**
 * CrystallizationEvent — spec §4.5 / §4.7 / §5.
 *
 * M5 scope: the crystallization_event table + the 4-section
 * evidence_brief projection (spec §4.7 / §10 RL-7). Every
 * user-facing recommendation is gated on the brief being complete;
 * the schema below enforces the 4-section shape at parse time.
 *
 * Hard rules enforced at the boundary (and re-asserted in the
 * service layer):
 *
 *   1. The 4 brief sections (what_happened / why_it_matters /
 *      what_learned / what_action) are ALL required. A partial
 *      brief is a hard parse error (`MISSING_BRIEF_SECTION`),
 *      and `parseCrystallizationEvent` will throw.
 *   2. The trigger enum mirrors spec §4.5 exactly:
 *      user_explicit | llm_suggested | success_default_prompt |
 *      similar_task_recurrence.
 *   3. The event's own lifecycle_status is ORTHOGONAL to the
 *      created/updated loop_release.lifecycle_status — the same
 *      asset can have many crystallization events over its life.
 *   4. source_trace_pointers are stable ids (the workflow trace
 *      id space), not path strings — the column is JSON-array of
 *      strings.
 *   5. The brief section guard is implemented as a `.refine(...)`
 *      on the input schema — the canonical 4 keys must be present
 *      with non-empty values (the spec mandates 1-2 sentences per
 *      section; an empty string would be a degenerate brief).
 *
 * Out of scope (deferred to later slices):
 *   - cross-event aggregation (loop crystallized N times).
 *   - brief rewrite-on-update semantics (M8 dogfood).
 */

/* ---------------------------------------------------------------------- */
/* Trigger — §4.5 / §5.4                                                   */
/* ---------------------------------------------------------------------- */

export const CrystallizationTriggerSchema = z.enum([
  "user_explicit",
  "llm_suggested",
  "success_default_prompt",
  "similar_task_recurrence",
]);
export type CrystallizationTrigger = z.infer<
  typeof CrystallizationTriggerSchema
>;

export const CRYSTALLIZATION_TRIGGERS: readonly CrystallizationTrigger[] = [
  "user_explicit",
  "llm_suggested",
  "success_default_prompt",
  "similar_task_recurrence",
] as const;

/* ---------------------------------------------------------------------- */
/* Lifecycle status — §5.6 (event-scoped, not asset-scoped)               */
/* ---------------------------------------------------------------------- */

export const CrystallizationEventStatusSchema = z.enum([
  "candidate",
  "stable",
  "retired",
]);
export type CrystallizationEventStatus = z.infer<
  typeof CrystallizationEventStatusSchema
>;

/* ---------------------------------------------------------------------- */
/* EvidenceBrief — §4.7 / §10 RL-7. REQUIRED 4-section shape.             */
/* ---------------------------------------------------------------------- */

/**
 * The four brief sections. Spec §4.7 lists them as NL short
 * sections; the service layer mandates 1-2 sentences (what_action
 * is a single sentence per the spec). The Zod constraints below
 * enforce NON-EMPTY strings. The brief-section guard (see
 * `EvidenceBriefSchema.refine` below) rejects any payload missing
 * one of the four keys, regardless of section content — it is
 * the canonical hard gate per spec §10 RL-7.
 */
const BriefSectionSchema = z
  .string()
  .trim()
  .min(1, "brief section must be non-empty natural language")
  .max(4000);

/**
 * EvidenceBrief — the 4-section brief (spec §4.7).
 *
 * Hard shape invariant: ALL FOUR KEYS must be present at parse
 * time, with non-empty NL content. The `.refine(...)` guard is
 * what makes a brief a "brief" — without it, the projection is
 * not a brief and the recommendation MUST NOT be rendered
 * (service layer enforces this; Zod makes it a parse-time
 * guarantee).
 *
 * Field semantics:
 *   - what_happened   — 1-2 sentence factual account of the run.
 *   - why_it_matters  — 1-2 sentence explanation of why this is
 *                       worth promoting.
 *   - what_learned    — 1-2 sentence learning: failure modes
 *                       encoded, preferences extracted.
 *   - what_action     — 1-sentence recommended action with
 *                       rationale.
 */
export const EvidenceBriefSchema = z
  .object({
    what_happened: BriefSectionSchema,
    why_it_matters: BriefSectionSchema,
    what_learned: BriefSectionSchema,
    what_action: BriefSectionSchema,
  })
  .strict()
  .refine(
    (b) =>
      typeof b.what_happened === "string" &&
      b.what_happened.trim().length > 0 &&
      typeof b.why_it_matters === "string" &&
      b.why_it_matters.trim().length > 0 &&
      typeof b.what_learned === "string" &&
      b.what_learned.trim().length > 0 &&
      typeof b.what_action === "string" &&
      b.what_action.trim().length > 0,
    {
      message:
        "evidence_brief must contain all 4 sections (what_happened, why_it_matters, what_learned, what_action) with non-empty content (spec §4.7 / RL-7)",
      path: [],
    }
  );

export type EvidenceBrief = z.infer<typeof EvidenceBriefSchema>;

/**
 * Helper for downstream code that needs to know whether a parsed
 * brief satisfies the 4-section rule. Useful for the CLI when a
 * payload arrived from the LLM and the brief-section guard has
 * already passed — it returns the section count, always 4 here.
 */
export function hasAllFourBriefSections(brief: EvidenceBrief): boolean {
  return (
    typeof brief.what_happened === "string" &&
    brief.what_happened.trim().length > 0 &&
    typeof brief.why_it_matters === "string" &&
    brief.why_it_matters.trim().length > 0 &&
    typeof brief.what_learned === "string" &&
    brief.what_learned.trim().length > 0 &&
    typeof brief.what_action === "string" &&
    brief.what_action.trim().length > 0
  );
}

/* ---------------------------------------------------------------------- */
/* CrystallizationEvent — §4.5                                            */
/* ---------------------------------------------------------------------- */

/**
 * Structurally referenced columns: pointers to optional loop_release /
 * bee_release rows. All four are optional — a crystallization event
 * may exist for "trace only" / "discard" choices that touch no durable
 * asset. Set is governed by the service layer's pre-run gate.
 */
const OptionalLoopId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, {
    message: "loop_release_id must be kebab-case starting with a lowercase letter",
  })
  .optional();
const OptionalBeeId = z
  .number()
  .int()
  .positive()
  .max(2 ** 31 - 1, "bee_release_id out of 32-bit range")
  .optional();

/**
 * Zod schema for the create payload (CrystallizationEventInput).
 *
 * Re-validates the evidence_brief inline; calling code may ALSO call
 * `EvidenceBriefSchema.parse` separately if it builds the brief out
 * of band. The CrystallizationEvent input schema wires the same
 * guard so a brief cannot sneak through via a partial-input path.
 */
export const CrystallizationEventInputSchema = z.object({
  trigger: CrystallizationTriggerSchema,
  evidence_brief: EvidenceBriefSchema,
  evidence_bullets: z
    .array(z.string().trim().min(1).max(1000))
    .default([]),
  source_trace_pointers: z
    .array(z.string().trim().min(1).max(256))
    .default([]),
  evaluator_summary: z
    .string()
    .trim()
    .max(4000)
    .default(""),
  user_decision_summary: z
    .string()
    .trim()
    .max(4000)
    .default(""),
  created_loop_release_id: OptionalLoopId,
  updated_loop_release_id: OptionalLoopId,
  created_bee_release_id: OptionalBeeId,
  updated_bee_release_id: OptionalBeeId,
  lifecycle_status: CrystallizationEventStatusSchema.default("candidate"),
});
export type CrystallizationEventInput = z.input<
  typeof CrystallizationEventInputSchema
>;

/**
 * Full persisted row schema. Adds `id` (the event id) and stamps
 * `schema_version` to the fixed literal `peaks.crystallization/1`.
 *
 * Brief section guard is INHERITED from `EvidenceBriefSchema.refine`
 * because `EvidenceBriefSchema` is embedded; the service layer still
 * re-asserts the guard so a hand-crafted row cannot bypass Zod at
 * the store boundary.
 */
export const CrystallizationEventSchema = CrystallizationEventInputSchema.extend({
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^crys-[0-9a-f]{8,}$/, {
      message:
        "id must start with 'crys-' followed by a hex suffix (spec §4.5)",
    }),
  schema_version: z
    .literal("peaks.crystallization/1")
    .default("peaks.crystallization/1"),
  created_at: z.string().datetime(),
});
export type CrystallizationEvent = z.infer<
  typeof CrystallizationEventSchema
>;

/**
 * Convenience: strict-parse an unknown payload into a
 * CrystallizationEvent row. Throws ZodError on failure — including
 * when the brief is missing a section (the `.refine` guard fires).
 *
 * Use this at every parse boundary (CLI input, store insertion).
 */
export function parseCrystallizationEvent(input: unknown): CrystallizationEvent {
  return CrystallizationEventSchema.parse(input) as CrystallizationEvent;
}

/**
 * Convenience: strict-parse an unknown payload as a standalone
 * EvidenceBrief. Throws ZodError on failure.
 */
export function parseEvidenceBrief(input: unknown): EvidenceBrief {
  return EvidenceBriefSchema.parse(input) as EvidenceBrief;
}

/**
 * Safe-parse twin of parseCrystallizationEvent. Returns a Result-like
 * envelope so callers (CLI / tests) can render findings without
 * try/catch noise. The `code` field is `MISSING_BRIEF_SECTION` when
 * the brief refine guard trips OR when ANY brief-section key is
 * missing (spec §10 RL-7) — distinguishes brief failures from
 * generic validation errors.
 */
export function safeParseCrystallizationEvent(
  input: unknown
):
  | { ok: true; row: CrystallizationEvent }
  | {
      ok: false;
      code?: "MISSING_BRIEF_SECTION";
      findings: Array<{ path: string; message: string }>;
    } {
  const r = CrystallizationEventSchema.safeParse(input);
  if (r.success) return { ok: true, row: r.data as CrystallizationEvent };
  const findings = r.error.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
  const isBrief = isBriefSectionFailure(r.error.issues);
  return isBrief
    ? { ok: false, code: "MISSING_BRIEF_SECTION", findings }
    : { ok: false, findings };
}

/**
 * Safe-parse twin of parseEvidenceBrief. Same Result-like envelope
 * shape; same MISSING_BRIEF_SECTION code mapping (covers both
 * refine-guard failures and per-section missing/empty failures).
 */
export function safeParseEvidenceBrief(
  input: unknown
):
  | { ok: true; row: EvidenceBrief }
  | {
      ok: false;
      code?: "MISSING_BRIEF_SECTION";
      findings: Array<{ path: string; message: string }>;
    } {
  const r = EvidenceBriefSchema.safeParse(input);
  if (r.success) return { ok: true, row: r.data as EvidenceBrief };
  const findings = r.error.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
  const isBrief = isBriefSectionFailure(r.error.issues);
  return isBrief
    ? { ok: false, code: "MISSING_BRIEF_SECTION", findings }
    : { ok: false, findings };
}

/**
 * Decide whether a ZodIssue[] is a "brief section" failure: every
 * issue points at one of the four required keys (the section is
 * missing, or empty after trim), OR the explicit refine-guard issue
 * is present. Used by both `safeParseCrystallizationEvent` and
 * `safeParseEvidenceBrief` so callers see a single
 * `MISSING_BRIEF_SECTION` code regardless of which Zod boundary
 * caught the failure.
 */
function isBriefSectionFailure(
  issues: ReadonlyArray<z.ZodIssue>
): boolean {
  if (issues.length === 0) return false;
  // Explicit refine guard (EvidenceBriefSchema.refine message).
  if (
    issues.some((i) =>
      i.message.includes("evidence_brief must contain all 4 sections")
    )
  ) {
    return true;
  }
  // Per-section Zod failures (min(1) on each section key, or
  // too_small, or invalid_type). Each issue's path will be either
  // the section key (`what_happened`) OR the parent `evidence_brief`
  // — Zod reports missing-key issues against the parent object.
  return issues.every((i) => {
    const path = i.path.join(".");
    if (path === "evidence_brief") return true;
    if (i.path.length >= 2 && i.path[0] === "evidence_brief") {
      const key = i.path[i.path.length - 1];
      return (
        key === "what_happened" ||
        key === "why_it_matters" ||
        key === "what_learned" ||
        key === "what_action"
      );
    }
    return (
      path === "what_happened" ||
      path === "why_it_matters" ||
      path === "what_learned" ||
      path === "what_action"
    );
  });
}

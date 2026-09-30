import { z } from 'zod';
import {
  CRYS_BRIEF_SECTION_MAX,
  EvidenceBriefSchema,
  isBriefSectionFailure
} from './crystallization-brief-schema.js';

// Public surface unchanged: every name below stays importable from this
// path (and through `crystallization/index.js`). The brief schema and its
// `z.infer` type travel together.
export {
  EvidenceBriefSchema,
  hasAllFourBriefSections,
  parseEvidenceBrief,
  safeParseEvidenceBrief
} from './crystallization-brief-schema.js';
export type { EvidenceBrief } from './crystallization-brief-schema.js';

/* ---------------------------------------------------------------------- */
/* PRD-002b slice 2 — schema-limit constants extracted from inline         */
/* `.max(N)` / `.length(N)` calls so the no-magic-numbers rule stops     */
/* flagging the constraint values. Names describe the field, not the     */
/* number. Bytewise-identical to the original literals.                  */
/* ---------------------------------------------------------------------- */
const CRYS_EVIDENCE_BULLET_MAX = 1000;
const CRYS_TRACE_POINTER_MAX = 256;
const CRYS_LOOP_ID_MAX = 64;
// 2 ** 31 - 1 spelled as its own literal so no-magic-numbers has no
// binary expression to flag. Same value, same bound, same message.
const CRYS_BEE_ID_MAX_I32 = 2147483647;
const CRYS_EVENT_ID_MAX = 128;

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
  'user_explicit',
  'llm_suggested',
  'success_default_prompt',
  'similar_task_recurrence'
]);
export type CrystallizationTrigger = z.infer<typeof CrystallizationTriggerSchema>;

export const CRYSTALLIZATION_TRIGGERS: readonly CrystallizationTrigger[] = [
  'user_explicit',
  'llm_suggested',
  'success_default_prompt',
  'similar_task_recurrence'
] as const;

/* ---------------------------------------------------------------------- */
/* Lifecycle status — §5.6 (event-scoped, not asset-scoped)               */
/* ---------------------------------------------------------------------- */

export const CrystallizationEventStatusSchema = z.enum(['candidate', 'stable', 'retired']);
export type CrystallizationEventStatus = z.infer<typeof CrystallizationEventStatusSchema>;

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
  .max(CRYS_LOOP_ID_MAX)
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, {
    message: 'loop_release_id must be kebab-case starting with a lowercase letter'
  })
  .optional();
const OptionalBeeId = z
  .number()
  .int()
  .gt(0)
  .max(CRYS_BEE_ID_MAX_I32, 'bee_release_id out of 32-bit range')
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
  evidence_bullets: z.array(z.string().trim().min(1).max(CRYS_EVIDENCE_BULLET_MAX)).default([]),
  source_trace_pointers: z.array(z.string().trim().min(1).max(CRYS_TRACE_POINTER_MAX)).default([]),
  evaluator_summary: z.string().trim().max(CRYS_BRIEF_SECTION_MAX).default(''),
  user_decision_summary: z.string().trim().max(CRYS_BRIEF_SECTION_MAX).default(''),
  created_loop_release_id: OptionalLoopId,
  updated_loop_release_id: OptionalLoopId,
  created_bee_release_id: OptionalBeeId,
  updated_bee_release_id: OptionalBeeId,
  lifecycle_status: CrystallizationEventStatusSchema.default('candidate')
});
export type CrystallizationEventInput = z.input<typeof CrystallizationEventInputSchema>;

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
    .max(CRYS_EVENT_ID_MAX)
    .regex(/^crys-[0-9a-f]{8,}$/, {
      message: "id must start with 'crys-' followed by a hex suffix (spec §4.5)"
    }),
  schema_version: z.literal('peaks.crystallization/1').default('peaks.crystallization/1'),
  created_at: z.string().datetime()
});
export type CrystallizationEvent = z.infer<typeof CrystallizationEventSchema>;

/**
 * Convenience: strict-parse an unknown payload into a
 * CrystallizationEvent row. Throws ZodError on failure — including
 * when the brief is missing a section (the `.refine` guard fires).
 *
 * Use this at every parse boundary (CLI input, store insertion).
 */
export function parseCrystallizationEvent(input: unknown): CrystallizationEvent {
  return CrystallizationEventSchema.parse(input);
}

/**
 * Safe-parse twin of parseCrystallizationEvent. Returns a Result-like
 * envelope so callers (CLI / tests) can render findings without
 * try/catch noise. The `code` field is `MISSING_BRIEF_SECTION` when
 * the brief refine guard trips OR when ANY brief-section key is
 * missing (spec §10 RL-7) — distinguishes brief failures from
 * generic validation errors.
 */
export function safeParseCrystallizationEvent(input: unknown):
  | { ok: true; row: CrystallizationEvent }
  | {
      ok: false;
      code?: 'MISSING_BRIEF_SECTION';
      findings: Array<{ path: string; message: string }>;
    } {
  const r = CrystallizationEventSchema.safeParse(input);
  if (r.success) return { ok: true, row: r.data };
  const findings = r.error.issues.map((i) => ({
    path: i.path.join('.'),
    message: i.message
  }));
  const isBrief = isBriefSectionFailure(r.error.issues);
  return isBrief ? { ok: false, code: 'MISSING_BRIEF_SECTION', findings } : { ok: false, findings };
}

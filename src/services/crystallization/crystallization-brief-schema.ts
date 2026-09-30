/**
 * Crystallization evidence-brief schema — hoisted VERBATIM out of
 * `crystallization-types.ts` so that file clears the 300 raw-line cap.
 * Nothing here was rewritten: same constraints, same `.superRefine`
 * guard, same issue message, same MISSING_BRIEF_SECTION mapping.
 *
 * `crystallization-types.ts` re-exports every public name from this
 * path, so `EvidenceBriefSchema` / `EvidenceBrief` /
 * `hasAllFourBriefSections` / `parseEvidenceBrief` /
 * `safeParseEvidenceBrief` stay importable from their original module
 * and from `crystallization/index.js`.
 */

import { z } from 'zod';

/* ---------------------------------------------------------------------- */
/* PRD-002b slice 2 — schema-limit constants extracted from inline         */
/* `.max(N)` / `.length(N)` calls so the no-magic-numbers rule stops     */
/* flagging the constraint values. Names describe the field, not the     */
/* number. Bytewise-identical to the original literals.                  */
/* ---------------------------------------------------------------------- */

/** Brief-section cap; the event-level free-text columns in
 *  `crystallization-types.ts` reuse the same bound. */
export const CRYS_BRIEF_SECTION_MAX = 4000;

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
  .min(1, 'brief section must be non-empty natural language')
  .max(CRYS_BRIEF_SECTION_MAX);

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
    what_action: BriefSectionSchema
  })
  .strict()
  .superRefine((b, ctx) => {
    const ok =
      typeof b.what_happened === 'string' &&
      b.what_happened.trim().length > 0 &&
      typeof b.why_it_matters === 'string' &&
      b.why_it_matters.trim().length > 0 &&
      typeof b.what_learned === 'string' &&
      b.what_learned.trim().length > 0 &&
      typeof b.what_action === 'string' &&
      b.what_action.trim().length > 0;
    if (!ok) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message:
          'evidence_brief must contain all 4 sections (what_happened, why_it_matters, what_learned, what_action) with non-empty content (spec §4.7 / RL-7)'
      });
    }
  });

export type EvidenceBrief = z.infer<typeof EvidenceBriefSchema>;

/**
 * Helper for downstream code that needs to know whether a parsed
 * brief satisfies the 4-section rule. Useful for the CLI when a
 * payload arrived from the LLM and the brief-section guard has
 * already passed — it returns the section count, always 4 here.
 */
export function hasAllFourBriefSections(brief: EvidenceBrief): boolean {
  return (
    typeof brief.what_happened === 'string' &&
    brief.what_happened.trim().length > 0 &&
    typeof brief.why_it_matters === 'string' &&
    brief.why_it_matters.trim().length > 0 &&
    typeof brief.what_learned === 'string' &&
    brief.what_learned.trim().length > 0 &&
    typeof brief.what_action === 'string' &&
    brief.what_action.trim().length > 0
  );
}

/**
 * Convenience: strict-parse an unknown payload as a standalone
 * EvidenceBrief. Throws ZodError on failure.
 */
export function parseEvidenceBrief(input: unknown): EvidenceBrief {
  return EvidenceBriefSchema.parse(input);
}

/**
 * Safe-parse twin of parseEvidenceBrief. Same Result-like envelope
 * shape; same MISSING_BRIEF_SECTION code mapping (covers both
 * refine-guard failures and per-section missing/empty failures).
 */
export function safeParseEvidenceBrief(input: unknown):
  | { ok: true; row: EvidenceBrief }
  | {
      ok: false;
      code?: 'MISSING_BRIEF_SECTION';
      findings: Array<{ path: string; message: string }>;
    } {
  const r = EvidenceBriefSchema.safeParse(input);
  if (r.success) return { ok: true, row: r.data };
  const findings = r.error.issues.map((i) => ({
    path: i.path.join('.'),
    message: i.message
  }));
  const isBrief = isBriefSectionFailure(r.error.issues);
  return isBrief ? { ok: false, code: 'MISSING_BRIEF_SECTION', findings } : { ok: false, findings };
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
export function isBriefSectionFailure(issues: ReadonlyArray<z.ZodIssue>): boolean {
  if (issues.length === 0) return false;
  // Explicit refine guard (EvidenceBriefSchema.refine message).
  if (issues.some((i) => i.message.includes('evidence_brief must contain all 4 sections'))) {
    return true;
  }
  // Per-section Zod failures (min(1) on each section key, or
  // too_small, or invalid_type). Each issue's path will be either
  // the section key (`what_happened`) OR the parent `evidence_brief`
  // — Zod reports missing-key issues against the parent object.
  return issues.every((i) => {
    const path = i.path.join('.');
    if (path === 'evidence_brief') return true;
    if (i.path.length >= 2 && i.path[0] === 'evidence_brief') {
      const key = i.path[i.path.length - 1];
      return (
        key === 'what_happened' ||
        key === 'why_it_matters' ||
        key === 'what_learned' ||
        key === 'what_action'
      );
    }
    return (
      path === 'what_happened' ||
      path === 'why_it_matters' ||
      path === 'what_learned' ||
      path === 'what_action'
    );
  });
}

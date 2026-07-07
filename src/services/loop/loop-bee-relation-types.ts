import { z } from "zod";

/**
 * LoopBeeRelation — spec §4.6.
 *
 * The loop↔bee coupling row. M2 scope:
 *   - four roles: main / supporting / candidate / retired.
 *   - exactly one main per loop (enforced by partial unique index + service).
 *   - FK to loop_release (TEXT id) and bee_release (INTEGER id).
 *   - cannot link to a retired loop (enforced in service).
 *
 * Out of scope (deferred to later slices):
 *   - share/desktop fields on the relation itself (none in spec §4.6).
 *   - evolution evidence references (M4).
 *
 * Field semantics — see the spec for full prose. Highlights:
 *
 *   - `id` is the autoincrement row id; storage key.
 *   - `loop_release_id` is the FK to loop_release.id (TEXT).
 *   - `bee_release_id` is the FK to bee_release.id (INTEGER). Note that
 *     `bee_release.id` is an autoincrement INTEGER (not bee_name) — this
 *     matches the existing 4.x schema convention used by bee_manifest,
 *     bee_segment_ref, bee_file, bee_change.
 *   - `role` is the four-value union. A loop can have at most one `main`
 *     row; multiple supporting / candidate / retired rows are allowed.
 *   - `reason` is an NL string the LLM authors at crystallization time
 *     (e.g. "primary bee — implements the loop's success_criteria").
 *   - `created_at` is server-stamped from the system clock; the input
 *     schema does not let clients supply it (would be a backdate hole).
 */
export const LoopBeeRelationRoleSchema = z.enum([
  "main",
  "supporting",
  "candidate",
  "retired",
]);
export type LoopBeeRelationRole = z.infer<typeof LoopBeeRelationRoleSchema>;

export const LOOP_BEE_RELATION_ROLES: readonly LoopBeeRelationRole[] = [
  "main",
  "supporting",
  "candidate",
  "retired",
] as const;

/**
 * Zod schema for the create payload (LoopBeeRelationInput).
 *
 * `loop_release_id` must match the same kebab-case pattern as
 * `LoopRelease.id` — this is a defensive duplicate of the FK target's
 * shape, but the authoritative check is the FK constraint at insert
 * time (better-sqlite3 with `foreign_keys = ON`).
 *
 * `bee_release_id` is a positive integer; matching the
 * `bee_release.id` autoincrement INTEGER PK.
 */
export const LoopBeeRelationInputSchema = z.object({
  loop_release_id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, {
      message:
        "loop_release_id must be kebab-case starting with a lowercase letter",
    }),
  bee_release_id: z
    .number()
    .int()
    .positive()
    .max(2 ** 31 - 1, "bee_release_id out of 32-bit range"),
  role: LoopBeeRelationRoleSchema,
  reason: z
    .string()
    .trim()
    .min(1, "reason is required (LLM-authored NL explanation)")
    .max(2000),
});
export type LoopBeeRelationInput = z.input<typeof LoopBeeRelationInputSchema>;

/**
 * Full Zod schema for a LoopBeeRelation row as persisted. Differs from
 * the input schema only in that `schema_version` is exposed (and
 * defaulted to the fixed literal). The literal constraint still rejects
 * any client-supplied value other than `"peaks.loop-bee-relation/1"`;
 * the default means omitting the key is fine and the output always
 * carries the constant.
 *
 * We expose this as the canonical "row schema" used by service.create /
 * read paths.
 */
export const LoopBeeRelationSchema = LoopBeeRelationInputSchema.extend({
  id: z.number().int().positive(),
  schema_version: z
    .literal("peaks.loop-bee-relation/1")
    .default("peaks.loop-bee-relation/1"),
  created_at: z.string().datetime(),
});
export type LoopBeeRelation = z.infer<typeof LoopBeeRelationSchema>;

/**
 * Convenience: strict-parse an unknown payload into a LoopBeeRelation
 * row. Throws ZodError on failure. This is the public validation
 * boundary.
 */
export function parseLoopBeeRelation(input: unknown): LoopBeeRelation {
  return LoopBeeRelationSchema.parse(input) as LoopBeeRelation;
}

/**
 * Convenience: safe-parse that returns a Result-like shape so callers
 * can render findings without try/catch noise.
 */
export function safeParseLoopBeeRelation(
  input: unknown
):
  | { ok: true; row: LoopBeeRelation }
  | { ok: false; findings: Array<{ path: string; message: string }> } {
  const r = LoopBeeRelationSchema.safeParse(input);
  if (r.success) return { ok: true, row: r.data as LoopBeeRelation };
  return {
    ok: false,
    findings: r.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  };
}
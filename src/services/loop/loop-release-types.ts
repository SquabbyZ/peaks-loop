import { z } from "zod";

/**
 * LoopRelease — spec §4.1 (Loop Engineering Asset).
 *
 * M1 scope was the §4.1 fields. M3 (this slice) ADDS the share /
 * desktop extension fields from §4.1 / §7A:
 *   - shareable              (boolean, default true)
 *   - share_excluded_paths   (string[], default [])
 *   - desktop_visible        (boolean, default true)
 *   - export_bundle_format   ('peaks.bundle/1', CLI-written constant)
 *
 * The four M3 fields are added with `.default(...)` so an in-memory
 * object built from a pre-M3 snapshot still parses after the
 * migration runs. NO enforcement on `shareable=false` is added in M3
 * — the schema-only addition is the contract; full export /
 * desktop enforcement lands in M7 (see plan
 * m3-bee-release-extension.md and spec §7A).
 *
 * Field semantics — see the spec for full prose. Highlights:
 *
 *   - `id` is the stable kebab-case loop id; the storage key.
 *   - `schema_version` is the constant literal `"peaks.loop/1"`; a
 *     schema-version bump requires a new table / new enum case and a
 *     migration — never edit this literal in place.
 *   - `lifecycle_status` is `candidate` / `stable` / `retired`; the
 *     default on first crystallization is `candidate`. LLMs cannot
 *     auto-promote to `stable` (see spec §5.6).
 *   - `linked_bees` is a denormalized pointer list of bee ids; the
 *     authoritative loop↔bee relations live in `loop_bee_relation`
 *     (M2). Keeping it here matches the spec §4.1 row shape and lets
 *     M1 readers iterate the loop without an extra join.
 *   - `success_criteria` / `evaluator_policy` are NL strings, not
 *     machine-checked predicates; the evaluator definitions live in
 *     the M4 evolution layer.
 *   - `share_excluded_paths` is a JSON-encoded TEXT column at the
 *     SQLite layer; the Zod schema accepts a string[] and the store
 *     does the JSON.stringify/parse boundary work. Matches the
 *     existing `loop_release` style (success_criteria_json, …).
 *   - `export_bundle_format` is pinned to the literal
 *     `"peaks.bundle/1"` per the spec §7A.2 contract — no other
 *     value is accepted in this schema version.
 */

export const LoopReleaseLifecycleStatusSchema = z.enum([
  "candidate",
  "stable",
  "retired",
]);
export type LoopReleaseLifecycleStatus = z.infer<
  typeof LoopReleaseLifecycleStatusSchema
>;

/**
 * The M3 share / desktop extension fields, listed for code-search /
 * lint discoverability. They are now part of the schema (with safe
 * defaults) — see `LoopReleaseM3ExtensionSchema` below.
 *
 *   - shareable: defaults to true.
 *   - share_excluded_paths: string[] (defaults to []).
 *   - desktop_visible: defaults to true.
 *   - export_bundle_format: constant "peaks.bundle/1" (CLI-written).
 */
export const LOOP_RELEASE_M3_FIELDS = [
  "shareable",
  "share_excluded_paths",
  "desktop_visible",
  "export_bundle_format",
] as const;

/**
 * M3 share / desktop extension schema. Added to `LoopReleaseInputSchema`
 * via `.extend(...)` so existing callers that omit these fields still
 * parse — the Zod defaults below supply the spec values
 * (true / [] / true / "peaks.bundle/1").
 *
 * `export_bundle_format` is pinned to a literal per spec §7A.2: the
 * CLI is the only writer and only `"peaks.bundle/1"` is accepted. A
 * schema-version bump is required to introduce another value.
 */
export const LoopReleaseM3ExtensionSchema = z.object({
  shareable: z.boolean().default(true),
  share_excluded_paths: z
    .array(z.string().min(1).max(4096))
    .default([]),
  desktop_visible: z.boolean().default(true),
  export_bundle_format: z
    .literal("peaks.bundle/1")
    .default("peaks.bundle/1"),
});
/** Convenience type for the M3 share / desktop subset. */
export type LoopReleaseM3Extension = z.infer<
  typeof LoopReleaseM3ExtensionSchema
>;

/**
 * Zod schema for the create payload (LoopReleaseInput). Mirrors the
 * §4.1 row shape; `schema_version` is defaulted (clients cannot
 * override it) and `created_at` is not part of the input — the store
 * stamps it from the server clock.
 */
export const LoopReleaseInputSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, {
        message:
          "id must be kebab-case starting with a lowercase letter (e.g. loop-onboarding-research)",
      }),
    name: z.string().min(1).max(200),
    scenario: z.string().trim().min(1).max(4000),
    trigger_policy: z.string().trim().min(1).max(2000),
    success_criteria: z
      .array(z.string().trim().min(1).max(1000))
      .min(1, "success_criteria must list at least one declarative criterion"),
    interaction_policy: z
      .string()
      .trim()
      .min(1, "interaction_policy must declare human-NL-choice-only semantics")
      .max(2000),
    feedback_policy: z.string().trim().min(1).max(2000),
    evolution_policy: z.string().trim().min(1).max(2000),
    evaluator_policy: z.array(z.string().trim().min(1).max(1000)).min(1),
    linked_bees: z.array(z.string().min(1).max(64)).default([]),
    run_history: z.array(z.string().min(1).max(128)).default([]),
    crystallization_evidence: z.array(z.string().min(1).max(128)).default([]),
    lifecycle_status: LoopReleaseLifecycleStatusSchema,
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, {
        message: "version must be a semver string (e.g. 0.1.0)",
      }),
  })
  .extend(LoopReleaseM3ExtensionSchema.shape);
/**
 * `LoopReleaseInput` is the *input* shape clients supply: defaulted
 * fields (linked_bees / run_history / crystallization_evidence) are
 * optional here. We use `z.input` (not `z.infer`) so the inferred
 * type matches the create-call signature; the parsed output type —
 * with all defaulted fields filled — is `LoopRelease`.
 */
export type LoopReleaseInput = z.input<typeof LoopReleaseInputSchema>;

/**
 * Full Zod schema for a LoopRelease row as persisted. Differs from the
 * input schema only in that `schema_version` is exposed (and defaulted
 * to the fixed literal). The literal constraint still rejects any
 * client-supplied value other than `"peaks.loop/1"`; the default
 * means omitting the key is fine and the output always carries the
 * constant.
 *
 * We expose this as the canonical "row schema" used by lint and
 * service.create/read paths.
 */
export const LoopReleaseSchema = LoopReleaseInputSchema.extend({
  schema_version: z
    .literal("peaks.loop/1")
    .default("peaks.loop/1"),
});
export type LoopRelease = z.infer<typeof LoopReleaseSchema>;

/**
 * Convenience: strict-parse an unknown payload into a LoopRelease row.
 * Throws ZodError on failure. This is the public validation boundary.
 */
export function parseLoopRelease(input: unknown): LoopRelease {
  return LoopReleaseSchema.parse(input) as LoopRelease;
}

/**
 * Convenience: safe-parse that returns a Result-like shape so callers
 * (CLI layer in M5) can render findings without try/catch noise.
 */
export function safeParseLoopRelease(
  input: unknown
): { ok: true; row: LoopRelease } | { ok: false; findings: Array<{ path: string; message: string }> } {
  const r = LoopReleaseSchema.safeParse(input);
  if (r.success) return { ok: true, row: r.data as LoopRelease };
  return {
    ok: false,
    findings: r.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  };
}
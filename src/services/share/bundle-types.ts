/**
 * peaks.bundle/1 — share-bundle format contract (spec §7A.2).
 *
 * M7 / spec §7A.2 / §10 RL-9.
 *
 * A bundle is a self-describing tar.gz whose root manifest
 * (manifest.json) declares the format constant, the major/minor
 * format version, the schema_version of every contained asset, the
 * assets themselves (loop_release + related bee_release rows), the
 * relation rows, and the evidence briefs that back the assets. The
 * bundle excludes private run_state, `.peaks/memory/personal/`, and
 * raw `state.db` rows.
 *
 * Hard rules enforced at THIS layer:
 *
 *   - The literal constant `format_constant = "peaks.bundle/1"` is
 *     set inside the manifest at write time. The CLI is the only
 *     writer; a future format change is signaled by bumping the
 *     major field and shipping a new writer.
 *   - `format_version_major = 1` is required for any current
 *     receiver. A major-version mismatch is a HARD block at read
 *     time (the reader throws and refuses to import).
 *   - `format_version_minor` is informational; a major-compatible
 *     minor bump emits a non-fatal warning at read time.
 *   - `schema_versions` carries the canonical asset schema literal
 *     for each emitted asset: `peaks.loop/1`, `peaks.bee/1`, plus
 *     the cross-cutting `peaks.loop-bee-relation/1` and
 *     `peaks.crystallization/1`. The reader uses the values to
 *     inform a version-mismatch warning.
 *
 * The schema is intentionally permissive on the manifests (the
 * manifest sub-objects are typed as `unknown` so each asset kind
 * can validate with its own Zod schema at the service layer); the
 * hard invariants (format constant, format_version_major, the
 * schema_versions keys, and the inclusion/exclusion rules) are
 * enforced here at the format boundary.
 *
 * On-the-wire shape (the rendered `manifest.json`):
 *
 *   {
 *     "format_constant":          "peaks.bundle/1",
 *     "format_version_major":     1,
 *     "format_version_minor":     0,
 *     "schema_versions": {
 *        "loop":              "peaks.loop/1",
 *        "bee":               "peaks.bee/1",
 *        "loop_bee_relation": "peaks.loop-bee-relation/1",
 *        "crystallization":   "peaks.crystallization/1"
 *     },
 *     "kind":               "loop" | "bee",
 *     "loop_release":       <LoopRelease row or omitted for bee kind>,
 *     "bee_release":        <BeeRelease row or omitted for loop kind>,
 *     "related_bee_releases": Array<BeeRelease row>,
 *     "loop_bee_relations":   Array<LoopBeeRelation row>,
 *     "evidence_briefs":    Array<CrystallizationEvent row>,
 *     "exclusion_manifest": { "private_run_state": "excluded",
 *                            "personal_memory":    "excluded",
 *                            "state_db_rows":      "excluded" }
 *   }
 *
 * Excludes (spec §7A.2 hard rules): private run_state, anything
 * under `.peaks/memory/personal/`, raw `state.db` rows.
 */

import { z } from "zod";

/* ---------------------------------------------------------------------- */
/* Format constant + version                                                */
/* ---------------------------------------------------------------------- */

/**
 * The on-the-wire format constant, pinned to the literal
 * `"peaks.bundle/1"`. The CLI is the only writer — see `bundle-writer.ts`.
 * A future format change requires a major-version bump + a new writer.
 */
export const PEAKS_BUNDLE_FORMAT_CONSTANT = "peaks.bundle/1" as const;

/**
 * The required `format_version_major` for any current receiver.
 * Bumped only on a breaking schema change. The reader throws when
 * the manifest declares any value other than `1`.
 */
export const PEAKS_BUNDLE_FORMAT_VERSION_MAJOR = 1 as const;

/**
 * Default `format_version_minor`. Major-compatible minor bumps emit
 * a soft warning at read time; they never block.
 */
export const PEAKS_BUNDLE_DEFAULT_MINOR_VERSION = 0 as const;

/* ---------------------------------------------------------------------- */
/* Schema-version cross-reference (per asset table)                         */
/* ---------------------------------------------------------------------- */

/**
 * The cross-cutting schema literals a bundle is allowed to declare.
 * Each value must match the canonical Zod `literal(...)` literal in
 * the corresponding type module. Used for the
 * `SchemaVersionsMapping` enumeration below.
 */
export const PEAKS_BUNDLE_SCHEMA_VERSIONS = {
  loop: "peaks.loop/1",
  bee: "peaks.bee/1",
  loop_bee_relation: "peaks.loop-bee-relation/1",
  crystallization: "peaks.crystallization/1",
} as const;
export type PeaksBundleSchemaVersionKey = keyof typeof PEAKS_BUNDLE_SCHEMA_VERSIONS;

/* ---------------------------------------------------------------------- */
/* Schema-versions mapping — spec §7A.2                                     */
/* ---------------------------------------------------------------------- */

/**
 * Schema-versions mapping. The writer writes the canonical literal
 * for each asset kind it includes; the reader checks every key for
 * presence (and that the value matches the canonical literal).
 *
 * `.strict()` refuses unknown keys; `.refine(...)` enforces that
 * each value matches its canonical literal.
 */
export const SchemaVersionsMappingSchema = z
  .object({
    loop: z.literal(PEAKS_BUNDLE_SCHEMA_VERSIONS.loop),
    bee: z.literal(PEAKS_BUNDLE_SCHEMA_VERSIONS.bee),
    loop_bee_relation: z.literal(PEAKS_BUNDLE_SCHEMA_VERSIONS.loop_bee_relation),
    crystallization: z.literal(PEAKS_BUNDLE_SCHEMA_VERSIONS.crystallization),
  })
  .strict();
export type SchemaVersionsMapping = z.infer<typeof SchemaVersionsMappingSchema>;

/* ---------------------------------------------------------------------- */
/* Exclusion manifest — the explicit excludes per spec §7A.2               */
/* ---------------------------------------------------------------------- */

/**
 * The bundle explicitly excludes private run-state, the user's
 * personal memory directory, and raw `state.db` rows. The
 * `ExclusionManifestSchema` is what the writer stamps into the
 * manifest; the reader uses it as a self-declaration (the writer is
 * the only place that can leak those payloads, but the read-time
 * stamp lets the receiver confirm the source understood the
 * exclusion rules).
 */
export const ExclusionManifestSchema = z
  .object({
    private_run_state: z.literal("excluded"),
    personal_memory: z.literal("excluded"),
    state_db_rows: z.literal("excluded"),
  })
  .strict();
export type ExclusionManifest = z.infer<typeof ExclusionManifestSchema>;

/* ---------------------------------------------------------------------- */
/* Bundle kind — which asset the bundle is anchored on                     */
/* ---------------------------------------------------------------------- */

/**
 * Bundle kind. A bundle is anchored on exactly one asset: either a
 * `loop_release` (and its main bee + supporting bees) or a single
 * `bee_release` (loop-scoped relations may follow but are not
 * required).
 */
export const PEAKS_BUNDLE_KINDS = ["loop", "bee"] as const;
export type PeaksBundleKind = (typeof PEAKS_BUNDLE_KINDS)[number];

/* ---------------------------------------------------------------------- */
/* Bundle manifest schema — the on-the-wire shape                          */
/* ---------------------------------------------------------------------- */

/**
 * The full manifest schema. The asset sub-objects are typed as
 * `unknown` here; each service layer validates them with the
 * appropriate per-kind Zod schema (LoopReleaseSchema,
 * BeeReleaseRow, LoopBeeRelationSchema, CrystallizationEventSchema).
 *
 * The hard invariants are enforced HERE:
 *   - `format_constant = "peaks.bundle/1"` literal.
 *   - `format_version_major = 1` literal (HARD block at read time
 *     on mismatch — enforced in `bundle-reader.ts`).
 *   - `schema_versions` carries every required key with the
 *     canonical literal.
 *   - `exclusion_manifest` declares the three hard excludes.
 */
export const BundleManifestSchema = z
  .object({
    /**
     * The format constant. Pinned to `"peaks.bundle/1"`. A future
     * format change is a major bump + a new constant value.
     */
    format_constant: z.literal(PEAKS_BUNDLE_FORMAT_CONSTANT),
    /**
     * Major version. The reader requires `1`; anything else is a
     * HARD block. Enforced at the read boundary, not here.
     */
    format_version_major: z.literal(PEAKS_BUNDLE_FORMAT_VERSION_MAJOR),
    /**
     * Minor version. Defaults to `0`. Major-compatible bumps are a
     * non-fatal warn at read time.
     */
    format_version_minor: z.number().int().min(0).default(PEAKS_BUNDLE_DEFAULT_MINOR_VERSION),
    /**
     * Schema-version mapping. Every required key MUST be present
     * with its canonical literal; unknown keys are rejected by
     * `.strict()`.
     */
    schema_versions: SchemaVersionsMappingSchema,
    /**
     * Anchor kind. Decides whether `loop_release` or `bee_release`
     * is required below.
     */
    kind: z.enum(PEAKS_BUNDLE_KINDS),
    /**
     * The loop_release row. Required when `kind === "loop"`,
     * omitted (or absent) when `kind === "bee"`. The writer leaves
     * it `undefined` for `bee` bundles; the JSON shape is allowed
     * to omit it.
     */
    loop_release: z.unknown().optional(),
    /**
     * The bee_release row. Required when `kind === "bee"`,
     * optional for `kind === "loop"` (a loop bundle may include a
     * main bee inline). When present, the reader uses the service
     * layer to re-validate the row shape.
     */
    bee_release: z.unknown().optional(),
    /**
     * Related bee_release rows for the loop kind (main + supporting
     * + candidate + retired). Empty for `kind === "bee"`.
     */
    related_bee_releases: z.array(z.unknown()).default([]),
    /**
     * Loop↔bee relation rows from `loop_bee_relation`. Always
     * present (possibly empty).
     */
    loop_bee_relations: z.array(z.unknown()).default([]),
    /**
     * Evidence briefs (crystallization_event rows) that back the
     * bundle's assets. The receiver uses them to render the
     * post-import crystallization prompt + a brief for any
     * subsequent independent evaluation.
     */
    evidence_briefs: z.array(z.unknown()).default([]),
    /**
     * Exclusion manifest — explicit declarations of the three
     * hard excludes per spec §7A.2.
     */
    exclusion_manifest: ExclusionManifestSchema,
  })
  .strict()
  .refine(
    (m) => {
      // kind === 'loop' implies loop_release is required.
      if (m.kind === "loop" && m.loop_release === undefined) return false;
      // kind === 'bee' implies bee_release is required.
      if (m.kind === "bee" && m.bee_release === undefined) return false;
      return true;
    },
    {
      message:
        "bundle manifest is inconsistent: kind='loop' requires loop_release; kind='bee' requires bee_release (spec §7A.2)",
      path: [],
    }
  );

export type BundleManifest = z.infer<typeof BundleManifestSchema>;

/* ---------------------------------------------------------------------- */
/* Validation helpers                                                      */
/* ---------------------------------------------------------------------- */

/**
 * Strict-parse an unknown value as a BundleManifest. Throws
 * `z.ZodError` on any failure — including:
 *   - format_constant !== "peaks.bundle/1"
 *   - format_version_major !== 1
 *   - schema_versions missing or carrying non-canonical literals
 *   - exclusion_manifest missing any of the three hard excludes
 *   - kind / anchor-mismatch (loop kind without loop_release, etc.)
 *
 * Note: a major-version mismatch on its own is NOT a Zod failure
 * (the literal is enforced at the schema boundary so it is), but
 * the `bundle-reader.ts` HARD block on major mismatch is layered on
 * top of this parse for defense in depth (it lets the CLI emit its
 * own specific error code without catching Zod errors).
 */
export function parseBundleManifest(input: unknown): BundleManifest {
  return BundleManifestSchema.parse(input) as BundleManifest;
}

/**
 * Safe-parse twin of `parseBundleManifest` — returns a Result-like
 * envelope. Used by the CLI layer so a manifest-validation failure
 * can be rendered as a structured error code rather than a thrown
 * `ZodError`.
 */
export function safeParseBundleManifest(
  input: unknown
):
  | { ok: true; manifest: BundleManifest }
  | {
      ok: false;
      code:
        | "BUNDLE_FORMAT_CONSTANT_MISMATCH"
        | "BUNDLE_MAJOR_VERSION_MISMATCH"
        | "BUNDLE_SCHEMA_VERSIONS_MISMATCH"
        | "BUNDLE_EXCLUSION_MANIFEST_MISSING"
        | "BUNDLE_KIND_ANCHOR_MISMATCH";
      findings: Array<{ path: string; message: string }>;
    } {
  const r = BundleManifestSchema.safeParse(input);
  if (r.success) return { ok: true, manifest: r.data as BundleManifest };
  const findings = r.error.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
  const joined = findings.map((f) => f.path + ":" + f.message).join("|");
  const code = detectManifestFailureCode(joined);
  return { ok: false, code, findings };
}

function detectManifestFailureCode(joinedIssues: string): Extract<
  ReturnType<typeof safeParseBundleManifest>,
  { ok: false }
>["code"] {
  if (joinedIssues.includes("format_constant")) {
    return "BUNDLE_FORMAT_CONSTANT_MISMATCH";
  }
  if (joinedIssues.includes("format_version_major")) {
    return "BUNDLE_MAJOR_VERSION_MISMATCH";
  }
  if (joinedIssues.includes("schema_versions")) {
    return "BUNDLE_SCHEMA_VERSIONS_MISMATCH";
  }
  if (joinedIssues.includes("exclusion_manifest")) {
    return "BUNDLE_EXCLUSION_MANIFEST_MISSING";
  }
  return "BUNDLE_KIND_ANCHOR_MISMATCH";
}

/* ---------------------------------------------------------------------- */
/* Hard-block error code consts                                              */
/* ---------------------------------------------------------------------- */

/**
 * Error code string consts. Centralised here so the writer + reader
 * share a single source of truth for error codes; the CLI layer
 * only needs to render them.
 */
export const SHARE_BUNDLE_ERROR_CODES = {
  /** Major-version mismatch at read time — HARD block. */
  MAJOR_VERSION_MISMATCH: "SHARE_BUNDLE_MAJOR_VERSION_MISMATCH",
  /** Schema-version mapping is missing or carries non-canonical literals. */
  SCHEMA_VERSIONS_MISMATCH: "SHARE_BUNDLE_SCHEMA_VERSIONS_MISMATCH",
  /** Format constant is not the pinned "peaks.bundle/1". */
  FORMAT_CONSTANT_MISMATCH: "SHARE_BUNDLE_FORMAT_CONSTANT_MISMATCH",
  /** Source release has `shareable === false` — HARD block at write time. */
  NOT_SHAREABLE: "SHARE_BUNDLE_NOT_SHAREABLE",
  /** Receiver asked to land as `stable` (forbidden — bundles always land as candidate). */
  IMPORT_TO_STABLE_FORBIDDEN: "SHARE_BUNDLE_IMPORT_TO_STABLE_FORBIDDEN",
  /** Bundle tarball is malformed (missing manifest, bad payload). */
  BUNDLE_MALFORMED: "SHARE_BUNDLE_MALFORMED",
} as const;

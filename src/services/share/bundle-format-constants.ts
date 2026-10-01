/**
 * peaks.bundle/1 — format constants and schema-version literals (wave-5 hoist).
 *
 * The declaration cluster that used to open `bundle-types.ts` — the format
 * constant, the major/minor version consts, the per-asset schema-version
 * literals, the two small mapping schemas built on them and the bundle-kind
 * enumeration — moved here VERBATIM so `bundle-types.ts` stays under the
 * 300-line cap. The manifest contract, and every hard rule enforced on the
 * on-the-wire shape, stay in `bundle-types.ts`.
 *
 * This module imports only `zod`. It MUST NOT import `bundle-types.js`: the
 * manifest schema there evaluates `z.literal(PEAKS_BUNDLE_FORMAT_CONSTANT)`
 * while its module body runs, so a back-import would be a TDZ crash, not a
 * lint warning. `bundle-types.ts` re-exports every name below, so the public
 * import path does not move.
 */

import { z } from 'zod';

/* ---------------------------------------------------------------------- */
/* Format constant + version                                                */
/* ---------------------------------------------------------------------- */

/**
 * The on-the-wire format constant, pinned to the literal
 * `"peaks.bundle/1"`. The CLI is the only writer — see `bundle-writer.ts`.
 * A future format change requires a major-version bump + a new writer.
 */
export const PEAKS_BUNDLE_FORMAT_CONSTANT = 'peaks.bundle/1' as const;

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
  loop: 'peaks.loop/1',
  bee: 'peaks.bee/1',
  loop_bee_relation: 'peaks.loop-bee-relation/1',
  crystallization: 'peaks.crystallization/1'
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
    crystallization: z.literal(PEAKS_BUNDLE_SCHEMA_VERSIONS.crystallization)
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
    private_run_state: z.literal('excluded'),
    personal_memory: z.literal('excluded'),
    state_db_rows: z.literal('excluded')
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
export const PEAKS_BUNDLE_KINDS = ['loop', 'bee'] as const;
export type PeaksBundleKind = (typeof PEAKS_BUNDLE_KINDS)[number];

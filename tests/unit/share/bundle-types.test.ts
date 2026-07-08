/**
 * bundle-types.test.ts — M7 / spec §7A.2.
 *
 * Pure schema tests for `peaks.bundle/1`. No filesystem, no
 * SQLite, no tar — those are exercised in `bundle-writer.test.ts`
 * and `bundle-reader.test.ts`.
 *
 * Coverage:
 *   - format_constant literal ("peaks.bundle/1").
 *   - format_version_major literal (= 1).
 *   - format_version_minor default (= 0).
 *   - schema_versions mapping (every required key with its
 *     canonical literal).
 *   - exclusion_manifest shape.
 *   - kind / anchor-mismatch refine (loop kind requires
 *     loop_release, bee kind requires bee_release).
 *   - parseBundleManifest + safeParseBundleManifest helpers.
 *   - SHARE_BUNDLE_NOT_SHAREABLE error code constant (writer uses
 *     it; reader uses the rest).
 */

import { describe, expect, it } from "vitest";
import {
  BundleManifestSchema,
  ExclusionManifestSchema,
  PEAKS_BUNDLE_DEFAULT_MINOR_VERSION,
  PEAKS_BUNDLE_FORMAT_CONSTANT,
  PEAKS_BUNDLE_FORMAT_VERSION_MAJOR,
  PEAKS_BUNDLE_SCHEMA_VERSIONS,
  SchemaVersionsMappingSchema,
  parseBundleManifest,
  safeParseBundleManifest,
  SHARE_BUNDLE_ERROR_CODES,
} from "../../../src/services/share/bundle-types.js";

function minimalLoopManifest(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format_constant: PEAKS_BUNDLE_FORMAT_CONSTANT,
    format_version_major: PEAKS_BUNDLE_FORMAT_VERSION_MAJOR,
    format_version_minor: PEAKS_BUNDLE_DEFAULT_MINOR_VERSION,
    schema_versions: {
      loop: PEAKS_BUNDLE_SCHEMA_VERSIONS.loop,
      bee: PEAKS_BUNDLE_SCHEMA_VERSIONS.bee,
      loop_bee_relation: PEAKS_BUNDLE_SCHEMA_VERSIONS.loop_bee_relation,
      crystallization: PEAKS_BUNDLE_SCHEMA_VERSIONS.crystallization,
    },
    kind: "loop",
    loop_release: {
      id: "loop-x",
      name: "X",
      lifecycle_status: "candidate",
      schema_version: PEAKS_BUNDLE_SCHEMA_VERSIONS.loop,
      version: "0.1.0",
      archived_at: "2026-07-08T00:00:00.000Z",
      shareable: true,
      desktop_visible: true,
      export_bundle_format: PEAKS_BUNDLE_FORMAT_CONSTANT,
    },
    related_bee_releases: [],
    loop_bee_relations: [],
    evidence_briefs: [],
    exclusion_manifest: {
      private_run_state: "excluded",
      personal_memory: "excluded",
      state_db_rows: "excluded",
    },
    ...extra,
  };
}

function minimalBeeManifest(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format_constant: PEAKS_BUNDLE_FORMAT_CONSTANT,
    format_version_major: PEAKS_BUNDLE_FORMAT_VERSION_MAJOR,
    format_version_minor: PEAKS_BUNDLE_DEFAULT_MINOR_VERSION,
    schema_versions: {
      loop: PEAKS_BUNDLE_SCHEMA_VERSIONS.loop,
      bee: PEAKS_BUNDLE_SCHEMA_VERSIONS.bee,
      loop_bee_relation: PEAKS_BUNDLE_SCHEMA_VERSIONS.loop_bee_relation,
      crystallization: PEAKS_BUNDLE_SCHEMA_VERSIONS.crystallization,
    },
    kind: "bee",
    bee_release: {
      bee_release: {
        bee_name: "bee-x",
        version: "0.1.0",
        lifecycle_status: "candidate",
      },
      manifest: null,
      segments: [],
      files: [],
      changes: [],
    },
    related_bee_releases: [],
    loop_bee_relations: [],
    evidence_briefs: [],
    exclusion_manifest: {
      private_run_state: "excluded",
      personal_memory: "excluded",
      state_db_rows: "excluded",
    },
    ...extra,
  };
}

describe("bundle-types / format constants", () => {
  it("PEAKS_BUNDLE_FORMAT_CONSTANT is pinned to peaks.bundle/1", () => {
    expect(PEAKS_BUNDLE_FORMAT_CONSTANT).toBe("peaks.bundle/1");
  });
  it("PEAKS_BUNDLE_FORMAT_VERSION_MAJOR is pinned to 1", () => {
    expect(PEAKS_BUNDLE_FORMAT_VERSION_MAJOR).toBe(1);
  });
  it("SHARE_BUNDLE_NOT_SHAREABLE error code is exposed", () => {
    expect(SHARE_BUNDLE_ERROR_CODES.NOT_SHAREABLE).toBe(
      "SHARE_BUNDLE_NOT_SHAREABLE"
    );
  });
});

describe("bundle-types / SchemaVersionsMappingSchema", () => {
  it("accepts the canonical mapping", () => {
    const r = SchemaVersionsMappingSchema.safeParse(PEAKS_BUNDLE_SCHEMA_VERSIONS);
    expect(r.success).toBe(true);
  });
  it("rejects a missing key", () => {
    const partial = { ...PEAKS_BUNDLE_SCHEMA_VERSIONS } as Record<
      string,
      string
    >;
    delete partial.crystallization;
    const r = SchemaVersionsMappingSchema.safeParse(partial);
    expect(r.success).toBe(false);
  });
  it("rejects a non-canonical literal", () => {
    const r = SchemaVersionsMappingSchema.safeParse({
      ...PEAKS_BUNDLE_SCHEMA_VERSIONS,
      loop: "peaks.loop/99",
    });
    expect(r.success).toBe(false);
  });
});

describe("bundle-types / ExclusionManifestSchema", () => {
  it("requires the three keys each pinned to 'excluded'", () => {
    expect(
      ExclusionManifestSchema.safeParse({
        private_run_state: "excluded",
        personal_memory: "excluded",
        state_db_rows: "excluded",
      }).success
    ).toBe(true);
    expect(
      ExclusionManifestSchema.safeParse({
        private_run_state: "included",
        personal_memory: "excluded",
        state_db_rows: "excluded",
      }).success
    ).toBe(false);
  });
  it("rejects unknown keys (strict shape)", () => {
    expect(
      ExclusionManifestSchema.safeParse({
        private_run_state: "excluded",
        personal_memory: "excluded",
        state_db_rows: "excluded",
        extra_key: "x",
      }).success
    ).toBe(false);
  });
});

describe("bundle-types / BundleManifestSchema — format_constant enforcement", () => {
  it("rejects a wrong format_constant", () => {
    const r = BundleManifestSchema.safeParse({
      ...minimalLoopManifest(),
      format_constant: "peaks.bundle/2",
    });
    expect(r.success).toBe(false);
  });
  it("accepts the pinned constant", () => {
    const r = BundleManifestSchema.safeParse(minimalLoopManifest());
    expect(r.success).toBe(true);
  });
});

describe("bundle-types / BundleManifestSchema — format_version_major enforcement", () => {
  it("rejects a major-version mismatch", () => {
    const r = BundleManifestSchema.safeParse({
      ...minimalLoopManifest(),
      format_version_major: 2,
    });
    expect(r.success).toBe(false);
  });
});

describe("bundle-types / BundleManifestSchema — kind / anchor refine", () => {
  it("rejects kind='loop' without loop_release", () => {
    const manifest = minimalLoopManifest();
    const stripped = { ...manifest } as Record<string, unknown>;
    delete stripped.loop_release;
    const r = BundleManifestSchema.safeParse(stripped);
    expect(r.success).toBe(false);
  });
  it("rejects kind='bee' without bee_release", () => {
    const manifest = minimalBeeManifest();
    const stripped = { ...manifest } as Record<string, unknown>;
    delete stripped.bee_release;
    const r = BundleManifestSchema.safeParse(stripped);
    expect(r.success).toBe(false);
  });
  it("accepts a bee-anchored manifest", () => {
    const r = BundleManifestSchema.safeParse(minimalBeeManifest());
    expect(r.success).toBe(true);
  });
});

describe("bundle-types / parseBundleManifest + safeParseBundleManifest", () => {
  it("parseBundleManifest returns the parsed manifest on success", () => {
    const m = parseBundleManifest(minimalLoopManifest());
    expect(m.format_constant).toBe(PEAKS_BUNDLE_FORMAT_CONSTANT);
    expect(m.kind).toBe("loop");
  });
  it("safeParseBundleManifest maps wrong format_constant to BUNDLE_FORMAT_CONSTANT_MISMATCH", () => {
    const bad = { ...minimalLoopManifest(), format_constant: "x" };
    const r = safeParseBundleManifest(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("BUNDLE_FORMAT_CONSTANT_MISMATCH");
  });
  it("safeParseBundleManifest maps a schema_versions gap to BUNDLE_SCHEMA_VERSIONS_MISMATCH", () => {
    const sv = { ...PEAKS_BUNDLE_SCHEMA_VERSIONS } as Record<string, string>;
    delete sv.loop;
    const bad = {
      ...minimalLoopManifest(),
      schema_versions: { ...sv, bee: "x" as unknown as string },
    };
    const r = safeParseBundleManifest(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("BUNDLE_SCHEMA_VERSIONS_MISMATCH");
  });
  it("safeParseBundleManifest maps anchor-mismatch to BUNDLE_KIND_ANCHOR_MISMATCH", () => {
    const stripped = { ...minimalBeeManifest() } as Record<string, unknown>;
    delete stripped.bee_release;
    const r = safeParseBundleManifest(stripped);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("BUNDLE_KIND_ANCHOR_MISMATCH");
  });
});

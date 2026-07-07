export interface BeeReleaseRow {
  id: number;
  bee_name: string;
  version: string;
  source: "user";
  archived_at: string;
  archived_by: "user" | "llm";
  user_intent_raw: string | null;
  description: string | null;
  parent_version: string | null;
  changelog: string | null;
  /**
   * M3 / spec §4.2: `shareable` defaults to true (1 in SQLite).
   * Enforced at the export CLI layer in M7; M3 only adds the column.
   */
  shareable: 0 | 1;
  /**
   * M3 / spec §4.2: `desktop_visible` defaults to true (1 in SQLite).
   * Desktop visibility is a UI accelerator filter; M7 reads this.
   */
  desktop_visible: 0 | 1;
}

export interface BeeReleasePointerRow {
  bee_name: string;
  latest_version: string;
  released_at: string;
}

export interface BeeManifestRow {
  release_id: number;
  schema_version: string;
  description: string;
  segments_json: string;
  entrypoint_preamble: string | null;
  promotion: string;
  min_cycles: number | null;
  requires_human: number;
  requires_smoke: number;
  retire_on_misses: number | null;
}

export interface BeeSegmentRefRow {
  id: number;
  release_id: number;
  segment_name: string;
  inputs_json: string | null;
  outputs_json: string | null;
  side_effects: string | null;
}

export interface BeeFileRow {
  id: number;
  release_id: number;
  owner_kind: "bee" | "segment";
  owner_name: string;
  path: string;
  kind: "markdown" | "script" | "reference" | "binary" | "other";
  size_bytes: number;
  sha256: string;
  blob_path: string;
}

export interface BeeChangeRow {
  id: number;
  release_id: number;
  change_kind: string;
  target_kind: string;
  target_name: string;
  detail: string | null;
}

/**
 * Shape of `manifest.json` inside a release export tarball.
 *
 * Producer: `src/services/skillhub/release-export.ts` writes this file via
 *   `JSON.stringify({ bee_name, version, manifestRows, segRows, fileRows, changeRows })`.
 * Consumer: `src/services/skillhub/release-import.ts` parses it back with
 *   `JSON.parse(readFileSync(join(stageDir, "manifest.json"), "utf-8"))`.
 *
 * Defining it once here (rather than as an inline anonymous type at the
 * call-site) lets both sides share a structural contract. If a future
 * field is added — e.g. an exported schema-version stamp — it lands in
 * one place and TypeScript flags every consumer that needs updating.
 */
export interface ExportPayload {
  bee_name: string;
  version: string;
  manifestRows: Array<{
    schema_version: string;
    description: string;
    segments_json: string;
    entrypoint_preamble: string | null;
    promotion: string;
    min_cycles: number | null;
    requires_human: number;
    requires_smoke: number;
    retire_on_misses: number | null;
  }>;
  segRows: Array<{
    segment_name: string;
    inputs_json: string | null;
    outputs_json: string | null;
    side_effects: string | null;
  }>;
  fileRows: Array<{
    owner_kind: string;
    owner_name: string;
    path: string;
    kind: string;
    size_bytes: number;
    sha256: string;
    blob_path: string;
  }>;
  changeRows: Array<{
    change_kind: string;
    target_kind: string;
    target_name: string;
    detail: string | null;
  }>;
}

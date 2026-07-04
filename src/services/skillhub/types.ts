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
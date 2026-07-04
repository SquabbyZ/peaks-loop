-- 001-initial.sql: spec §3.3.1 — decomposed 6-table schema.
-- Manifest fields are first-class columns. Files are content-addressed in `blobs/` sidecar (not in this DB).

CREATE TABLE IF NOT EXISTS bee_release (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  bee_name        TEXT NOT NULL,
  version         TEXT NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('user')),
  archived_at     TEXT NOT NULL,
  archived_by     TEXT NOT NULL,
  user_intent_raw TEXT,
  description     TEXT,
  parent_version  TEXT,
  changelog       TEXT,
  UNIQUE(bee_name, version)
);

CREATE TABLE IF NOT EXISTS bee_release_pointer (
  bee_name        TEXT PRIMARY KEY,
  latest_version  TEXT NOT NULL,
  released_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bee_manifest (
  release_id          INTEGER PRIMARY KEY REFERENCES bee_release(id) ON DELETE CASCADE,
  schema_version      TEXT NOT NULL,
  description         TEXT NOT NULL,
  segments_json       TEXT NOT NULL,        -- segment NAMES only; small JSON array
  entrypoint_preamble TEXT,
  promotion           TEXT NOT NULL,
  min_cycles          INTEGER,
  requires_human      INTEGER NOT NULL,
  requires_smoke      INTEGER NOT NULL,
  retire_on_misses    INTEGER
);

CREATE TABLE IF NOT EXISTS bee_segment_ref (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id      INTEGER NOT NULL REFERENCES bee_release(id) ON DELETE CASCADE,
  segment_name    TEXT NOT NULL,
  inputs_json     TEXT,
  outputs_json    TEXT,
  side_effects    TEXT,
  UNIQUE(release_id, segment_name)
);

CREATE TABLE IF NOT EXISTS bee_file (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id      INTEGER NOT NULL REFERENCES bee_release(id) ON DELETE CASCADE,
  owner_kind      TEXT NOT NULL CHECK (owner_kind IN ('bee','segment')),
  owner_name      TEXT NOT NULL,
  path            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('markdown','script','reference','binary','other')),
  size_bytes      INTEGER NOT NULL,
  sha256          TEXT NOT NULL,
  blob_path       TEXT NOT NULL,
  UNIQUE(release_id, owner_kind, owner_name, path)
);

CREATE TABLE IF NOT EXISTS bee_change (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id      INTEGER NOT NULL REFERENCES bee_release(id) ON DELETE CASCADE,
  change_kind     TEXT NOT NULL,
  target_kind     TEXT NOT NULL,
  target_name     TEXT NOT NULL,
  detail          TEXT
);

CREATE INDEX IF NOT EXISTS idx_bee_release_name_archived_at ON bee_release(bee_name, archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_bee_segment_ref_release ON bee_segment_ref(release_id);
CREATE INDEX IF NOT EXISTS idx_bee_file_release_owner ON bee_file(release_id, owner_kind, owner_name);
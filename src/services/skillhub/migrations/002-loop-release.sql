-- 002-loop-release.sql — M1 / spec §4.1 / §7.2
-- Adds the `loop_release` table for the Loop Engineering Asset layer.
-- Non-breaking: this migration does NOT touch any 4.x `bee_release`
-- column. The new table lives alongside the existing 6-table skillhub
-- schema (see 001-initial.sql). Indexes:
--   - lifecycle_status: for `peaks loop list --status <status>` filters.
--   - scenario:         for `peaks loop search --query <q>` (LIKE-based
--                       full-text in M1; FTS5 promotion deferred to a
--                       later slice).
-- Schema versioning: every new table carries `schema_version`.

CREATE TABLE IF NOT EXISTS loop_release (
  id                       TEXT PRIMARY KEY,
  name                     TEXT NOT NULL,
  scenario                 TEXT NOT NULL,
  trigger_policy           TEXT NOT NULL,
  success_criteria_json    TEXT NOT NULL,   -- JSON array of strings
  interaction_policy       TEXT NOT NULL,
  feedback_policy          TEXT NOT NULL,
  evolution_policy         TEXT NOT NULL,
  evaluator_policy_json    TEXT NOT NULL,   -- JSON array of strings
  linked_bees_json         TEXT NOT NULL DEFAULT '[]',
  run_history_json         TEXT NOT NULL DEFAULT '[]',
  crystallization_evidence_json TEXT NOT NULL DEFAULT '[]',
  lifecycle_status         TEXT NOT NULL CHECK (lifecycle_status IN ('candidate','stable','retired')),
  version                  TEXT NOT NULL,
  schema_version           TEXT NOT NULL CHECK (schema_version = 'peaks.loop/1'),
  archived_at              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_loop_release_lifecycle_status ON loop_release(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_loop_release_scenario ON loop_release(scenario);
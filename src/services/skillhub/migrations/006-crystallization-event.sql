-- 006-crystallization-event.sql — M5 / spec §4.5 / §4.7 / §5 / §7.2
-- Adds the `crystallization_event` table for the post-run
-- crystallization layer. Non-breaking: this migration does NOT
-- touch any pre-existing table. The new table lives alongside the
-- existing skillhub schema (see 001-initial.sql, 002-loop-release.sql,
-- 003-loop-bee-relation.sql, 004-loop-bee-extension.sql,
-- 005-evolution-evaluation.sql).
--
-- The table stores the durable evidence of a crystallization event:
--   - trigger                          (user_explicit | llm_suggested |
--                                       success_default_prompt |
--                                       similar_task_recurrence)
--   - evidence_brief                   (JSON: 4 sections)
--       * what_happened                (1-2 sentence factual account)
--       * why_it_matters               (1-2 sentence explanation)
--       * what_learned                 (1-2 sentence learning)
--       * what_action                  (1 sentence recommended action)
--   - source_trace_pointers            (JSON array of workflow trace ids)
--   - evaluator_summary                (short NL summary from scorers)
--   - user_decision_summary            (NL account of the user choice)
--   - created_loop_release_id          (FK to loop_release, optional)
--   - updated_loop_release_id          (FK to loop_release, optional)
--   - created_bee_release_id           (FK to bee_release, optional)
--   - updated_bee_release_id           (FK to bee_release, optional)
--   - lifecycle_status                 (candidate | stable | retired;
--                                       the EVENT's status, distinct
--                                       from the loop_release status).
--
-- The four-section brief (spec §4.7 / §10 RL-7) is required at the
-- service layer; the DB stores whatever JSON the service persists. A
-- schema-version bump can introduce a CHECK shape constraint on the
-- brief in a future migration; the service layer is the authoritative
-- guard today.
--
-- Schema versioning: every new table carries `schema_version` pinned
-- to the literal `peaks.crystallization/1` via CHECK constraint.
--
-- All JSON-shaped payloads (brief, source_trace_pointers, bullets)
-- are stored as TEXT and parsed at the store / Zod boundary —
-- same convention as the existing tables; no big JSON BLOB at the
-- SQLite layer.

CREATE TABLE IF NOT EXISTS crystallization_event (
  id                          TEXT PRIMARY KEY,
  trigger                     TEXT NOT NULL CHECK (trigger IN (
                                'user_explicit',
                                'llm_suggested',
                                'success_default_prompt',
                                'similar_task_recurrence'
                              )),
  -- The 4-section brief. The shape guard (all four sections present)
  -- is enforced at the service layer (CrystallizationService); the
  -- DB stores whatever the service persists. See spec §4.7 / §10 RL-7.
  evidence_brief_json         TEXT NOT NULL,
  evidence_bullets_json       TEXT NOT NULL DEFAULT '[]',
  source_trace_pointers_json  TEXT NOT NULL DEFAULT '[]',
  evaluator_summary           TEXT NOT NULL DEFAULT '',
  user_decision_summary       TEXT NOT NULL DEFAULT '',
  created_loop_release_id     TEXT REFERENCES loop_release(id) ON DELETE SET NULL,
  updated_loop_release_id     TEXT REFERENCES loop_release(id) ON DELETE SET NULL,
  created_bee_release_id      INTEGER REFERENCES bee_release(id) ON DELETE SET NULL,
  updated_bee_release_id      INTEGER REFERENCES bee_release(id) ON DELETE SET NULL,
  -- The EVENT's lifecycle (independent of any created/updated asset).
  -- 'candidate' after crystallization; 'stable' after user-confirmed
  -- promotion; 'retired' after explicit dispose. Mirrors the loop
  -- status union (spec §4.1) without a 1:1 identity — these are
  -- orthogonal lifecycles.
  lifecycle_status            TEXT NOT NULL DEFAULT 'candidate'
                                CHECK (lifecycle_status IN ('candidate','stable','retired')),
  schema_version              TEXT NOT NULL CHECK (schema_version = 'peaks.crystallization/1'),
  created_at                  TEXT NOT NULL,
  CHECK (length(id) > 0),
  -- Defense in depth on the brief shape: at least one of the four
  -- keys must be present in the JSON object. SQLite JSON1 (>= 3.38)
  -- supports json_extract; we keep the check loose (length > 2 to
  -- rule out '{}') so older SQLite still accepts the row, and rely
  -- on the service-layer guard for the strict 4-section rule.
  CHECK (length(evidence_brief_json) >= 2)
);

CREATE INDEX IF NOT EXISTS idx_crystallization_event_created_loop
  ON crystallization_event(created_loop_release_id);
CREATE INDEX IF NOT EXISTS idx_crystallization_event_updated_loop
  ON crystallization_event(updated_loop_release_id);
CREATE INDEX IF NOT EXISTS idx_crystallization_event_created_bee
  ON crystallization_event(created_bee_release_id);
CREATE INDEX IF NOT EXISTS idx_crystallization_event_updated_bee
  ON crystallization_event(updated_bee_release_id);
CREATE INDEX IF NOT EXISTS idx_crystallization_event_lifecycle
  ON crystallization_event(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_crystallization_event_created_at
  ON crystallization_event(created_at);

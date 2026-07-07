-- 003-loop-bee-relation.sql — M2 / spec §4.6 / §7.2
-- Adds the `loop_bee_relation` table for the Loop↔Bee coupling layer.
-- Non-breaking: this migration does NOT touch any 4.x `bee_release`
-- column. The new table lives alongside the existing skillhub schema
-- (see 001-initial.sql, 002-loop-release.sql).
--
-- Constraints:
--   - FK to loop_release(id) and bee_release(id) — referential integrity.
--   - UNIQUE(loop_release_id, bee_release_id) — no duplicate relations.
--   - Partial UNIQUE index WHERE role='main' — at most one main bee per
--     loop at the storage layer (defense in depth; the service layer
--     adds a friendlier error path).
--   - role CHECK constraint enforces the four-value union.
--   - schema_version column carries 'peaks.loop-bee-relation/1'.
--
-- The "no relation to a retired loop" rule is NOT a DB-level constraint
-- (cross-table policy; needs richer error reporting). It is enforced in
-- the LoopBeeRelationService layer.

CREATE TABLE IF NOT EXISTS loop_bee_relation (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  loop_release_id   TEXT NOT NULL REFERENCES loop_release(id) ON DELETE CASCADE,
  bee_release_id    INTEGER NOT NULL REFERENCES bee_release(id) ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN ('main','supporting','candidate','retired')),
  reason            TEXT NOT NULL,
  schema_version    TEXT NOT NULL CHECK (schema_version = 'peaks.loop-bee-relation/1'),
  created_at        TEXT NOT NULL,
  UNIQUE(loop_release_id, bee_release_id)
);

CREATE INDEX IF NOT EXISTS idx_loop_bee_relation_loop_id ON loop_bee_relation(loop_release_id);
CREATE INDEX IF NOT EXISTS idx_loop_bee_relation_bee_id ON loop_bee_relation(bee_release_id);
CREATE INDEX IF NOT EXISTS idx_loop_bee_relation_loop_role ON loop_bee_relation(loop_release_id, role);
CREATE UNIQUE INDEX IF NOT EXISTS idx_loop_bee_relation_one_main_per_loop
  ON loop_bee_relation(loop_release_id) WHERE role = 'main';
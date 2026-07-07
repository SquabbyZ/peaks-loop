-- 005-evolution-evaluation.sql — M4 / spec §4.4 / §6
-- Adds the `evolution_evaluation` table for the Darwin-style ratchet
-- evaluation layer. Non-breaking: this migration does NOT touch any
-- pre-existing table. The new table lives alongside the existing
-- skillhub schema (see 001-initial.sql, 002-loop-release.sql,
-- 003-loop-bee-relation.sql, 004-loop-bee-extension.sql).
--
-- The table stores the durable evidence of an evolution round:
--   - target_kind / target_release_id / single_optimization_dimension
--     (AC-8: single editable asset + single dimension per round).
--   - before_score / after_score / score_delta_min / score_delta
--     (AC-11: numeric delta; promotion blocked when delta < delta_min).
--   - author_id / evaluator_id / skeptic_id
--     (AC-10: author != scorer; the regression skeptic is a SEPARATE
--     agent, not the same as the independent evaluator).
--   - verdict (keep / revert / needs-user-decision).
--   - user_confirmation_pointer / brief_pointer
--     (spec §4.4: pointers, not inlined big JSON BLOBs).
--
-- Schema versioning: every new table carries `schema_version`
-- pinned to the literal `peaks.evolution/1` via CHECK constraint.
--
-- All JSON-shaped payloads (diff, brief_pointer, source_traces_json)
-- are stored as TEXT and parsed at the store / Zod boundary — same
-- convention as the existing tables; no big JSON BLOB at the SQLite
-- layer.

CREATE TABLE IF NOT EXISTS evolution_evaluation (
  id                          TEXT PRIMARY KEY,
  target_kind                 TEXT NOT NULL CHECK (target_kind IN ('loop','bee','policy','gate','evaluator')),
  target_release_id           TEXT NOT NULL,
  -- The M4 spec requires exactly one optimization dimension per round.
  -- The TEXT column carries the dimension name; the service layer
  -- (EvolutionService) enforces `dimensions.length === 1` on input.
  -- A JSON array is used here only so future schema versions can
  -- relax the single-dimension rule without a column-rename
  -- migration; for now the array is always exactly length 1.
  optimization_dimensions_json TEXT NOT NULL,
  -- AC-8: target_count must be exactly 1. Stored as INTEGER for
  -- explicit service-layer enforcement; CHECK pins it to 1 in this
  -- schema version (a future multi-target table would relax this).
  target_count                INTEGER NOT NULL DEFAULT 1 CHECK (target_count = 1),
  before_snapshot_json        TEXT NOT NULL DEFAULT '{}',
  after_snapshot_json         TEXT NOT NULL DEFAULT '{}',
  diff_json                   TEXT NOT NULL DEFAULT '{}',
  before_score                REAL NOT NULL,
  after_score                 REAL NOT NULL,
  score_delta_min             REAL NOT NULL DEFAULT 1.0 CHECK (score_delta_min >= 0),
  score_delta                 REAL NOT NULL,
  author_id                   TEXT NOT NULL,
  evaluator_id                TEXT NOT NULL,
  skeptic_id                  TEXT NOT NULL,
  -- Verdict is the FINAL aggregation result; `needs-user-decision`
  -- is the default after the scoring + skeptic step.
  verdict                     TEXT NOT NULL CHECK (verdict IN ('keep','revert','needs-user-decision')),
  -- Pointer columns (NOT inlined JSON): user_confirmation_pointer and
  -- brief_pointer are spec §4.4 fields. We keep them as TEXT paths /
  -- ids so the table stays small and queryable.
  user_confirmation_pointer   TEXT,
  brief_pointer               TEXT,
  -- Audit columns: rubric + red_lines + source_traces are
  -- JSON-encoded TEXT — same convention as the other tables.
  rubric_json                 TEXT NOT NULL DEFAULT '{}',
  red_lines_json              TEXT NOT NULL DEFAULT '[]',
  source_traces_json          TEXT NOT NULL DEFAULT '[]',
  schema_version              TEXT NOT NULL CHECK (schema_version = 'peaks.evolution/1'),
  created_at                  TEXT NOT NULL,
  -- Defense in depth: the author MUST NOT equal the evaluator.
  -- Cross-column CHECK rejected by older SQLite versions; we let the
  -- service layer enforce this so the constraint stays portable.
  CHECK (length(id) > 0)
);

CREATE INDEX IF NOT EXISTS idx_evolution_evaluation_target
  ON evolution_evaluation(target_kind, target_release_id);
CREATE INDEX IF NOT EXISTS idx_evolution_evaluation_verdict
  ON evolution_evaluation(verdict);
CREATE INDEX IF NOT EXISTS idx_evolution_evaluation_author
  ON evolution_evaluation(author_id);
CREATE INDEX IF NOT EXISTS idx_evolution_evaluation_evaluator
  ON evolution_evaluation(evaluator_id);

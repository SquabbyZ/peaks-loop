/**
 * Slice `b1-filesplit-campaign` (wave 3) — verbatim extraction of the
 * `evolution_evaluation` storage CONTRACT (the DDL, the schema-version stamp and
 * the persisted row shape) out of `./evolution-store.ts` so that module clears
 * the 300 raw-line cap. Every declaration is a local of the store — none is
 * part of its exported surface — so importers are untouched and nothing is
 * re-exported. No byte of the DDL changed: `ensureEvolutionEvaluationTable`
 * still execs exactly these statements.
 */
import type { EvolutionTargetKind, EvolutionVerdict } from './evolution-types.js';

export const SCHEMA_VERSION = 'peaks.evolution/1' as const;

/**
 * The `evolution_evaluation` table + its four indexes, as one idempotent
 * script (CREATE TABLE / CREATE INDEX IF NOT EXISTS). Re-applied by
 * `ensureEvolutionEvaluationTable` for callers that pass a database they built
 * themselves (e.g. tests).
 */
export const EVOLUTION_EVALUATION_MIGRATION = `
    CREATE TABLE IF NOT EXISTS evolution_evaluation (
      id                          TEXT PRIMARY KEY,
      target_kind                 TEXT NOT NULL CHECK (target_kind IN ('loop','bee','policy','gate','evaluator')),
      target_release_id           TEXT NOT NULL,
      optimization_dimensions_json TEXT NOT NULL,
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
      verdict                     TEXT NOT NULL CHECK (verdict IN ('keep','revert','needs-user-decision')),
      user_confirmation_pointer   TEXT,
      brief_pointer               TEXT,
      rubric_json                 TEXT NOT NULL DEFAULT '{}',
      red_lines_json              TEXT NOT NULL DEFAULT '[]',
      source_traces_json          TEXT NOT NULL DEFAULT '[]',
      schema_version              TEXT NOT NULL CHECK (schema_version = 'peaks.evolution/1'),
      created_at                  TEXT NOT NULL,
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
  `;

export interface EvolutionEvaluationRow {
  id: string;
  target_kind: EvolutionTargetKind;
  target_release_id: string;
  optimization_dimensions_json: string;
  target_count: 1;
  before_snapshot_json: string;
  after_snapshot_json: string;
  diff_json: string;
  before_score: number;
  after_score: number;
  score_delta_min: number;
  score_delta: number;
  author_id: string;
  evaluator_id: string;
  skeptic_id: string;
  verdict: EvolutionVerdict;
  user_confirmation_pointer: string | null;
  brief_pointer: string | null;
  rubric_json: string;
  red_lines_json: string;
  source_traces_json: string;
  schema_version: 'peaks.evolution/1';
  created_at: string;
}

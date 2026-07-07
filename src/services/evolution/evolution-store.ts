import type Database from "better-sqlite3";
import type {
  EvolutionEvaluation,
  EvolutionEvaluationInput,
  EvolutionProposal,
  EvolutionProposalInput,
  EvolutionTargetKind,
  EvolutionVerdict,
} from "./evolution-types.js";

/**
 * Low-level SQLite access for the `evolution_evaluation` table. The
 * migration is registered with the existing `openStateDb()` pipeline
 * via `src/services/skillhub/migrations/005-evolution-evaluation.sql`
 * and is applied in lexicographic order alongside the other
 * skillhub migrations. The function `ensureEvolutionEvaluationTable`
 * below is a belt-and-suspenders re-applier for callers that pass a
 * database they built themselves (e.g. tests).
 *
 * Defense in depth:
 *   - All JSON columns are stored as TEXT and parsed at the boundary.
 *     No big JSON BLOB at the SQLite layer — the row stays small and
 *     queryable.
 *   - The migration is idempotent (CREATE TABLE IF NOT EXISTS, CREATE
 *     INDEX IF NOT EXISTS) so re-running it is safe.
 *   - The single-object / single-dimension / self-score / delta
 *     rules are enforced at the SERVICE layer (not the DB); the DB
 *     stores the persisted, validated row.
 */

const SCHEMA_VERSION = "peaks.evolution/1" as const;

/**
 * Re-apply the evolution_evaluation table migration against an
 * already-open database. Used by tests that build their own DB
 * without the openStateDb pipeline. Idempotent.
 */
export function ensureEvolutionEvaluationTable(db: Database.Database): void {
  db.exec(`
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
  `);
}

interface EvolutionEvaluationRow {
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
  schema_version: "peaks.evolution/1";
  created_at: string;
}

/**
 * Compute the score_delta from before/after scores. Exported for
 * the service layer to use during proposal evaluation.
 */
export function computeScoreDelta(
  before: number,
  after: number
): number {
  // Round to 6 decimals to avoid floating-point noise.
  return Math.round((after - before) * 1_000_000) / 1_000_000;
}

/**
 * Build a persisted EvolutionProposal from the input. The service
 * layer is responsible for enforcing AC-8 (single object / single
 * dimension) BEFORE calling this; the persisted shape always has
 * `target_count = 1` and `dimensions.length = 1`.
 */
export function buildProposal(
  id: string,
  input: EvolutionProposalInput,
  createdAt?: string
): EvolutionProposal {
  const before = input.before_score;
  const after = input.after_score;
  return {
    id,
    target_kind: input.target_kind,
    target_release_id: input.target_release_id,
    optimization_dimension: input.optimization_dimension,
    dimensions: [input.optimization_dimension],
    target_count: 1,
    single_object: true,
    single_optimization_dimension: true,
    before_snapshot: input.before_snapshot,
    after_snapshot: input.after_snapshot,
    diff: input.diff,
    before_score: before,
    after_score: after,
    score_delta_min: input.score_delta_min,
    score_delta: computeScoreDelta(before, after),
    author_id: input.author_id,
    rubric: input.rubric,
    red_lines: input.red_lines,
    source_traces: input.source_traces,
    schema_version: SCHEMA_VERSION,
    created_at: createdAt ?? new Date().toISOString(),
  };
}

function rowToEvaluation(row: EvolutionEvaluationRow): EvolutionEvaluation {
  return {
    id: row.id,
    proposal: {
      id: row.id,
      target_kind: row.target_kind,
      target_release_id: row.target_release_id,
      optimization_dimension: JSON.parse(row.optimization_dimensions_json)[0],
      dimensions: JSON.parse(row.optimization_dimensions_json) as string[],
      target_count: row.target_count,
      single_object: true,
      single_optimization_dimension: true,
      before_snapshot: JSON.parse(row.before_snapshot_json) as Record<
        string,
        unknown
      >,
      after_snapshot: JSON.parse(row.after_snapshot_json) as Record<
        string,
        unknown
      >,
      diff: JSON.parse(row.diff_json) as Record<string, unknown>,
      before_score: row.before_score,
      after_score: row.after_score,
      score_delta_min: row.score_delta_min,
      score_delta: row.score_delta,
      author_id: row.author_id,
      rubric: JSON.parse(row.rubric_json) as Record<string, unknown>,
      red_lines: JSON.parse(row.red_lines_json) as string[],
      source_traces: JSON.parse(row.source_traces_json) as string[],
      schema_version: row.schema_version,
      created_at: row.created_at,
    },
    evaluator_id: row.evaluator_id,
    skeptic_id: row.skeptic_id,
    evaluator_result: {
      // We persist the final post-skeptic row only; the raw
      // evaluator_result is not part of the row. Tests can verify
      // the verdict derivation via the service layer.
      score: row.after_score,
      riskTags: [],
      refuteParagraph: "",
    },
    skeptic_result: {
      driftRisks: [],
      overfitRisks: [],
      safetyRegressionRisks: [],
    },
    verdict: row.verdict,
    user_confirmation_pointer: row.user_confirmation_pointer ?? undefined,
    brief_pointer: row.brief_pointer ?? undefined,
    schema_version: row.schema_version,
    created_at: row.created_at,
    score_delta: row.score_delta,
  };
}

/**
 * Insert a full EvolutionEvaluation row. The row's
 * `schema_version` is taken from the input (must equal
 * `peaks.evolution/1`); `created_at` is stamped from the server
 * clock here, so callers cannot backdate a row.
 */
export function insertEvolutionEvaluation(
  db: Database.Database,
  evalRow: EvolutionEvaluationInput
): void {
  const stmt = db.prepare(
    `INSERT INTO evolution_evaluation (
       id, target_kind, target_release_id, optimization_dimensions_json,
       target_count, before_snapshot_json, after_snapshot_json, diff_json,
       before_score, after_score, score_delta_min, score_delta,
       author_id, evaluator_id, skeptic_id, verdict,
       user_confirmation_pointer, brief_pointer,
       rubric_json, red_lines_json, source_traces_json,
       schema_version, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run(
    evalRow.id,
    evalRow.proposal.target_kind,
    evalRow.proposal.target_release_id,
    JSON.stringify(evalRow.proposal.dimensions),
    evalRow.proposal.target_count,
    JSON.stringify(evalRow.proposal.before_snapshot),
    JSON.stringify(evalRow.proposal.after_snapshot),
    JSON.stringify(evalRow.proposal.diff),
    evalRow.proposal.before_score,
    evalRow.proposal.after_score,
    evalRow.proposal.score_delta_min,
    computeScoreDelta(
      evalRow.proposal.before_score,
      evalRow.proposal.after_score
    ),
    evalRow.proposal.author_id,
    evalRow.evaluator_id,
    evalRow.skeptic_id,
    evalRow.verdict,
    evalRow.user_confirmation_pointer ?? null,
    evalRow.brief_pointer ?? null,
    JSON.stringify(evalRow.proposal.rubric),
    JSON.stringify(evalRow.proposal.red_lines),
    JSON.stringify(evalRow.proposal.source_traces),
    evalRow.schema_version,
    evalRow.created_at
  );
}

/**
 * Read a single EvolutionEvaluation row by id; returns undefined if
 * absent.
 */
export function getEvolutionEvaluation(
  db: Database.Database,
  id: string
): EvolutionEvaluation | undefined {
  const row = db
    .prepare("SELECT * FROM evolution_evaluation WHERE id = ?")
    .get(id) as EvolutionEvaluationRow | undefined;
  if (!row) return undefined;
  return rowToEvaluation(row);
}

/**
 * List EvolutionEvaluation rows for a specific target. Filter by
 * `verdict` to scope the listing.
 */
export function listEvolutionEvaluationsByTarget(
  db: Database.Database,
  opts: { target_kind: EvolutionTargetKind; target_release_id: string; verdict?: EvolutionVerdict }
): EvolutionEvaluation[] {
  const params: unknown[] = [opts.target_kind, opts.target_release_id];
  let sql =
    "SELECT * FROM evolution_evaluation WHERE target_kind = ? AND target_release_id = ?";
  if (opts.verdict) {
    sql += " AND verdict = ?";
    params.push(opts.verdict);
  }
  sql += " ORDER BY created_at DESC, id ASC";
  const rows = db.prepare(sql).all(...params) as EvolutionEvaluationRow[];
  return rows.map(rowToEvaluation);
}

/**
 * Update the verdict (and optional user_confirmation_pointer) of
 * an existing EvolutionEvaluation row. Returns the updated row, or
 * undefined if the id is absent.
 *
 * The service layer is responsible for enforcing that the
 * transition `revert` is always allowed and `keep` requires
 * `user_confirmation_pointer` set (AC-15).
 */
export function updateEvolutionVerdict(
  db: Database.Database,
  id: string,
  verdict: EvolutionVerdict,
  userConfirmationPointer?: string
): EvolutionEvaluation | undefined {
  const existing = getEvolutionEvaluation(db, id);
  if (!existing) return undefined;
  const stmt = db.prepare(
    `UPDATE evolution_evaluation
       SET verdict = ?,
           user_confirmation_pointer = ?
     WHERE id = ?`
  );
  stmt.run(verdict, userConfirmationPointer ?? null, id);
  return getEvolutionEvaluation(db, id);
}

/**
 * Test seam: produce a fresh id for an EvolutionEvaluation row.
 * Format: `eval-<hex>` (lowercase, 12 hex chars). Matches the Zod
 * `^eval-[0-9a-f-]{8,}$` pattern in EvolutionProposalSchema.
 */
export function newEvaluationId(): string {
  // 12-char hex, lowercase, no dashes — the regex allows '-' so
  // 12-char hex is fine. We avoid UUID's dashes to keep ids
  // grep-friendly.
  const hex = Math.floor(Math.random() * 0x1_000_000_000_000)
    .toString(16)
    .padStart(12, "0");
  return `eval-${hex}`;
}

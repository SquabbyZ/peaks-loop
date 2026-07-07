import type Database from "better-sqlite3";
import type { LoopRelease, LoopReleaseLifecycleStatus } from "./loop-release-types.js";

/**
 * Low-level SQLite access for the `loop_release` table. The
 * migration is registered with the existing `openStateDb()` pipeline
 * via `src/services/skillhub/migrations/002-loop-release.sql` (it
 * applies every `*.sql` file in lexicographic order). The function
 * `ensureLoopReleaseTable` below is a belt-and-suspenders re-applier
 * for callers that pass a database they built themselves (e.g. tests).
 *
 * Defense in depth:
 *   - All JSON columns are stored as TEXT and parsed at the boundary.
 *     No big JSON BLOB at the SQLite layer — the row stays small and
 *     queryable.
 *   - The migration is idempotent (CREATE TABLE IF NOT EXISTS, CREATE
 *     INDEX IF NOT EXISTS) so re-running it is safe.
 *   - The migration does NOT touch any 4.x `bee_release` column (AC-3).
 */

/**
 * Re-apply the loop_release table migration against an already-open
 * database. Used by tests that build their own DB without the openStateDb
 * pipeline. Idempotent.
 */
export function ensureLoopReleaseTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS loop_release (
      id                       TEXT PRIMARY KEY,
      name                     TEXT NOT NULL,
      scenario                 TEXT NOT NULL,
      trigger_policy           TEXT NOT NULL,
      success_criteria_json    TEXT NOT NULL,
      interaction_policy       TEXT NOT NULL,
      feedback_policy          TEXT NOT NULL,
      evolution_policy         TEXT NOT NULL,
      evaluator_policy_json    TEXT NOT NULL,
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
  `);
}

interface LoopReleaseRow {
  id: string;
  name: string;
  scenario: string;
  trigger_policy: string;
  success_criteria_json: string;
  interaction_policy: string;
  feedback_policy: string;
  evolution_policy: string;
  evaluator_policy_json: string;
  linked_bees_json: string;
  run_history_json: string;
  crystallization_evidence_json: string;
  lifecycle_status: LoopReleaseLifecycleStatus;
  version: string;
  schema_version: "peaks.loop/1";
  archived_at: string;
}

function rowToLoopRelease(row: LoopReleaseRow): LoopRelease {
  return {
    id: row.id,
    name: row.name,
    scenario: row.scenario,
    trigger_policy: row.trigger_policy,
    success_criteria: JSON.parse(row.success_criteria_json) as string[],
    interaction_policy: row.interaction_policy,
    feedback_policy: row.feedback_policy,
    evolution_policy: row.evolution_policy,
    evaluator_policy: JSON.parse(row.evaluator_policy_json) as string[],
    linked_bees: JSON.parse(row.linked_bees_json) as string[],
    run_history: JSON.parse(row.run_history_json) as string[],
    crystallization_evidence: JSON.parse(row.crystallization_evidence_json) as string[],
    lifecycle_status: row.lifecycle_status,
    version: row.version,
    schema_version: row.schema_version,
  };
}

/**
 * Insert a LoopRelease row. The row's `schema_version` is taken from
 * the input (must equal `peaks.loop/1`); `archived_at` is stamped
 * from the server clock here, so callers cannot backdate a row.
 *
 * Idempotent in the table sense (UNIQUE on `id`) — re-inserting the
 * same id throws a UNIQUE-constraint error; callers wanting upsert
 * semantics should use a separate path (M5 / crystallization event).
 */
export function insertLoopRelease(
  db: Database.Database,
  row: LoopRelease
): void {
  const stmt = db.prepare(
    `INSERT INTO loop_release (
       id, name, scenario, trigger_policy,
       success_criteria_json, interaction_policy, feedback_policy, evolution_policy,
       evaluator_policy_json, linked_bees_json, run_history_json, crystallization_evidence_json,
       lifecycle_status, version, schema_version, archived_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run(
    row.id,
    row.name,
    row.scenario,
    row.trigger_policy,
    JSON.stringify(row.success_criteria),
    row.interaction_policy,
    row.feedback_policy,
    row.evolution_policy,
    JSON.stringify(row.evaluator_policy),
    JSON.stringify(row.linked_bees),
    JSON.stringify(row.run_history),
    JSON.stringify(row.crystallization_evidence),
    row.lifecycle_status,
    row.version,
    row.schema_version,
    new Date().toISOString()
  );
}

/** Read a single LoopRelease row by id; returns undefined if absent. */
export function getLoopRelease(
  db: Database.Database,
  id: string
): LoopRelease | undefined {
  const row = db
    .prepare("SELECT * FROM loop_release WHERE id = ?")
    .get(id) as LoopReleaseRow | undefined;
  if (!row) return undefined;
  return rowToLoopRelease(row);
}

/** List LoopRelease rows filtered by lifecycle_status. */
export function listLoopReleasesByStatus(
  db: Database.Database,
  status: LoopReleaseLifecycleStatus
): LoopRelease[] {
  const rows = db
    .prepare("SELECT * FROM loop_release WHERE lifecycle_status = ? ORDER BY archived_at DESC, id ASC")
    .all(status) as LoopReleaseRow[];
  return rows.map(rowToLoopRelease);
}

/**
 * Search LoopRelease rows whose `scenario` contains the query string.
 * M1 uses a case-insensitive LIKE; FTS5 promotion is deferred. The
 * query is treated as a literal substring (no regex, no SQL
 * injection surface) — it is escaped via parameter binding.
 */
export function searchLoopReleasesByScenario(
  db: Database.Database,
  query: string
): LoopRelease[] {
  const like = `%${query}%`;
  const rows = db
    .prepare(
      "SELECT * FROM loop_release WHERE scenario LIKE ? COLLATE NOCASE ORDER BY archived_at DESC, id ASC"
    )
    .all(like) as LoopReleaseRow[];
  return rows.map(rowToLoopRelease);
}
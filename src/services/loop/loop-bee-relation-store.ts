import type Database from "better-sqlite3";
import type {
  LoopBeeRelation,
  LoopBeeRelationRole,
} from "./loop-bee-relation-types.js";

/**
 * Low-level SQLite access for the `loop_bee_relation` table. The
 * migration is registered with the existing `openStateDb()` pipeline
 * via `src/services/skillhub/migrations/003-loop-bee-relation.sql`
 * (it applies every `*.sql` file in lexicographic order). The function
 * `ensureLoopBeeRelationTable` below is a belt-and-suspenders re-applier
 * for callers that pass a database they built themselves (e.g. tests).
 *
 * Defense in depth:
 *   - FK constraints enforce loop_release and bee_release referential
 *     integrity (better-sqlite3 + foreign_keys = ON).
 *   - Partial unique index `WHERE role = 'main'` enforces "at most one
 *     main bee per loop" at the storage layer (the service layer adds
 *     a friendlier error path on top).
 *   - UNIQUE (loop_release_id, bee_release_id) prevents accidental
 *     duplicate relations between the same loop and same bee release.
 *   - The migration does NOT touch any 4.x `bee_release` column (AC-3).
 *   - Lifecycle_status check on loop_release is NOT a DB-level constraint
 *     (the retirement rule is enforced in the service layer — see
 *     `LoopBeeRelationService.create`) so the DB stays decoupled from
 *     cross-table policies that need richer error reporting.
 */

/**
 * Re-apply the loop_bee_relation table migration against an already-open
 * database. Used by tests that build their own DB without the
 * openStateDb pipeline. Idempotent.
 */
export function ensureLoopBeeRelationTable(db: Database.Database): void {
  db.exec(`
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
    -- Partial unique index: at most one main bee per loop. SQLite supports
    -- partial indexes; this is the storage-level enforcement of the
    -- "exactly one main" invariant. Multiple supporting / candidate /
    -- retired rows per loop remain allowed.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_loop_bee_relation_one_main_per_loop
      ON loop_bee_relation(loop_release_id) WHERE role = 'main';
  `);
}

interface LoopBeeRelationRow {
  id: number;
  loop_release_id: string;
  bee_release_id: number;
  role: LoopBeeRelationRole;
  reason: string;
  schema_version: "peaks.loop-bee-relation/1";
  created_at: string;
}

function rowToLoopBeeRelation(row: LoopBeeRelationRow): LoopBeeRelation {
  return {
    id: row.id,
    loop_release_id: row.loop_release_id,
    bee_release_id: row.bee_release_id,
    role: row.role,
    reason: row.reason,
    schema_version: row.schema_version,
    created_at: row.created_at,
  };
}

/**
 * Insert a LoopBeeRelation row. The row's `schema_version` is taken from
 * the input (must equal `peaks.loop-bee-relation/1`); `id` and
 * `created_at` are stamped here, so callers cannot backdate a row.
 *
 * Idempotent in the UNIQUE sense — re-inserting the same
 * (loop_release_id, bee_release_id) pair throws a UNIQUE-constraint
 * error; inserting two `main` rows for the same loop throws a partial
 * unique index error.
 *
 * Returns the persisted row (with `id` filled in).
 */
export function insertLoopBeeRelation(
  db: Database.Database,
  row: Omit<LoopBeeRelation, "id" | "created_at">
): LoopBeeRelation {
  const createdAt = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO loop_bee_relation (
       loop_release_id, bee_release_id, role, reason, schema_version, created_at
     ) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(
    row.loop_release_id,
    row.bee_release_id,
    row.role,
    row.reason,
    row.schema_version,
    createdAt
  );
  return {
    id: Number(info.lastInsertRowid),
    loop_release_id: row.loop_release_id,
    bee_release_id: row.bee_release_id,
    role: row.role,
    reason: row.reason,
    schema_version: row.schema_version,
    created_at: createdAt,
  };
}

/** Read a single LoopBeeRelation row by id; returns undefined if absent. */
export function getLoopBeeRelation(
  db: Database.Database,
  id: number
): LoopBeeRelation | undefined {
  const row = db
    .prepare("SELECT * FROM loop_bee_relation WHERE id = ?")
    .get(id) as LoopBeeRelationRow | undefined;
  if (!row) return undefined;
  return rowToLoopBeeRelation(row);
}

/** List LoopBeeRelation rows for a given loop_release_id (optionally filtered by role). */
export function listLoopBeeRelationsByLoop(
  db: Database.Database,
  loop_release_id: string,
  role?: LoopBeeRelationRole
): LoopBeeRelation[] {
  const sql =
    role === undefined
      ? "SELECT * FROM loop_bee_relation WHERE loop_release_id = ? ORDER BY id ASC"
      : "SELECT * FROM loop_bee_relation WHERE loop_release_id = ? AND role = ? ORDER BY id ASC";
  const params = role === undefined ? [loop_release_id] : [loop_release_id, role];
  const rows = db.prepare(sql).all(...params) as LoopBeeRelationRow[];
  return rows.map(rowToLoopBeeRelation);
}

/** List LoopBeeRelation rows for a given bee_release_id (optionally filtered by role). */
export function listLoopBeeRelationsByBee(
  db: Database.Database,
  bee_release_id: number,
  role?: LoopBeeRelationRole
): LoopBeeRelation[] {
  const sql =
    role === undefined
      ? "SELECT * FROM loop_bee_relation WHERE bee_release_id = ? ORDER BY id ASC"
      : "SELECT * FROM loop_bee_relation WHERE bee_release_id = ? AND role = ? ORDER BY id ASC";
  const params = role === undefined ? [bee_release_id] : [bee_release_id, role];
  const rows = db.prepare(sql).all(...params) as LoopBeeRelationRow[];
  return rows.map(rowToLoopBeeRelation);
}

/** Update the role of an existing relation. Returns the new row, or undefined if absent. */
export function updateLoopBeeRelationRole(
  db: Database.Database,
  id: number,
  newRole: LoopBeeRelationRole
): LoopBeeRelation | undefined {
  const stmt = db.prepare(
    "UPDATE loop_bee_relation SET role = ? WHERE id = ?"
  );
  const info = stmt.run(newRole, id);
  if (info.changes === 0) return undefined;
  return getLoopBeeRelation(db, id);
}

/** Remove a LoopBeeRelation row by id. Returns true if a row was deleted. */
export function removeLoopBeeRelation(
  db: Database.Database,
  id: number
): boolean {
  const stmt = db.prepare("DELETE FROM loop_bee_relation WHERE id = ?");
  const info = stmt.run(id);
  return info.changes > 0;
}
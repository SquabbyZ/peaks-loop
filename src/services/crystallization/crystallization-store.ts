import type Database from "better-sqlite3";
import {
  CrystallizationEventSchema,
  type CrystallizationEvent,
  type CrystallizationEventInput,
  type CrystallizationEventStatus,
} from "./crystallization-types.js";

/**
 * Low-level SQLite access for the `crystallization_event` table.
 * The migration is registered with the existing `openStateDb()`
 * pipeline via
 * `src/services/skillhub/migrations/006-crystallization-event.sql`
 * and is applied in lexicographic order alongside the other
 * skillhub migrations. The function `ensureCrystallizationEventTable`
 * below is a belt-and-suspenders re-applier for callers that pass a
 * database they built themselves (e.g. tests).
 *
 * Defense in depth:
 *   - All JSON columns are stored as TEXT and parsed at the
 *     boundary. No big JSON BLOB at the SQLite layer — the row
 *     stays small and queryable.
 *   - The migration is idempotent (CREATE TABLE IF NOT EXISTS,
 *     CREATE INDEX IF NOT EXISTS) so re-running it is safe.
 *   - The 4-section brief guard and any other business rule is
 *     enforced at the SERVICE layer (not the DB); the DB stores
 *     the persisted, validated row.
 */

const SCHEMA_VERSION = "peaks.crystallization/1" as const;

/**
 * Re-apply the crystallization_event table migration against an
 * already-open database. Used by tests that build their own DB
 * without the openStateDb pipeline. Idempotent.
 */
export function ensureCrystallizationEventTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crystallization_event (
      id                          TEXT PRIMARY KEY,
      trigger                     TEXT NOT NULL CHECK (trigger IN (
                                    'user_explicit',
                                    'llm_suggested',
                                    'success_default_prompt',
                                    'similar_task_recurrence'
                                  )),
      evidence_brief_json         TEXT NOT NULL,
      evidence_bullets_json       TEXT NOT NULL DEFAULT '[]',
      source_trace_pointers_json  TEXT NOT NULL DEFAULT '[]',
      evaluator_summary           TEXT NOT NULL DEFAULT '',
      user_decision_summary       TEXT NOT NULL DEFAULT '',
      created_loop_release_id     TEXT REFERENCES loop_release(id) ON DELETE SET NULL,
      updated_loop_release_id     TEXT REFERENCES loop_release(id) ON DELETE SET NULL,
      created_bee_release_id      INTEGER REFERENCES bee_release(id) ON DELETE SET NULL,
      updated_bee_release_id      INTEGER REFERENCES bee_release(id) ON DELETE SET NULL,
      lifecycle_status            TEXT NOT NULL DEFAULT 'candidate'
                                    CHECK (lifecycle_status IN ('candidate','stable','retired')),
      schema_version              TEXT NOT NULL CHECK (schema_version = 'peaks.crystallization/1'),
      created_at                  TEXT NOT NULL,
      CHECK (length(id) > 0),
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
  `);
}

interface CrystallizationEventRow {
  id: string;
  trigger: string;
  evidence_brief_json: string;
  evidence_bullets_json: string;
  source_trace_pointers_json: string;
  evaluator_summary: string;
  user_decision_summary: string;
  created_loop_release_id: string | null;
  updated_loop_release_id: string | null;
  created_bee_release_id: number | null;
  updated_bee_release_id: number | null;
  lifecycle_status: CrystallizationEventStatus;
  schema_version: "peaks.crystallization/1";
  created_at: string;
}

function rowToCrystallizationEvent(
  row: CrystallizationEventRow
): CrystallizationEvent {
  return {
    id: row.id,
    trigger: row.trigger as CrystallizationEvent["trigger"],
    evidence_brief: JSON.parse(row.evidence_brief_json),
    evidence_bullets: JSON.parse(row.evidence_bullets_json) as string[],
    source_trace_pointers: JSON.parse(
      row.source_trace_pointers_json
    ) as string[],
    evaluator_summary: row.evaluator_summary,
    user_decision_summary: row.user_decision_summary,
    created_loop_release_id: row.created_loop_release_id ?? undefined,
    updated_loop_release_id: row.updated_loop_release_id ?? undefined,
    created_bee_release_id: row.created_bee_release_id ?? undefined,
    updated_bee_release_id: row.updated_bee_release_id ?? undefined,
    lifecycle_status: row.lifecycle_status,
    schema_version: row.schema_version,
    created_at: row.created_at,
  };
}

/**
 * Insert a CrystallizationEvent row. The row's `schema_version` is
 * taken from the input (must equal `peaks.crystallization/1`);
 * `id` and `created_at` are stamped here so callers cannot backdate
 * a row.
 *
 * The Zod schema (parse boundary) re-asserts the 4-section brief
 * guard: a missing-section event is rejected before the SQL INSERT.
 *
 * Returns the persisted row.
 */
export function insertCrystallizationEvent(
  db: Database.Database,
  row: CrystallizationEventInput
): CrystallizationEvent {
  const id = newCrystallizationId();
  const createdAt = new Date().toISOString();
  // Build the persisted row first so the Zod refine guard (brief
  // must have 4 sections) runs before any SQL side effects.
  const persisted: CrystallizationEvent = CrystallizationEventSchema.parse({
    ...row,
    id,
    schema_version: SCHEMA_VERSION,
    created_at: createdAt,
  }) as CrystallizationEvent;
  const stmt = db.prepare(
    `INSERT INTO crystallization_event (
       id, trigger, evidence_brief_json, evidence_bullets_json,
       source_trace_pointers_json, evaluator_summary,
       user_decision_summary,
       created_loop_release_id, updated_loop_release_id,
       created_bee_release_id, updated_bee_release_id,
       lifecycle_status, schema_version, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run(
    persisted.id,
    persisted.trigger,
    JSON.stringify(persisted.evidence_brief),
    JSON.stringify(persisted.evidence_bullets),
    JSON.stringify(persisted.source_trace_pointers),
    persisted.evaluator_summary,
    persisted.user_decision_summary,
    persisted.created_loop_release_id ?? null,
    persisted.updated_loop_release_id ?? null,
    persisted.created_bee_release_id ?? null,
    persisted.updated_bee_release_id ?? null,
    persisted.lifecycle_status,
    persisted.schema_version,
    persisted.created_at
  );
  return persisted;
}

/** Read a single CrystallizationEvent row by id; returns undefined if absent. */
export function getCrystallizationEvent(
  db: Database.Database,
  id: string
): CrystallizationEvent | undefined {
  const row = db
    .prepare("SELECT * FROM crystallization_event WHERE id = ?")
    .get(id) as CrystallizationEventRow | undefined;
  if (!row) return undefined;
  return rowToCrystallizationEvent(row);
}

/**
 * List CrystallizationEvent rows. Filter by `lifecycle_status` and/or
 * any of the optional FK pointers. When ALL filters are omitted, lists
 * every event (newest-first by `created_at`).
 */
export function listCrystallizationEvents(
  db: Database.Database,
  opts: {
    lifecycle_status?: CrystallizationEventStatus;
    created_loop_release_id?: string;
    updated_loop_release_id?: string;
    created_bee_release_id?: number;
    updated_bee_release_id?: number;
  } = {}
): CrystallizationEvent[] {
  const wheres: string[] = [];
  const params: unknown[] = [];
  if (opts.lifecycle_status !== undefined) {
    wheres.push("lifecycle_status = ?");
    params.push(opts.lifecycle_status);
  }
  if (opts.created_loop_release_id !== undefined) {
    wheres.push("created_loop_release_id = ?");
    params.push(opts.created_loop_release_id);
  }
  if (opts.updated_loop_release_id !== undefined) {
    wheres.push("updated_loop_release_id = ?");
    params.push(opts.updated_loop_release_id);
  }
  if (opts.created_bee_release_id !== undefined) {
    wheres.push("created_bee_release_id = ?");
    params.push(opts.created_bee_release_id);
  }
  if (opts.updated_bee_release_id !== undefined) {
    wheres.push("updated_bee_release_id = ?");
    params.push(opts.updated_bee_release_id);
  }
  let sql = "SELECT * FROM crystallization_event";
  if (wheres.length > 0) sql += " WHERE " + wheres.join(" AND ");
  sql += " ORDER BY created_at DESC, id ASC";
  const rows = db.prepare(sql).all(...params) as CrystallizationEventRow[];
  return rows.map(rowToCrystallizationEvent);
}

/**
 * Update the lifecycle_status of an existing CrystallizationEvent row.
 * Returns the updated row, or undefined if absent.
 *
 * Lifecycle transitions are NOT validated here; the service layer
 * decides whether `stable` requires a user_confirmation_pointer or
 * other evidence (mirroring the evolution-store design).
 */
export function updateCrystallizationEventStatus(
  db: Database.Database,
  id: string,
  next: CrystallizationEventStatus
): CrystallizationEvent | undefined {
  const existing = getCrystallizationEvent(db, id);
  if (!existing) return undefined;
  db.prepare(
    "UPDATE crystallization_event SET lifecycle_status = ? WHERE id = ?"
  ).run(next, id);
  return getCrystallizationEvent(db, id);
}

/**
 * Test seam: produce a fresh id for a CrystallizationEvent row.
 * Format: `crys-<hex>` (12 hex chars). Matches the Zod
 * `^crys-[0-9a-f]{8,}$` pattern in CrystallizationEventSchema.
 */
export function newCrystallizationId(): string {
  const hex = Math.floor(Math.random() * 0x1_000_000_000_000)
    .toString(16)
    .padStart(12, "0");
  return `crys-${hex}`;
}

/**
 * Test seam: re-export the schema version so the service layer has a
 * single source of truth.
 */
export { SCHEMA_VERSION as CRYSTALLIZATION_SCHEMA_VERSION };

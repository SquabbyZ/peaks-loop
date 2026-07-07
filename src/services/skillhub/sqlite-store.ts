import Database from "better-sqlite3";
import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Open (or create) a SkillHub state database at the given path.
 *
 * Behavior:
 *   - Creates the parent directory if it does not exist.
 *   - Enables WAL journal mode and foreign-key enforcement.
 *   - Applies every `migrations/*.sql` file in lexicographic order.
 *     Migrations must be idempotent (CREATE TABLE IF NOT EXISTS, etc.).
 *
 * The migrations directory lives next to this source file at build time;
 * we resolve it via `import.meta.url` so the lookup survives vitest ESM
 * (where `__dirname` is undefined). Migration files are discovered by
 * globbing (`*.sql`) and sorted lexicographically so future
 * `002-…`, `003-…` additions are picked up automatically.
 */
export function openStateDb(path: string): Database.Database {
  const parent = dirname(path);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = join(here, "migrations");
  if (existsSync(migrationsDir)) {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      const sql = readFileSync(join(migrationsDir, f), "utf-8");
      try {
        db.exec(sql);
      } catch (err) {
        // Tolerate idempotent re-runs of `ALTER TABLE ... ADD COLUMN`
        // migrations (e.g. 004-loop-bee-extension). The migration
        // files themselves are NOT idempotent (SQLite has no
        // `ALTER TABLE ADD COLUMN IF NOT EXISTS`); the runner is
        // made idempotent here so the same state.db can be opened
        // by multiple CLI processes within one workflow.
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes("duplicate column name") ||
          msg.includes("already exists")
        ) {
          continue;
        }
        throw err;
      }
    }
  }
  return db;
}

/**
 * Return the user-defined table names present in `db` (excluding SQLite
 * system tables such as `sqlite_sequence`).
 */
export function listTables(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as unknown as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

import Database from "better-sqlite3";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Open (or create) a SkillHub state database at the given path.
 *
 * Behavior:
 *   - Creates the parent directory if it does not exist.
 *   - Enables WAL journal mode and foreign-key enforcement.
 *   - Applies migration `001-initial.sql` (idempotent CREATE TABLE IF NOT EXISTS).
 *
 * The migrations directory lives next to this source file at build time;
 * we resolve it via `import.meta.url` so the lookup survives vitest ESM
 * (where `__dirname` is undefined).
 */
export function openStateDb(path: string): Database.Database {
  const parent = dirname(path);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(join(here, "migrations", "001-initial.sql"), "utf-8");
  db.exec(sql);
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
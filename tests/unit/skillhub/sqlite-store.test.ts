import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateDb, listTables } from "../../../src/services/skillhub/sqlite-store.js";
import type Database from "better-sqlite3";

let dir = "";
let db: Database.Database | null = null;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "peaks-db-"));
});
afterEach(() => {
  // Close the DB before deleting the directory. On Windows, WAL/SHM
  // sidecar files (state.db-wal, state.db-shm) keep a transient
  // file-system lock even after better-sqlite3's db.close() — leaving
  // the directory unlinked causes EBUSY in the next test's mkdtemp.
  if (db) {
    try { db.close(); } catch { /* best-effort */ }
    db = null;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("openStateDb", () => {
  it("creates the file and runs migrations", () => {
    const p = join(dir, "state.db");
    db = openStateDb(p);
    expect(existsSync(p)).toBe(true);
    expect(listTables(db).sort()).toEqual(
      [
        "bee_change",
        "bee_file",
        "bee_manifest",
        "bee_release",
        "bee_release_pointer",
        "bee_segment_ref",
        // M1 / spec §4.1 / §7.2 — added by migration 002-loop-release.sql.
        // The migration is non-breaking: existing 4.x `bee_release` rows
        // are untouched (AC-3); this list grows because a NEW table
        // appears alongside the existing 6 tables.
        "loop_release",
        // M5 — added by migration 003-loop-bee-relation.sql (slice 2026-07-08).
        "loop_bee_relation",
        // M5 — added by migration 005-evolution-evaluation.sql (slice 2026-07-09).
        "evolution_evaluation",
        // M5 — added by migration 006-crystallization-event.sql (slice 2026-07-09).
        "crystallization_event",
      ].sort()
    );
  });
});

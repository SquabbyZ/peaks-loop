import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateDb, listTables } from "../../../src/services/skillhub/sqlite-store.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "peaks-db-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("openStateDb", () => {
  it("creates the file and runs migrations", () => {
    const p = join(dir, "state.db");
    const db = openStateDb(p);
    expect(existsSync(p)).toBe(true);
    expect(listTables(db).sort()).toEqual(
      [
        "bee_change",
        "bee_file",
        "bee_manifest",
        "bee_release",
        "bee_release_pointer",
        "bee_segment_ref",
      ].sort()
    );
    db.close();
  });
});
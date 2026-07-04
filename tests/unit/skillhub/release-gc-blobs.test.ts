import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateDb } from "../../../src/services/skillhub/sqlite-store.js";
import { gcBlobs } from "../../../src/services/skillhub/release-gc-blobs.js";

let dir = "";
let db: ReturnType<typeof openStateDb>;
let blobsDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "peaks-gc-"));
  db = openStateDb(join(dir, "state.db"));
  blobsDir = join(dir, "blobs");
  mkdirSync(blobsDir, { recursive: true });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("gcBlobs", () => {
  it("removes unreferenced blobs, keeps referenced", () => {
    mkdirSync(join(blobsDir, "aa"), { recursive: true });
    writeFileSync(join(blobsDir, "aa/aaaa"), "x");
    db.prepare(
      `INSERT INTO bee_release (bee_name, version, source, archived_at, archived_by) VALUES ('bee-y','0.1.0','user',?,'llm')`
    ).run(new Date().toISOString());
    const row = db
      .prepare("SELECT id FROM bee_release WHERE bee_name = 'bee-y'")
      .get() as { id: number };
    const id = row.id;
    db.prepare(
      `INSERT INTO bee_file (release_id, owner_kind, owner_name, path, kind, size_bytes, sha256, blob_path) VALUES (?, 'bee', 'bee-y', 'p', 'other', 1, 'bbbb', 'blobs/bb/bbbb')`
    ).run(id);
    mkdirSync(join(blobsDir, "bb"), { recursive: true });
    writeFileSync(join(blobsDir, "bb/bbbb"), "y");

    const removed = gcBlobs({ db, blobsDir, dryRun: false });
    expect(removed).toContain("aaaa");
    expect(existsSync(join(blobsDir, "aa/aaaa"))).toBe(false);
    expect(existsSync(join(blobsDir, "bb/bbbb"))).toBe(true);
  });

  it("dryRun: true lists orphans without deleting them", () => {
    mkdirSync(join(blobsDir, "aa"), { recursive: true });
    writeFileSync(join(blobsDir, "aa/aaaa"), "x");
    db.prepare(
      `INSERT INTO bee_release (bee_name, version, source, archived_at, archived_by) VALUES ('bee-y','0.1.0','user',?,'llm')`
    ).run(new Date().toISOString());
    const row = db
      .prepare("SELECT id FROM bee_release WHERE bee_name = 'bee-y'")
      .get() as { id: number };
    const id = row.id;
    db.prepare(
      `INSERT INTO bee_file (release_id, owner_kind, owner_name, path, kind, size_bytes, sha256, blob_path) VALUES (?, 'bee', 'bee-y', 'p', 'other', 1, 'bbbb', 'blobs/bb/bbbb')`
    ).run(id);
    mkdirSync(join(blobsDir, "bb"), { recursive: true });
    writeFileSync(join(blobsDir, "bb/bbbb"), "y");

    // dryRun: true must report the orphan but leave the file on disk.
    const removed = gcBlobs({ db, blobsDir, dryRun: true });
    expect(removed).toContain("aaaa");
    // Orphan survives dry-run.
    expect(existsSync(join(blobsDir, "aa/aaaa"))).toBe(true);
    // Referenced blob untouched.
    expect(existsSync(join(blobsDir, "bb/bbbb"))).toBe(true);
  });
});

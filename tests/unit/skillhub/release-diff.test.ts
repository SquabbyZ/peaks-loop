import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateDb } from "../../../src/services/skillhub/sqlite-store.js";
import { retainRelease, ensureBlob, sha256OfFile, walk } from "../../../src/services/skillhub/release-retain.js";
import { releaseDiff } from "../../../src/services/skillhub/release-diff.js";
import type { BeeManifest } from "../../../src/services/sediment/types.js";

let dir = "";
let db: ReturnType<typeof openStateDb>;
let blobsDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "peaks-diff-"));
  db = openStateDb(join(dir, "state.db"));
  blobsDir = join(dir, "blobs");
  mkdirSync(blobsDir, { recursive: true });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const mkManifest = (over: Partial<BeeManifest> = {}): BeeManifest => ({
  schemaVersion: "peaks.bee/1",
  name: "bee-x",
  source: "user",
  promotion_status: "candidate",
  description: "d",
  segments: [],
  entrypoint: { preamble: "## x", refs: [] },
  promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true },
  createdBy: "llm",
  lastTouchedAt: "2026-07-04T12:00:00Z",
  ...over,
});

describe("releaseDiff", () => {
  it("reports added/removed/modified files", () => {
    // First release via retainRelease (version pinned to 0.1.0)
    const a = mkdtempSync(join(tmpdir(), "peaks-a-"));
    mkdirSync(join(a, "scripts"), { recursive: true });
    writeFileSync(join(a, "SKILL.md"), "v1 SKILL");
    writeFileSync(join(a, "scripts/fetch.sh"), "echo v1");
    retainRelease({ db, blobsDir, scratchDir: a, manifest: mkManifest() });
    rmSync(a, { recursive: true, force: true });

    // Second release: change SKILL, drop fetch.sh, add parse.sh.
    // retainRelease hardcodes 0.1.0 in this slice, so insert v0.2.0 directly.
    const b = mkdtempSync(join(tmpdir(), "peaks-b-"));
    mkdirSync(join(b, "scripts"), { recursive: true });
    writeFileSync(join(b, "SKILL.md"), "v2 SKILL");
    writeFileSync(join(b, "scripts/parse.sh"), "echo v2");

    db.prepare(
      `INSERT INTO bee_release (bee_name, version, source, archived_at, archived_by) VALUES ('bee-x','0.2.0','user',?, 'llm')`
    ).run(new Date().toISOString());
    const newId = (
      db.prepare("SELECT id FROM bee_release WHERE version = '0.2.0'").get() as {
        id: number;
      }
    ).id;
    db.prepare(
      `INSERT INTO bee_manifest (release_id, schema_version, description, segments_json, entrypoint_preamble, promotion, requires_human, requires_smoke) VALUES (?, 'peaks.bee/1', 'd', '[]', '', 'candidate', 0, 0)`
    ).run(newId);

    for (const f of walk(b)) {
      const { sha, bytes: size } = sha256OfFile(f.abs);
      const blobPath = ensureBlob(blobsDir, sha, f.abs);
      db.prepare(
        `INSERT INTO bee_file (release_id, owner_kind, owner_name, path, kind, size_bytes, sha256, blob_path) VALUES (?, 'bee', 'bee-x', ?, 'other', ?, ?, ?)`
      ).run(newId, f.rel, size, sha, blobPath);
    }
    rmSync(b, { recursive: true, force: true });

    const r = releaseDiff({
      db,
      beeName: "bee-x",
      fromVersion: "0.1.0",
      toVersion: "0.2.0",
    });
    expect(r.removed).toContain("scripts/fetch.sh");
    expect(r.added).toContain("scripts/parse.sh");
    expect(r.modified).toContain("SKILL.md");
  });

  it("throws VERSION_NOT_FOUND when either version is missing", () => {
    // Only 0.1.0 exists for bee-x; querying 9.9.9 must throw.
    const a = mkdtempSync(join(tmpdir(), "peaks-only-"));
    mkdirSync(join(a, "scripts"), { recursive: true });
    writeFileSync(join(a, "SKILL.md"), "v1");
    retainRelease({ db, blobsDir, scratchDir: a, manifest: mkManifest() });
    rmSync(a, { recursive: true, force: true });

    expect(() =>
      releaseDiff({ db, beeName: "bee-x", fromVersion: "9.9.9", toVersion: "0.1.0" })
    ).toThrow(/VERSION_NOT_FOUND/);
    expect(() =>
      releaseDiff({ db, beeName: "bee-x", fromVersion: "0.1.0", toVersion: "9.9.9" })
    ).toThrow(/VERSION_NOT_FOUND/);
  });
});

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateDb } from "../../../src/services/skillhub/sqlite-store.js";
import { retainRelease } from "../../../src/services/skillhub/release-retain.js";
import type { BeeManifest } from "../../../src/services/sediment/types.js";

let dir = "";
let db: ReturnType<typeof openStateDb>;
let blobsDir: string;
let scratchDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "peaks-retain-"));
  db = openStateDb(join(dir, "state.db"));
  blobsDir = join(dir, "blobs");
  scratchDir = join(dir, "scratch");
  mkdirSync(scratchDir, { recursive: true });
  mkdirSync(blobsDir, { recursive: true });
  writeFileSync(join(scratchDir, "SKILL.md"), "## bee-x\n");
  mkdirSync(join(scratchDir, "scripts"), { recursive: true });
  writeFileSync(join(scratchDir, "scripts", "fetch.sh"), "#!/bin/sh\necho hi\n", { mode: 0o755 });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const manifest: BeeManifest = {
  schemaVersion: "peaks.bee/1",
  name: "bee-x",
  source: "user",
  promotion_status: "candidate",
  description: "d",
  segments: [{ name: "seg-a", inputs: [], outputs: [], sideEffects: ["net:fetch"] }],
  entrypoint: { preamble: "## bee-x", refs: [{ path: "scripts/fetch.sh", kind: "script" }] },
  promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true },
  createdBy: "llm",
  lastTouchedAt: "2026-07-04T12:00:00Z",
};

describe("retainRelease", () => {
  it("writes 6-table rows and content-addressed blobs", () => {
    const id = retainRelease({ db, blobsDir, scratchDir, manifest });
    expect(id).toBeGreaterThan(0);
    const r = db
      .prepare("SELECT bee_name, version, source FROM bee_release WHERE id = ?")
      .get(id) as { bee_name: string; version: string; source: string };
    expect(r).toEqual({ bee_name: "bee-x", version: "0.1.0", source: "user" });
    const files = db
      .prepare("SELECT owner_kind, owner_name, path, sha256 FROM bee_file WHERE release_id = ?")
      .all(id) as Array<{ owner_kind: string; owner_name: string; path: string; sha256: string }>;
    expect(files.length).toBeGreaterThanOrEqual(2);
    // No single TEXT column over 16KB (qualify columns: description exists in both tables)
    const colChecks: Array<{ table: string; col: string }> = [
      { table: "bee_release", col: "description" },
      { table: "bee_release", col: "changelog" },
      { table: "bee_release", col: "user_intent_raw" },
      { table: "bee_manifest", col: "entrypoint_preamble" },
    ];
    for (const { table, col } of colChecks) {
      const max = (
        db.prepare(`SELECT MAX(LENGTH(${col})) AS m FROM ${table}`).get() as {
          m: number | null;
        }
      ).m ?? 0;
      expect(max).toBeLessThan(16 * 1024);
    }
    // Verify blobs sidecar files were written
    const shaValues = files.map((f) => f.sha256);
    expect(shaValues.length).toBeGreaterThanOrEqual(2);
    for (const sha of shaValues) {
      expect(existsSync(join(blobsDir, sha.slice(0, 2), sha))).toBe(true);
    }
  });
});
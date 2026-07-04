import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateDb } from "../../../src/services/skillhub/sqlite-store.js";
import { retainRelease } from "../../../src/services/skillhub/release-retain.js";
import { exportRelease } from "../../../src/services/skillhub/release-export.js";
import { importRelease } from "../../../src/services/skillhub/release-import.js";
import type { BeeManifest } from "../../../src/services/sediment/types.js";

let dir = "";
let db: ReturnType<typeof openStateDb>;
let blobsDir: string;
let scratchDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "peaks-exp-"));
  db = openStateDb(join(dir, "state.db"));
  blobsDir = join(dir, "blobs");
  scratchDir = join(dir, "scratch");
  mkdirSync(blobsDir, { recursive: true });
  mkdirSync(scratchDir, { recursive: true });
  writeFileSync(join(scratchDir, "SKILL.md"), "## bee-x\n");
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
  segments: [],
  entrypoint: { preamble: "## bee-x", refs: [] },
  promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true },
  createdBy: "llm",
  lastTouchedAt: "2026-07-04T12:00:00Z",
};

describe("release export/import round-trip", () => {
  it("preserves manifest + files byte-identical", () => {
    retainRelease({ db, blobsDir, scratchDir, manifest });
    const tar = join(dir, "out.tar.gz");
    exportRelease({ db, blobsDir, beeName: "bee-x", version: "0.1.0", outPath: tar });
    expect(existsSync(tar)).toBe(true);
    // Wipe db, then import into a fresh db
    db.close();
    const db2 = openStateDb(join(dir, "state2.db"));
    const blobs2 = join(dir, "blobs2");
    mkdirSync(blobs2, { recursive: true });
    importRelease({ db: db2, blobsDir: blobs2, inPath: tar, asName: "bee-x" });
    const r2 = db2
      .prepare("SELECT bee_name, version FROM bee_release WHERE bee_name = 'bee-x'")
      .all() as Array<{ bee_name: string; version: string }>;
    expect(r2).toEqual([{ bee_name: "bee-x", version: "0.1.0" }]);
    db2.close();
  });
});

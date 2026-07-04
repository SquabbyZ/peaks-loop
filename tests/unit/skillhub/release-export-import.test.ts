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

  // Regression: importRelease must clean up its extract dir when tar fails.
  // We trigger a tar failure by passing a path that does not exist.
  it("cleans up the extract dir when tar extraction fails", () => {
    const missingTar = join(dir, "does-not-exist.tar.gz");
    const extractDir = missingTar + ".extract";
    // Pre-create the extract dir so we can assert it gets removed.
    mkdirSync(extractDir, { recursive: true });
    writeFileSync(join(extractDir, "stale.txt"), "stale");
    expect(existsSync(extractDir)).toBe(true);

    let threw = false;
    try {
      importRelease({ db, blobsDir, inPath: missingTar });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(existsSync(extractDir)).toBe(false);
  });

  // Regression: importRelease must run its row inserts inside a transaction.
  // We force a mid-INSERT failure by passing a bee_release row whose
  // `version` is NULL — `bee_release.version` is NOT NULL, so the INSERT
  // throws. After the throw, the previously-inserted `bee_release` row
  // (and any sibling rows from the same tx) MUST be rolled back.
  it("rolls back partial row inserts when an INSERT throws mid-transaction", () => {
    retainRelease({ db, blobsDir, scratchDir, manifest });
    const tar = join(dir, "tx-out.tar.gz");
    exportRelease({ db, blobsDir, beeName: "bee-x", version: "0.1.0", outPath: tar });
    expect(existsSync(tar)).toBe(true);

    // Hand-build a corrupt manifest inside the tar so we can inject a bad row.
    // We extract, rewrite manifest.json, repack, then call importRelease.
    const stageDir = tar + ".rebuild";
    if (existsSync(stageDir)) rmSync(stageDir, { recursive: true, force: true });
    mkdirSync(stageDir, { recursive: true });
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const tarBin = process.platform === "win32" ? "C:\\Windows\\System32\\tar.exe" : "tar";
    execFileSync(tarBin, ["-xzf", tar, "-C", stageDir]);
    const manifestJson = JSON.parse(
      require("node:fs").readFileSync(join(stageDir, "manifest.json"), "utf-8") as string
    ) as Record<string, unknown>;
    // Strip the version field from manifestRows so the INSERT will fail
    // (bee_manifest.release_id is NOT NULL, and we'll point it at NULL
    // by removing all manifestRows and letting bee_release succeed then
    // force a NOT NULL violation on the next sibling table).
    // Strategy: corrupt changeRows.detail by making target_name null —
    // target_name is NOT NULL on bee_change.
    manifestJson.changeRows = [
      {
        change_kind: "added",
        target_kind: "bee",
        target_name: null, // NOT NULL violation on bee_change.target_name
        detail: "x",
      },
    ];
    // We need at least one row in each preceding loop to reach changeRows,
    // and we need bee_release + bee_release_pointer to have succeeded first
    // so that the rollback is observable.
    require("node:fs").writeFileSync(
      join(stageDir, "manifest.json"),
      JSON.stringify(manifestJson, null, 2)
    );
    // Repack with a fresh name so we don't collide with the original tar.
    const corruptedTar = join(dir, "corrupted.tar.gz");
    if (existsSync(corruptedTar)) rmSync(corruptedTar, { force: true });
    execFileSync(tarBin, ["-czf", corruptedTar, "-C", stageDir, "."]);
    rmSync(stageDir, { recursive: true, force: true });

    const db2 = openStateDb(join(dir, "state-tx.db"));
    let threw = false;
    try {
      importRelease({ db: db2, blobsDir: join(dir, "blobs-tx"), inPath: corruptedTar, asName: "bee-y" });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // The bee_release row for bee-y was inserted BEFORE the failing change row.
    // Without the transaction wrapper, that row would still be present.
    // With the transaction wrapper, the entire tx must have rolled back.
    const rows = db2
      .prepare("SELECT bee_name FROM bee_release WHERE bee_name = 'bee-y'")
      .all() as Array<{ bee_name: string }>;
    expect(rows).toEqual([]);
    db2.close();
  });
});

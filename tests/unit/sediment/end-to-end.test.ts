import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSediment } from "../../../src/cli/commands/sediment-commands.js";
import { openStateDb } from "../../../src/services/skillhub/sqlite-store.js";
import { retainRelease } from "../../../src/services/skillhub/release-retain.js";
import { releaseDiff } from "../../../src/services/skillhub/release-diff.js";
import { exportRelease } from "../../../src/services/skillhub/release-export.js";
import { importRelease } from "../../../src/services/skillhub/release-import.js";

let home = "";
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "peaks-e2e-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

describe("end-to-end sediment cycle (dogfood)", () => {
  it("runs add-segment → add-bee → dispose --decision retain → release-diff → export → import without errors", async () => {
    // 1. add-segment
    const r1 = await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    expect(r1.ok).toBe(true);

    // 2. add-bee
    const r2 = await runSediment(["add-bee", "bee-x", "--segment", "seg-a", "--description", "d", "--apply"], { home });
    if (!r2.ok) throw new Error(`add-bee failed: ${r2.error}`);
    expect(r2.ok).toBe(true);
    expect(existsSync(join(home, ".peaks/skills/bees/bee-x/manifest.json"))).toBe(true);

    // 3. open state.db + retain a scratch
    const db = openStateDb(join(home, ".peaks/skills/state.db"));
    const blobsDir = join(home, ".peaks/skills/blobs");
    const scratchDir = join(home, "scratch");
    mkdirSync(blobsDir, { recursive: true });
    mkdirSync(scratchDir, { recursive: true });
    writeFileSync(join(scratchDir, "SKILL.md"), "## bee-x\n");

    const m = {
      schemaVersion: "peaks.bee/1" as const, name: "bee-x", source: "user" as const, promotion_status: "candidate" as const,
      description: "d", segments: [{ name: "seg-a", inputs: [], outputs: [], sideEffects: [] }],
      entrypoint: { preamble: "## bee-x", refs: [] },
      promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true },
      createdBy: "llm" as const, lastTouchedAt: new Date().toISOString(),
    };
    const id = retainRelease({ db, blobsDir, scratchDir, manifest: m });
    expect(id).toBeGreaterThan(0);

    // 4. list via CLI
    const releases = await runSediment(["releases", "bee-x"], { home });
    expect(releases.ok).toBe(true);
    expect((releases.data as any[]).length).toBe(1);

    // 5. release-show
    const show = await runSediment(["release-show", "bee-x", "--version", "0.1.0"], { home });
    expect(show.ok).toBe(true);
    expect((show.data as any).release.version).toBe("0.1.0");

    // 6. release-diff (same version, expect empty)
    const diff = releaseDiff({ db, beeName: "bee-x", fromVersion: "0.1.0", toVersion: "0.1.0" });
    expect({ ...diff }).toEqual({ added: [], removed: [], modified: [] });
    db.close();

    // 7. export + import into a fresh home
    const db2 = openStateDb(join(home, ".peaks/skills/state.db"));
    const tar = join(home, "out.tar.gz");
    exportRelease({ db: db2, blobsDir, beeName: "bee-x", version: "0.1.0", outPath: tar });
    expect(existsSync(tar)).toBe(true);
    db2.close();

    const home2 = mkdtempSync(join(tmpdir(), "peaks-e2e2-"));
    const db3 = openStateDb(join(home2, ".peaks/skills/state.db"));
    const blobs2 = join(home2, ".peaks/skills/blobs");
    mkdirSync(blobs2, { recursive: true });
    importRelease({ db: db3, blobsDir: blobs2, inPath: tar, asName: "bee-x" });
    const r3 = db3.prepare("SELECT bee_name FROM bee_release").all() as any[];
    expect(r3).toEqual([{ bee_name: "bee-x" }]);
    db3.close();
    rmSync(home2, { recursive: true, force: true });
  });
});

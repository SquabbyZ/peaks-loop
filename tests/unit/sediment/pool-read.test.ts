import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPool } from "../../../src/services/sediment/pool-read.js";

let home = "";
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "peaks-pool-")); mkdirSync(join(home, ".peaks/skills"), { recursive: true }); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

describe("readPool", () => {
  it("returns an empty index for a fresh pool", () => {
    const r = readPool({ home });
    expect(r.entries).toEqual([]);
    expect(r.schemaVersion).toBe("peaks.pool/1");
  });
  it("discovers a bee under bees/", () => {
    const beeDir = join(home, ".peaks/skills/bees/bee-x");
    mkdirSync(beeDir, { recursive: true });
    writeFileSync(join(beeDir, "manifest.json"), JSON.stringify({
      schemaVersion: "peaks.bee/1", name: "bee-x", source: "user", promotion_status: "candidate",
      description: "d", segments: [], entrypoint: { preamble: "", refs: [] },
      promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true },
      createdBy: "llm", lastTouchedAt: "2026-07-04T12:00:00Z",
    }));
    const r = readPool({ home });
    expect(r.entries.find((e) => e.name === "bee-x")).toBeTruthy();
  });
  it("rebuilds index.json when missing", () => {
    const r = readPool({ home });
    expect(r.entries).toEqual([]);
    // After readPool, index.json should exist
    const idxPath = join(home, ".peaks/skills/index.json");
    expect(existsSync(idxPath)).toBe(true);
  });
  it("ignores stray files (e.g. .DS_Store) under bees/ and segments/", () => {
    const beeDir = join(home, ".peaks/skills/bees/bee-x");
    mkdirSync(beeDir, { recursive: true });
    writeFileSync(join(beeDir, "manifest.json"), JSON.stringify({
      schemaVersion: "peaks.bee/1", name: "bee-x", source: "user", promotion_status: "candidate",
      description: "d", segments: [], entrypoint: { preamble: "", refs: [] },
      promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true },
      createdBy: "llm", lastTouchedAt: "2026-07-04T12:00:00Z",
    }));
    // Stray macOS / Windows files that should be ignored.
    writeFileSync(join(home, ".peaks/skills/bees/.DS_Store"), "ds");
    writeFileSync(join(home, ".peaks/skills/bees/Thumbs.db"), "th");
    const segDir = join(home, ".peaks/skills/segments/seg-x");
    mkdirSync(segDir, { recursive: true });
    writeFileSync(join(segDir, "SKILL.md"), "## seg-x\n");
    writeFileSync(join(home, ".peaks/skills/segments/.DS_Store"), "ds");
    const r = readPool({ home });
    // bee-x must be picked up; .DS_Store / Thumbs.db must NOT appear as entries.
    expect(r.entries.some((e) => e.name === "bee-x")).toBe(true);
    expect(r.entries.some((e) => e.name === ".DS_Store")).toBe(false);
    expect(r.entries.some((e) => e.name === "Thumbs.db")).toBe(false);
    expect(r.entries.some((e) => e.name === "seg-x")).toBe(true);
  });
});

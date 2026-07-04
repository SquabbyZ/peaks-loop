import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rebuildIndexFromFs } from "../../../src/services/sediment/pool-rebuild-index.js";

let home = "";
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "peaks-rb-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

describe("rebuildIndexFromFs", () => {
  it("rebuilds a missing/dirty index.json deterministically", () => {
    mkdirSync(join(home, ".peaks/skills/bees/bee-a"), { recursive: true });
    writeFileSync(join(home, ".peaks/skills/bees/bee-a/manifest.json"), JSON.stringify({
      schemaVersion: "peaks.bee/1", name: "bee-a", source: "user", promotion_status: "candidate",
      description: "d", segments: [], entrypoint: { preamble: "", refs: [] },
      promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true },
      createdBy: "llm", lastTouchedAt: "2026-07-04T12:00:00Z",
    }));
    const r = rebuildIndexFromFs({ home });
    expect(r.entries.find((e) => e.name === "bee-a")).toBeTruthy();
    expect(existsSync(join(home, ".peaks/skills/index.json"))).toBe(true);
  });
});

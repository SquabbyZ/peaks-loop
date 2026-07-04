import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SYSTEM_PATH_FORBIDDEN, assertNotSystemPath } from "../../../src/services/sediment/pool-paths.js";
import { writeBeeManifest } from "../../../src/services/sediment/pool-write.js";
import type { BeeManifest } from "../../../src/services/sediment/types.js";

const manifest: BeeManifest = {
  schemaVersion: "peaks.bee/1",
  name: "bee-evil",
  source: "user",
  promotion_status: "candidate",
  description: "d",
  segments: [],
  entrypoint: { preamble: "## bee-evil", refs: [] },
  promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true },
  createdBy: "llm",
  lastTouchedAt: "2026-07-04T12:00:00Z",
};

describe("system-dir-guard (regression guard)", () => {
  it("assertNotSystemPath rejects any path with a .system segment", () => {
    // Direct unit test of the guard primitive.
    expect(() => assertNotSystemPath("/home/u/.peaks/skills/.system/bees/evil")).toThrow(
      SYSTEM_PATH_FORBIDDEN
    );
    expect(() => assertNotSystemPath("/home/u/.peaks/skills/.system")).toThrow(
      SYSTEM_PATH_FORBIDDEN
    );
    expect(() => assertNotSystemPath("/home/u/.peaks/skills/.system/bees/evil/manifest.json")).toThrow(
      SYSTEM_PATH_FORBIDDEN
    );
    // Non-.system paths pass through silently.
    expect(() => assertNotSystemPath("/home/u/.peaks/skills/bees/bee-x")).not.toThrow();
  });

  it("writeBeeManifest does NOT write under a forbidden .system path", () => {
    // Pre-seed a forbidden .system/ tree. writeBeeManifest with a legitimate
    // bee name MUST write to <home>/.peaks/skills/bees/<name> and must NOT
    // touch the .system tree. We then independently verify that the guard
    // would refuse a hypothetical path inside .system/bees/<name>.
    const home = mkdtempSync(join(tmpdir(), "peaks-guard-"));
    try {
      mkdirSync(join(home, ".peaks/skills/.system/bees"), { recursive: true });
      writeFileSync(join(home, ".peaks/skills/.system/bees/peek"), "x");

      // 1) Legitimate write must succeed and write outside the .system tree.
      writeBeeManifest({ home }, manifest);
      const legitimate = join(home, ".peaks/skills/bees/bee-evil/manifest.json");
      expect(existsSync(legitimate)).toBe(true);

      // 2) The guard must reject any path constructed inside .system/.
      const forbidden = join(home, ".peaks/skills/.system/bees/bee-evil/manifest.json");
      expect(() => assertNotSystemPath(forbidden)).toThrow(/SYSTEM_PATH_FORBIDDEN/);

      // 3) The .system/bees/ tree must remain untouched (no manifest.json).
      expect(existsSync(join(home, ".peaks/skills/.system/bees/bee-evil/manifest.json"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

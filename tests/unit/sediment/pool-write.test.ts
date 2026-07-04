import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeBeeManifest } from "../../../src/services/sediment/pool-write.js";
import type { BeeManifest } from "../../../src/services/sediment/types.js";

let home = "";
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "peaks-pw-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const m: BeeManifest = {
  schemaVersion: "peaks.bee/1", name: "bee-x", source: "user", promotion_status: "candidate",
  description: "d", segments: [], entrypoint: { preamble: "", refs: [] },
  promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true },
  createdBy: "llm", lastTouchedAt: "2026-07-04T12:00:00Z",
};

describe("writeBeeManifest", () => {
  it("writes under bees/<name>/manifest.json", () => {
    writeBeeManifest({ home }, m);
    const manifestPath = join(home, ".peaks/skills/bees/bee-x/manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const written = JSON.parse(readFileSync(manifestPath, "utf-8")) as BeeManifest;
    expect(written.name).toBe("bee-x");
    expect(written.schemaVersion).toBe("peaks.bee/1");
  });

  it("re-validates the manifest via lintManifestStrict (defense in depth)", () => {
    // Passing an invalid manifest (bad name format) should throw a zod error,
    // not write the file. This documents that writeBeeManifest always validates
    // input before touching the filesystem.
    const invalid = { ...m, name: "BAD NAME WITH SPACES" } as unknown as BeeManifest;
    expect(() => writeBeeManifest({ home }, invalid)).toThrow();
    expect(existsSync(join(home, ".peaks/skills/bees"))).toBe(false);
  });
});

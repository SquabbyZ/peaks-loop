/**
 * peaks skill sediment CLI — Task 15a scope (4 verbs).
 *
 * Tests the exported runSediment(argv, { home }) function directly.
 * The CLI wiring into program.ts is exercised via the program-level
 * tests (if added later); this file stays at the runSediment boundary.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSediment } from "../../../src/cli/commands/sediment-commands.js";

let home = "";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "peaks-sediment-cli-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("peaks skill sediment CLI — add-segment", () => {
  it("creates a user segment in pool and writes SKILL.md with frontmatter", async () => {
    const r = await runSediment(
      ["add-segment", "seg-a", "--describe", "my segment", "--apply"],
      { home }
    );
    expect(r.ok).toBe(true);
    const skillPath = join(home, ".peaks/skills/segments/seg-a/SKILL.md");
    expect(existsSync(skillPath)).toBe(true);
    const content = (await import("node:fs")).readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/^---/);
    expect(content).toContain("name: seg-a");
    expect(content).toContain("description: my segment");
  });

  it("rejects a segment name containing .system path segment (SYSTEM_PATH_FORBIDDEN)", async () => {
    // A segment named ".system" would resolve under the .peaks/skills/segments
    // directory but the assertNotSystemPath() guard inside add-segment
    // catches any path-segment that equals ".system". The brief's original
    // assertion (`path: ".system/bees/evil"` as any) fails at zod before
    // reaching the guard; this test exercises the real guard via a
    // legitimate-looking name that contains ".system" as a path segment.
    //
    // We invoke add-segment with `..` to construct a path that traverses
    // into a .system dir — this triggers assertNotSystemPath.
    const r = await runSediment(
      ["add-segment", "ok", "--describe", "d", "--apply"],
      { home }
    );
    expect(r.ok).toBe(true);
    // Now an attempt to add-segment with a path that resolves into .system
    // — we use a name that, after join() + path normalization, has a
    // ".system" segment. We use "../../.system/foo" so segment name is
    // rejected.
    const r2 = await runSediment(
      ["add-segment", "../.system/evil", "--describe", "d", "--apply"],
      { home }
    );
    expect(r2.ok).toBe(false);
    expect(r2.error).toContain("SYSTEM_PATH_FORBIDDEN");
  });

  it("rebuilds index.json after add-segment", async () => {
    const r = await runSediment(
      ["add-segment", "seg-b", "--describe", "d", "--apply"],
      { home }
    );
    expect(r.ok).toBe(true);
    // add-segment calls rebuildIndexFromFs which writes index.json
    expect(existsSync(join(home, ".peaks/skills/index.json"))).toBe(true);
  });
});

describe("peaks skill sediment CLI — add-bee", () => {
  it("creates a user bee in the pool with manifest.json", async () => {
    const r1 = await runSediment(
      ["add-segment", "seg-a", "--describe", "d", "--apply"],
      { home }
    );
    expect(r1.ok).toBe(true);
    const r2 = await runSediment(
      ["add-bee", "bee-x", "--segment", "seg-a", "--description", "dd", "--apply"],
      { home }
    );
    expect(r2.ok).toBe(true);
    const manifestPath = join(home, ".peaks/skills/bees/bee-x/manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
  });

  it("rejects a bee name that violates zod schema (name must match bee-/peaks- regex)", async () => {
    // Bee names must start with "bee-" or "peaks-". "evil" fails the schema.
    const r = await runSediment(
      ["add-bee", "evil", "--segment", "x", "--apply"],
      { home }
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
  });

  it("rebuilds index.json after add-bee", async () => {
    const r1 = await runSediment(
      ["add-segment", "seg-a", "--describe", "d", "--apply"],
      { home }
    );
    expect(r1.ok).toBe(true);
    const r2 = await runSediment(
      ["add-bee", "bee-y", "--segment", "seg-a", "--description", "dd", "--apply"],
      { home }
    );
    expect(r2.ok).toBe(true);
    expect(existsSync(join(home, ".peaks/skills/index.json"))).toBe(true);
  });
});

describe("peaks skill sediment CLI — list", () => {
  it("returns entries from the pool", async () => {
    const r = await runSediment(["list"], { home });
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.data)).toBe(true);
  });

  it("lists entries for an existing manifest written directly to disk", async () => {
    // Pre-seed: write a bee manifest directly into the pool so rebuild
    // / list will surface it.
    const beeDir = join(home, ".peaks/skills/bees/bee-a");
    mkdirSync(beeDir, { recursive: true });
    writeFileSync(
      join(beeDir, "manifest.json"),
      JSON.stringify({
        schemaVersion: "peaks.bee/1",
        name: "bee-a",
        source: "user",
        promotion_status: "candidate",
        description: "seeded",
        segments: [{ name: "seg", inputs: [], outputs: [], sideEffects: [] }],
        entrypoint: { preamble: "", refs: [] },
        promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true },
        createdBy: "llm",
        lastTouchedAt: new Date().toISOString(),
      })
    );
    const r = await runSediment(["list"], { home });
    expect(r.ok).toBe(true);
    const entries = r.data as Array<{ name: string }>;
    expect(entries.some((e) => e.name === "bee-a")).toBe(true);
  });
});

describe("peaks skill sediment CLI — rebuild-index", () => {
  it("creates index.json from filesystem state and returns it", async () => {
    const beeDir = join(home, ".peaks/skills/bees/bee-a");
    mkdirSync(beeDir, { recursive: true });
    writeFileSync(
      join(beeDir, "manifest.json"),
      JSON.stringify({
        schemaVersion: "peaks.bee/1",
        name: "bee-a",
        source: "user",
        promotion_status: "candidate",
        description: "d",
        segments: [],
        entrypoint: { preamble: "", refs: [] },
        promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true },
        createdBy: "llm",
        lastTouchedAt: "2026-07-04T12:00:00Z",
      })
    );
    const r = await runSediment(["rebuild-index"], { home });
    expect(r.ok).toBe(true);
    expect(existsSync(join(home, ".peaks/skills/index.json"))).toBe(true);
    const idx = r.data as { entries: unknown[] };
    expect(Array.isArray(idx.entries)).toBe(true);
  });
});

describe("peaks skill sediment CLI — unknown verb gate", () => {
  it("returns UNKNOWN_VERB for verbs not yet implemented in 15b/15c/15d", async () => {
    const r = await runSediment(["bogus"], { home });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/UNKNOWN_VERB/);
    expect(r.error).toContain("bogus");
  });

  it("returns UNKNOWN_VERB for the next-batch verbs (refine-bee, dispose, export)", async () => {
    for (const v of ["refine-bee", "dispose", "export"]) {
      const r = await runSediment([v], { home });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/UNKNOWN_VERB/);
    }
  });
});

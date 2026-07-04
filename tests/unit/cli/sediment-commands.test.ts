/**
 * peaks skill sediment CLI — Task 15a scope (4 verbs).
 *
 * Tests the exported runSediment(argv, { home }) function directly.
 * The CLI wiring into program.ts is exercised via the program-level
 * tests (if added later); this file stays at the runSediment boundary.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSediment, parseFlags } from "../../../src/cli/commands/sediment-commands.js";

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

  it("returns UNKNOWN_VERB for verbs not yet implemented (hypothetical)", async () => {
    const r = await runSediment(["completely-unknown"], { home });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/UNKNOWN_VERB/);
  });
});

// --- Task 15b: parseFlags array-valued support ---

describe("parseFlags — Task 15b array-valued support", () => {
  it("collects repeated --segment values into an array", () => {
    const { positional, flags } = parseFlags([
      "add-bee",
      "bee-x",
      "--segment",
      "seg-a",
      "--segment",
      "seg-b",
      "--segment",
      "seg-c",
      "--apply",
    ]);
    expect(positional).toEqual(["add-bee", "bee-x"]);
    expect(flags.segment).toEqual(["seg-a", "seg-b", "seg-c"]);
    expect(flags.apply).toBe(true);
  });

  it("keeps a single --segment value as a string (not wrapped in array)", () => {
    const { flags } = parseFlags(["add-bee", "bee-x", "--segment", "seg-a"]);
    expect(flags.segment).toBe("seg-a");
  });

  it("treats --flag without a following non-flag value as boolean true", () => {
    const { flags } = parseFlags(["--apply"]);
    expect(flags.apply).toBe(true);
  });

  it("mixes repeatable and single-value flags correctly", () => {
    const { positional, flags } = parseFlags([
      "verb",
      "--segment",
      "a",
      "--segment",
      "b",
      "--patch",
      "x",
      "--apply",
    ]);
    expect(positional).toEqual(["verb"]);
    expect(flags.segment).toEqual(["a", "b"]);
    expect(flags.patch).toBe("x");
    expect(flags.apply).toBe(true);
  });
});

// --- Task 15b: refine-bee / clone-bee / promote / retire ---

describe("peaks skill sediment refine-bee", () => {
  it("updates the manifest while preserving promotion_status", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(["add-bee", "bee-x", "--segment", "seg-a", "--description", "d", "--apply"], { home });
    const r = await runSediment(
      ["refine-bee", "bee-x", "--patch", "tighten description", "--apply"],
      { home }
    );
    expect(r.ok).toBe(true);
    const m = JSON.parse(
      readFileSync(join(home, ".peaks/skills/bees/bee-x/manifest.json"), "utf-8")
    );
    expect(m.description).toContain("tighten description");
    expect(m.promotion_status).toBe("candidate"); // preserved
  });

  it("refuses when the bee does not exist (BEE_NOT_FOUND)", async () => {
    const r = await runSediment(
      ["refine-bee", "missing", "--patch", "x", "--apply"],
      { home }
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/BEE_NOT_FOUND/);
  });

  it("requires --patch", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(["add-bee", "bee-x", "--segment", "seg-a", "--description", "d", "--apply"], { home });
    const r = await runSediment(["refine-bee", "bee-x", "--apply"], { home });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/--patch/);
  });
});

describe("peaks skill sediment clone-bee", () => {
  it("creates a sibling with promotion_status reset to candidate", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(["add-bee", "bee-x", "--segment", "seg-a", "--description", "d", "--apply"], { home });
    // Bump source to stable for the test
    writeFileSync(
      join(home, ".peaks/skills/bees/bee-x/run-state.json"),
      JSON.stringify({ cycles: 5, lastOutcome: "success" })
    );
    await runSediment(["promote", "bee-x", "--apply"], { home });
    // Now clone
    const r = await runSediment(["clone-bee", "bee-x", "--as", "bee-y", "--apply"], {
      home,
    });
    expect(r.ok).toBe(true);
    expect(existsSync(join(home, ".peaks/skills/bees/bee-y/manifest.json"))).toBe(true);
    const m = JSON.parse(
      readFileSync(join(home, ".peaks/skills/bees/bee-y/manifest.json"), "utf-8")
    );
    expect(m.name).toBe("bee-y");
    expect(m.promotion_status).toBe("candidate");
    // Source must remain stable (unchanged).
    const src = JSON.parse(
      readFileSync(join(home, ".peaks/skills/bees/bee-x/manifest.json"), "utf-8")
    );
    expect(src.promotion_status).toBe("stable");
  });

  it("requires --as <new-name>", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(["add-bee", "bee-x", "--segment", "seg-a", "--description", "d", "--apply"], { home });
    const r = await runSediment(["clone-bee", "bee-x", "--apply"], { home });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/--as/);
  });

  it("refuses when source bee does not exist", async () => {
    const r = await runSediment(["clone-bee", "missing", "--as", "bee-y", "--apply"], {
      home,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/BEE_NOT_FOUND/);
  });
});

describe("peaks skill sediment promote", () => {
  it("flips candidate → stable when gate passes", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(["add-bee", "bee-x", "--segment", "seg-a", "--description", "d", "--apply"], { home });
    writeFileSync(
      join(home, ".peaks/skills/bees/bee-x/run-state.json"),
      JSON.stringify({ cycles: 5, lastOutcome: "success" })
    );
    const r = await runSediment(["promote", "bee-x", "--apply"], { home });
    expect(r.ok).toBe(true);
    const m = JSON.parse(
      readFileSync(join(home, ".peaks/skills/bees/bee-x/manifest.json"), "utf-8")
    );
    expect(m.promotion_status).toBe("stable");
  });

  it("refuses when the gate fails (insufficient cycles)", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(["add-bee", "bee-x", "--segment", "seg-a", "--description", "d", "--apply"], { home });
    // No run-state.json => cycles = 0 < minCycles (1)
    const r = await runSediment(["promote", "bee-x", "--apply"], { home });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PROMOTION_GATE_FAILED/);
    // Manifest must remain candidate (no partial write).
    const m = JSON.parse(
      readFileSync(join(home, ".peaks/skills/bees/bee-x/manifest.json"), "utf-8")
    );
    expect(m.promotion_status).toBe("candidate");
  });

  it("refuses system bees with PROMOTION_SYSTEM_REFUSED", async () => {
    // Write a system-bee manifest directly (bypasses add-bee's source=user default).
    const sysDir = join(home, ".peaks/skills/bees/peaks-prd");
    mkdirSync(sysDir, { recursive: true });
    writeFileSync(
      join(sysDir, "manifest.json"),
      JSON.stringify({
        schemaVersion: "peaks.bee/1",
        name: "peaks-prd",
        source: "system",
        promotion_status: "system-stable",
        description: "d",
        segments: [],
        entrypoint: { preamble: "", refs: [] },
        promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true },
        createdBy: "llm",
        lastTouchedAt: "2026-07-04T12:00:00Z",
      })
    );
    const r = await runSediment(["promote", "peaks-prd", "--apply"], { home });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PROMOTION_SYSTEM_REFUSED/);
    // Manifest must not be mutated.
    const m = JSON.parse(readFileSync(join(sysDir, "manifest.json"), "utf-8"));
    expect(m.promotion_status).toBe("system-stable");
  });
});

describe("peaks skill sediment retire", () => {
  it("flips candidate → retired and records the reason", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(["add-bee", "bee-x", "--segment", "seg-a", "--description", "d", "--apply"], { home });
    const r = await runSediment(
      ["retire", "bee-x", "--reason", "obsolete", "--apply"],
      { home }
    );
    expect(r.ok).toBe(true);
    const m = JSON.parse(
      readFileSync(join(home, ".peaks/skills/bees/bee-x/manifest.json"), "utf-8")
    );
    expect(m.promotion_status).toBe("retired");
    expect(m.description).toContain("obsolete");
  });

  it("retires without a --reason (reason is optional)", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(["add-bee", "bee-x", "--segment", "seg-a", "--description", "d", "--apply"], { home });
    const r = await runSediment(["retire", "bee-x", "--apply"], { home });
    expect(r.ok).toBe(true);
    const m = JSON.parse(
      readFileSync(join(home, ".peaks/skills/bees/bee-x/manifest.json"), "utf-8")
    );
    expect(m.promotion_status).toBe("retired");
  });

  it("refuses system bees with RETIRE_SYSTEM_REFUSED", async () => {
    const sysDir = join(home, ".peaks/skills/bees/peaks-prd");
    mkdirSync(sysDir, { recursive: true });
    writeFileSync(
      join(sysDir, "manifest.json"),
      JSON.stringify({
        schemaVersion: "peaks.bee/1",
        name: "peaks-prd",
        source: "system",
        promotion_status: "system-stable",
        description: "d",
        segments: [],
        entrypoint: { preamble: "", refs: [] },
        promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true },
        createdBy: "llm",
        lastTouchedAt: "2026-07-04T12:00:00Z",
      })
    );
    const r = await runSediment(["retire", "peaks-prd", "--reason", "x", "--apply"], {
      home,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/RETIRE_SYSTEM_REFUSED/);
    const m = JSON.parse(readFileSync(join(sysDir, "manifest.json"), "utf-8"));
    expect(m.promotion_status).toBe("system-stable");
  });

  it("refuses when bee does not exist", async () => {
    const r = await runSediment(["retire", "missing", "--apply"], { home });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/BEE_NOT_FOUND/);
  });
});

// --- Task 15c: dispose / releases / release-show / release-diff ---

describe("peaks skill sediment dispose", () => {
  it("retain decision writes a bee_release row to state.db", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(["add-bee", "bee-x", "--segment", "seg-a", "--description", "d", "--apply"], { home });
    const scratchDir = join(home, "scratch");
    mkdirSync(scratchDir, { recursive: true });
    writeFileSync(join(scratchDir, "SKILL.md"), "## bee-x\n");
    const r = await runSediment(
      ["dispose", "bee-x", "--decision", "retain", "--scratch", scratchDir, "--version", "0.1.0", "--apply"],
      { home }
    );
    expect(r.ok).toBe(true);
    const stateDbPath = join(home, ".peaks/skills/state.db");
    expect(existsSync(stateDbPath)).toBe(true);
    const { openStateDb } = await import("../../../src/services/skillhub/sqlite-store.js");
    const db = openStateDb(stateDbPath);
    try {
      const rows = db
        .prepare("SELECT bee_name, version FROM bee_release WHERE bee_name = ?")
        .all("bee-x") as Array<{ bee_name: string; version: string }>;
      expect(rows).toEqual([{ bee_name: "bee-x", version: "0.1.0" }]);
    } finally {
      db.close();
    }
  });

  it("destroy decision is a no-op (no state.db write)", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(["add-bee", "bee-x", "--segment", "seg-a", "--description", "d", "--apply"], { home });
    const r = await runSediment(
      ["dispose", "bee-x", "--decision", "destroy", "--apply"],
      { home }
    );
    expect(r.ok).toBe(true);
    const stateDbPath = join(home, ".peaks/skills/state.db");
    if (existsSync(stateDbPath)) {
      const { openStateDb } = await import("../../../src/services/skillhub/sqlite-store.js");
      const db = openStateDb(stateDbPath);
      try {
        const rows = db.prepare("SELECT 1 FROM bee_release").all();
        expect(rows).toEqual([]);
      } finally {
        db.close();
      }
    }
  });

  it("system bee retain is refused with RETAIN_SYSTEM_REFUSED", async () => {
    const sysDir = join(home, ".peaks/skills/bees/peaks-prd");
    mkdirSync(sysDir, { recursive: true });
    writeFileSync(
      join(sysDir, "manifest.json"),
      JSON.stringify({
        schemaVersion: "peaks.bee/1",
        name: "peaks-prd",
        source: "system",
        promotion_status: "system-stable",
        description: "d",
        segments: [],
        entrypoint: { preamble: "", refs: [] },
        promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true },
        createdBy: "llm",
        lastTouchedAt: "2026-07-04T12:00:00Z",
      })
    );
    const r = await runSediment(
      ["dispose", "peaks-prd", "--decision", "retain", "--apply"],
      { home }
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/RETAIN_SYSTEM_REFUSED/);
  });

  it("system bee destroy is a silent no-op", async () => {
    const sysDir = join(home, ".peaks/skills/bees/peaks-prd");
    mkdirSync(sysDir, { recursive: true });
    writeFileSync(
      join(sysDir, "manifest.json"),
      JSON.stringify({
        schemaVersion: "peaks.bee/1",
        name: "peaks-prd",
        source: "system",
        promotion_status: "system-stable",
        description: "d",
        segments: [],
        entrypoint: { preamble: "", refs: [] },
        promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true },
        createdBy: "llm",
        lastTouchedAt: "2026-07-04T12:00:00Z",
      })
    );
    const r = await runSediment(
      ["dispose", "peaks-prd", "--decision", "destroy", "--apply"],
      { home }
    );
    expect(r.ok).toBe(true);
    const stateDbPath = join(home, ".peaks/skills/state.db");
    if (existsSync(stateDbPath)) {
      const { openStateDb } = await import("../../../src/services/skillhub/sqlite-store.js");
      const db = openStateDb(stateDbPath);
      try {
        const rows = db.prepare("SELECT 1 FROM bee_release").all();
        expect(rows).toEqual([]);
      } finally {
        db.close();
      }
    }
  });

  it("retains with default version 0.1.0 when --version not given", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(["add-bee", "bee-x", "--segment", "seg-a", "--description", "d", "--apply"], { home });
    const scratchDir = join(home, "scratch");
    mkdirSync(scratchDir, { recursive: true });
    writeFileSync(join(scratchDir, "SKILL.md"), "## bee-x\n");
    const r = await runSediment(
      ["dispose", "bee-x", "--decision", "retain", "--scratch", scratchDir, "--apply"],
      { home }
    );
    expect(r.ok).toBe(true);
    const stateDbPath = join(home, ".peaks/skills/state.db");
    const { openStateDb } = await import("../../../src/services/skillhub/sqlite-store.js");
    const db = openStateDb(stateDbPath);
    try {
      const rows = db
        .prepare("SELECT version FROM bee_release WHERE bee_name = ?")
        .all("bee-x") as Array<{ version: string }>;
      expect(rows.length).toBe(1);
      expect(rows[0]?.version).toBe("0.1.0");
    } finally {
      db.close();
    }
  });

  it("requires --decision", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(["add-bee", "bee-x", "--segment", "seg-a", "--description", "d", "--apply"], { home });
    const r = await runSediment(["dispose", "bee-x", "--apply"], { home });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/--decision/);
  });
});

describe("peaks skill sediment releases", () => {
  it("returns the list of versions for a bee after retaining", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(["add-bee", "bee-x", "--segment", "seg-a", "--description", "d", "--apply"], { home });
    const scratchDir = join(home, "scratch");
    mkdirSync(scratchDir, { recursive: true });
    writeFileSync(join(scratchDir, "SKILL.md"), "## bee-x\n");
    await runSediment(
      ["dispose", "bee-x", "--decision", "retain", "--scratch", scratchDir, "--version", "0.1.0", "--apply"],
      { home }
    );
    const r = await runSediment(["releases", "bee-x"], { home });
    expect(r.ok).toBe(true);
    const rows = r.data as Array<{ bee_name: string; version: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.bee_name).toBe("bee-x");
    expect(rows[0]?.version).toBe("0.1.0");
  });

  it("returns empty array when bee has no releases", async () => {
    const r = await runSediment(["releases", "bee-nonexistent"], { home });
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([]);
  });
});

describe("peaks skill sediment release-show", () => {
  it("returns the row + manifest + segments + files for a known version", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(["add-bee", "bee-x", "--segment", "seg-a", "--description", "d", "--apply"], { home });
    const scratchDir = join(home, "scratch");
    mkdirSync(scratchDir, { recursive: true });
    writeFileSync(join(scratchDir, "SKILL.md"), "## bee-x\n");
    await runSediment(
      ["dispose", "bee-x", "--decision", "retain", "--scratch", scratchDir, "--version", "0.1.0", "--apply"],
      { home }
    );
    const r = await runSediment(["release-show", "bee-x", "--version", "0.1.0"], { home });
    expect(r.ok).toBe(true);
    const data = r.data as {
      release: { bee_name: string; version: string };
      manifest: unknown;
      segments: unknown[];
      files: unknown[];
    };
    expect(data.release.bee_name).toBe("bee-x");
    expect(data.release.version).toBe("0.1.0");
    expect(data.manifest).toBeDefined();
    expect(Array.isArray(data.segments)).toBe(true);
    expect(Array.isArray(data.files)).toBe(true);
  });

  it("returns VERSION_NOT_FOUND for missing version", async () => {
    const r = await runSediment(["release-show", "bee-x", "--version", "9.9.9"], { home });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/VERSION_NOT_FOUND/);
  });

  it("requires --version", async () => {
    const r = await runSediment(["release-show", "bee-x"], { home });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/--version/);
  });
});

describe("peaks skill sediment release-diff", () => {
  it("returns added/removed/modified across two releases", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(["add-bee", "bee-x", "--segment", "seg-a", "--description", "d", "--apply"], { home });

    // Retain 0.1.0 with one file (retainRelease hardcodes version to 0.1.0)
    const scratch1 = join(home, "scratch1");
    mkdirSync(scratch1, { recursive: true });
    writeFileSync(join(scratch1, "SKILL.md"), "## bee-x v1\n");
    await runSediment(
      ["dispose", "bee-x", "--decision", "retain", "--scratch", scratch1, "--version", "0.1.0", "--apply"],
      { home }
    );

    // Insert a 0.2.0 release directly via SQL (UNIQUE(bee_name,version) blocks
    // a second CLI retain; releaseDiff is what we're testing here).
    const { openStateDb } = await import("../../../src/services/skillhub/sqlite-store.js");
    const stateDbPath = join(home, ".peaks/skills/state.db");
    const db = openStateDb(stateDbPath);
    try {
      const now = new Date().toISOString();
      const info = db
        .prepare(
          `INSERT INTO bee_release (bee_name, version, source, archived_at, archived_by, user_intent_raw, description, parent_version, changelog) VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?)`
        )
        .run("bee-x", "0.2.0", now, "llm", null, "d", "0.1.0", null);
      const id = info.lastInsertRowid as number;
      const sha2 = "0000000000000000000000000000000000000000000000000000000000000001";
      const sha3 = "0000000000000000000000000000000000000000000000000000000000000002";
      db.prepare(
        `INSERT INTO bee_file (release_id, owner_kind, owner_name, path, kind, size_bytes, sha256, blob_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, "bee", "bee-x", "SKILL.md", "markdown", 100, sha2, "blobs/00/0000");
      db.prepare(
        `INSERT INTO bee_file (release_id, owner_kind, owner_name, path, kind, size_bytes, sha256, blob_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, "bee", "bee-x", "extra.md", "markdown", 50, sha3, "blobs/00/0001");
    } finally {
      db.close();
    }

    const r = await runSediment(
      ["release-diff", "bee-x", "--from", "0.1.0", "--to", "0.2.0"],
      { home }
    );
    expect(r.ok).toBe(true);
    const data = r.data as { added: string[]; removed: string[]; modified: string[] };
    expect(data.added).toContain("extra.md");
    expect(data.modified).toContain("SKILL.md");
    expect(data.removed).toEqual([]);
  });

  it("returns VERSION_NOT_FOUND for missing from-version", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(["add-bee", "bee-x", "--segment", "seg-a", "--description", "d", "--apply"], { home });
    const scratchDir = join(home, "scratch");
    mkdirSync(scratchDir, { recursive: true });
    writeFileSync(join(scratchDir, "SKILL.md"), "## bee-x\n");
    await runSediment(
      ["dispose", "bee-x", "--decision", "retain", "--scratch", scratchDir, "--version", "0.1.0", "--apply"],
      { home }
    );
    const r = await runSediment(
      ["release-diff", "bee-x", "--from", "0.1.0", "--to", "9.9.9"],
      { home }
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/VERSION_NOT_FOUND/);
  });

  it("requires --from and --to", async () => {
    const r = await runSediment(["release-diff", "bee-x"], { home });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/--from/);
  });
});

// --- Task 15d: export / import / gc-blobs / search / recent / show ---

/** Seed a bee and retain a release (returns the outPath-equivalent scratch setup). */
async function seedRetainedBee(
  home: string,
  name: string,
  version: string
): Promise<{ sha: string }> {
  await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
  await runSediment(
    ["add-bee", name, "--segment", "seg-a", "--description", "test", "--apply"],
    { home }
  );
  const scratchDir = join(home, `scratch-${name}`);
  mkdirSync(scratchDir, { recursive: true });
  writeFileSync(join(scratchDir, "SKILL.md"), `## ${name}\n`);
  const r = await runSediment(
    [
      "dispose",
      name,
      "--decision",
      "retain",
      "--scratch",
      scratchDir,
      "--version",
      version,
      "--apply",
    ],
    { home }
  );
  if (!r.ok) throw new Error(`seedRetainedBee failed: ${r.error}`);

  // Read the file's sha from state.db so the gc-blobs test can reference it.
  const { openStateDb } = await import(
    "../../../src/services/skillhub/sqlite-store.js"
  );
  const db = openStateDb(join(home, ".peaks/skills/state.db"));
  try {
    const row = db
      .prepare(
        "SELECT sha256 FROM bee_file WHERE owner_name = ? ORDER BY id ASC LIMIT 1"
      )
      .get(name) as { sha256: string } | undefined;
    if (!row) throw new Error("no bee_file row written");
    return { sha: row.sha256 };
  } finally {
    db.close();
  }
}

describe("peaks skill sediment export", () => {
  it("produces a tar.gz at the given path", async () => {
    await seedRetainedBee(home, "bee-export-1", "0.1.0");
    const outPath = join(home, "out.tar.gz");
    const r = await runSediment(
      ["export", "bee-export-1", "--version", "0.1.0", "--out", outPath],
      { home }
    );
    expect(r.ok).toBe(true);
    expect(existsSync(outPath)).toBe(true);
    const data = r.data as { outPath: string };
    expect(data.outPath).toBe(outPath);
    // tar.gz non-empty (real bytes)
    const stat = (await import("node:fs")).statSync(outPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  it("returns VERSION_NOT_FOUND when the version is unknown", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(["add-bee", "bee-export-2", "--segment", "seg-a", "--apply"], { home });
    const r = await runSediment(
      ["export", "bee-export-2", "--version", "9.9.9", "--out", join(home, "x.tar.gz")],
      { home }
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/VERSION_NOT_FOUND/);
  });

  it("requires <bee-name>, --version, --out", async () => {
    const r = await runSediment(["export"], { home });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/MISSING_ARG/);
  });
});

describe("peaks skill sediment import", () => {
  it("brings a tar.gz back in as a new bee (--as)", async () => {
    await seedRetainedBee(home, "bee-import-src", "0.1.0");
    const outPath = join(home, "bundle.tar.gz");
    const exp = await runSediment(
      ["export", "bee-import-src", "--version", "0.1.0", "--out", outPath],
      { home }
    );
    expect(exp.ok).toBe(true);
    // Remove the source row so import with the original name would succeed —
    // but we test the --as path which always inserts under a new name.
    const newHome = mkdtempSync(join(tmpdir(), "peaks-import-fresh-"));
    try {
      // Seed a fresh home with the same shell but no prior release rows.
      const r = await runSediment(["import", outPath, "--as", "bee-import-dst"], {
        home: newHome,
      });
      expect(r.ok).toBe(true);
      const data = r.data as { asName: string };
      expect(data.asName).toBe("bee-import-dst");
      // The new release row should exist in the fresh home's state.db.
      const { openStateDb } = await import(
        "../../../src/services/skillhub/sqlite-store.js"
      );
      const db = openStateDb(join(newHome, ".peaks/skills/state.db"));
      try {
        const rows = db
          .prepare("SELECT bee_name, version FROM bee_release WHERE bee_name = ?")
          .all("bee-import-dst") as Array<{ bee_name: string; version: string }>;
        expect(rows).toEqual([{ bee_name: "bee-import-dst", version: "0.1.0" }]);
      } finally {
        db.close();
      }
    } finally {
      rmSync(newHome, { recursive: true, force: true });
    }
  });

  it("returns BUNDLE_NOT_FOUND when the bundle path is missing", async () => {
    const r = await runSediment(["import", join(home, "missing.tar.gz")], { home });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/BUNDLE_NOT_FOUND/);
  });
});

describe("peaks skill sediment gc-blobs", () => {
  it("--dry-run lists orphans without deleting", async () => {
    const { sha: refSha } = await seedRetainedBee(home, "bee-gc-1", "0.1.0");
    // Pre-create an orphan blob under a different SHA so it's not referenced.
    const orphanSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const orphanDir = join(home, ".peaks/skills/blobs", orphanSha.slice(0, 2));
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(join(orphanDir, orphanSha), "orphan");

    const r = await runSediment(["gc-blobs", "--dry-run"], { home });
    expect(r.ok).toBe(true);
    const data = r.data as { removed: string[] };
    expect(data.removed).toContain(orphanSha);
    // Orphan still on disk (dry-run did not delete).
    expect(existsSync(join(orphanDir, orphanSha))).toBe(true);
    // Referenced blob untouched.
    expect(existsSync(join(home, ".peaks/skills/blobs", refSha.slice(0, 2), refSha))).toBe(
      true
    );
  });

  it("default (no --dry-run) actually deletes orphans", async () => {
    const orphanSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const orphanDir = join(home, ".peaks/skills/blobs", orphanSha.slice(0, 2));
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(join(orphanDir, orphanSha), "orphan");
    expect(existsSync(join(orphanDir, orphanSha))).toBe(true);

    const r = await runSediment(["gc-blobs"], { home });
    expect(r.ok).toBe(true);
    const data = r.data as { removed: string[] };
    expect(data.removed).toContain(orphanSha);
    expect(existsSync(join(orphanDir, orphanSha))).toBe(false);
  });
});

describe("peaks skill sediment search", () => {
  it("returns bees whose description case-insensitively matches the query", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(
      [
        "add-bee",
        "bee-arxiv",
        "--segment",
        "seg-a",
        "--description",
        "fetches ArXiv oncology papers",
        "--apply",
      ],
      { home }
    );
    await runSediment(
      [
        "add-bee",
        "bee-other",
        "--segment",
        "seg-a",
        "--description",
        "fetches weather data",
        "--apply",
      ],
      { home }
    );

    // Mixed-case query: must match the upper-case "ArXiv".
    const r = await runSediment(["search", "arxiv"], { home });
    expect(r.ok).toBe(true);
    const matches = (r.data as Array<{ name: string }>).map((m) => m.name);
    expect(matches).toContain("bee-arxiv");
    expect(matches).not.toContain("bee-other");
  });

  it("also matches against the bee name itself", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(
      ["add-bee", "bee-oncology", "--segment", "seg-a", "--description", "x", "--apply"],
      { home }
    );
    const r = await runSediment(["search", "oncology"], { home });
    expect(r.ok).toBe(true);
    const matches = (r.data as Array<{ name: string }>).map((m) => m.name);
    expect(matches).toContain("bee-oncology");
  });

  it("requires <query>", async () => {
    const r = await runSediment(["search"], { home });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/MISSING_ARG/);
  });
});

describe("peaks skill sediment recent", () => {
  it("returns bees touched within the since window", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(
      ["add-bee", "bee-fresh", "--segment", "seg-a", "--description", "x", "--apply"],
      { home }
    );
    await runSediment(
      ["add-bee", "bee-stale", "--segment", "seg-a", "--description", "x", "--apply"],
      { home }
    );

    // Set the stale bee's lastTouchedAt to long ago.
    const staleManifest = join(
      home,
      ".peaks/skills/bees/bee-stale/manifest.json"
    );
    const m = JSON.parse(readFileSync(staleManifest, "utf-8"));
    m.lastTouchedAt = "2020-01-01T00:00:00Z";
    writeFileSync(staleManifest, JSON.stringify(m));

    // Window: 1 day (deterministic — current bee will be within, stale will not).
    const r = await runSediment(["recent", "--since", "1d"], { home });
    expect(r.ok).toBe(true);
    const entries = (r.data as Array<{ name: string; lastTouchedAt: string }>).map(
      (e) => e.name
    );
    expect(entries).toContain("bee-fresh");
    expect(entries).not.toContain("bee-stale");
  });

  it("requires --since Nd format", async () => {
    const r = await runSediment(["recent", "--since", "garbage"], { home });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/MISSING_ARG/);
  });
});

describe("peaks skill sediment show", () => {
  it("returns the full manifest for a bee", async () => {
    await runSediment(["add-segment", "seg-a", "--describe", "d", "--apply"], { home });
    await runSediment(
      [
        "add-bee",
        "bee-show",
        "--segment",
        "seg-a",
        "--description",
        "test desc",
        "--apply",
      ],
      { home }
    );
    const r = await runSediment(["show", "bee-show"], { home });
    expect(r.ok).toBe(true);
    const data = r.data as { name: string; description: string; source: string };
    expect(data.name).toBe("bee-show");
    expect(data.description).toBe("test desc");
    expect(data.source).toBe("user");
  });

  it("returns BEE_NOT_FOUND for missing bees", async () => {
    const r = await runSediment(["show", "bee-missing"], { home });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/BEE_NOT_FOUND/);
  });

  it("requires <name>", async () => {
    const r = await runSediment(["show"], { home });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/MISSING_ARG/);
  });
});

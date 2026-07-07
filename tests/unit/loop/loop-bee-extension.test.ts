import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateDb } from "../../../src/services/skillhub/sqlite-store.js";
import {
  LoopReleaseSchema,
  type LoopReleaseInput,
} from "../../../src/services/loop/loop-release-types.js";
import {
  ensureLoopReleaseTable,
  insertLoopRelease,
  getLoopRelease,
} from "../../../src/services/loop/loop-release-store.js";
import { retainRelease } from "../../../src/services/skillhub/release-retain.js";
import type { BeeManifest } from "../../../src/services/sediment/types.js";

/**
 * M3 — Bee Release Extension Fields
 * (plan: docs/superpowers/plans/2026-07-07-loop-engineering/m3-bee-release-extension.md
 *  spec : docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md §4.1 / §4.2)
 *
 * Scope of this test file:
 *   - Round-trip insert with ALL fields populated (the new M3 fields
 *     AND the pre-M3 fields).
 *   - Default values applied when a pre-M3 in-memory object is parsed
 *     through Zod (no breaking change).
 *   - Migration 004 is applied by `openStateDb()` (auto-loader); we
 *     additionally verify the `PRAGMA table_info` shape so a future
 *     regression in the migration is caught.
 *   - AC-3: `bee_release` only gains the two new columns; every
 *     pre-existing column is preserved unchanged.
 *   - `retainRelease` writes the new `shareable` / `desktop_visible`
 *     columns with their spec defaults (true / true).
 */

let dir = "";
let db: ReturnType<typeof openStateDb>;
let blobsDir: string;
let scratchDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "peaks-loop-bee-extension-"));
  db = openStateDb(join(dir, "state.db"));
  blobsDir = join(dir, "blobs");
  scratchDir = join(dir, "scratch");
  mkdirSync(scratchDir, { recursive: true });
  mkdirSync(blobsDir, { recursive: true });
  writeFileSync(join(scratchDir, "SKILL.md"), "## bee-m3\n");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const baseLoopInput: LoopReleaseInput = {
  id: "loop-m3-roundtrip",
  name: "M3 Round-Trip Loop",
  scenario:
    "When the operator wants to verify that M3 extension fields round-trip cleanly through the storage layer.",
  trigger_policy:
    "When the user asks to round-trip a loop_release row with the M3 fields populated.",
  success_criteria: [
    "Insert + read returns identical M3 field values",
    "Defaults apply when the M3 fields are omitted",
  ],
  interaction_policy: "human-nl-choice-only",
  feedback_policy:
    "Record which M3 combinations were tested and which defaults were applied.",
  evolution_policy:
    "Single editable asset: this loop_release row. Single dimension: schema-stability.",
  evaluator_policy: ["Schema-round-trip verifier"],
  lifecycle_status: "candidate",
  version: "0.1.0",
};

const manifest: BeeManifest = {
  schemaVersion: "peaks.bee/1",
  name: "bee-m3",
  source: "user",
  promotion_status: "candidate",
  description: "d",
  segments: [
    { name: "seg-a", inputs: [], outputs: [], sideEffects: ["net:fetch"] },
  ],
  entrypoint: { preamble: "## bee-m3", refs: [{ path: "scripts/run.sh", kind: "script" }] },
  promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true },
  createdBy: "llm",
  lastTouchedAt: "2026-07-07T12:00:00Z",
};

describe("M3 migration 004 — auto-applied by openStateDb()", () => {
  it("creates loop_release.shareable / share_excluded_paths / desktop_visible / export_bundle_format columns", () => {
    const cols = db
      .prepare("PRAGMA table_info(loop_release)")
      .all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain("shareable");
    expect(names).toContain("share_excluded_paths");
    expect(names).toContain("desktop_visible");
    expect(names).toContain("export_bundle_format");
  });

  it("creates bee_release.shareable / bee_release.desktop_visible columns (and ONLY those two)", () => {
    const cols = db
      .prepare("PRAGMA table_info(bee_release)")
      .all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    // M3 additions:
    expect(names).toContain("shareable");
    expect(names).toContain("desktop_visible");
    // AC-3: every pre-existing 4.x column is preserved unchanged.
    expect(names).toEqual(
      expect.arrayContaining([
        "id",
        "bee_name",
        "version",
        "source",
        "archived_at",
        "archived_by",
        "user_intent_raw",
        "description",
        "parent_version",
        "changelog",
      ])
    );
  });

  it("ensures shareable=1 / desktop_visible=1 / share_excluded_paths='[]' defaults at the SQLite layer", () => {
    ensureLoopReleaseTable(db);
    insertLoopRelease(
      db,
      LoopReleaseSchema.parse({
        ...baseLoopInput,
        id: "loop-m3-defaults-sql",
      }) as ReturnType<typeof LoopReleaseSchema.parse>
    );
    const raw = db
      .prepare(
        "SELECT shareable, share_excluded_paths, desktop_visible, export_bundle_format FROM loop_release WHERE id = ?"
      )
      .get("loop-m3-defaults-sql") as {
      shareable: number;
      share_excluded_paths: string;
      desktop_visible: number;
      export_bundle_format: string;
    };
    expect(raw.shareable).toBe(1);
    expect(raw.desktop_visible).toBe(1);
    expect(raw.share_excluded_paths).toBe("[]");
    expect(raw.export_bundle_format).toBe("peaks.bundle/1");
  });
});

describe("M3 Zod schema — defaults + parse contract", () => {
  it("applies default shareable=true / share_excluded_paths=[] / desktop_visible=true / export_bundle_format='peaks.bundle/1' when omitted", () => {
    // Pre-M3 in-memory shape: every M3 field is absent. The Zod
    // schema must still parse and fill in the spec defaults so an
    // existing caller that has no awareness of M3 keeps working.
    const r = LoopReleaseSchema.safeParse(baseLoopInput);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.shareable).toBe(true);
    expect(r.data.share_excluded_paths).toEqual([]);
    expect(r.data.desktop_visible).toBe(true);
    expect(r.data.export_bundle_format).toBe("peaks.bundle/1");
  });

  it("rejects a non-constant export_bundle_format", () => {
    const tampered = { ...baseLoopInput, export_bundle_format: "peaks.bundle/2" };
    const r = LoopReleaseSchema.safeParse(tampered);
    expect(r.success).toBe(false);
  });

  it("accepts share_excluded_paths as a populated string array", () => {
    const r = LoopReleaseSchema.safeParse({
      ...baseLoopInput,
      share_excluded_paths: ["private/notes.md", "state.db"],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.share_excluded_paths).toEqual([
        "private/notes.md",
        "state.db",
      ]);
    }
  });

  it("accepts shareable=false / desktop_visible=false explicitly (M3 schema-only; M7 will enforce)", () => {
    const r = LoopReleaseSchema.safeParse({
      ...baseLoopInput,
      shareable: false,
      desktop_visible: false,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.shareable).toBe(false);
      expect(r.data.desktop_visible).toBe(false);
    }
  });
});

describe("M3 store round-trip — loop_release", () => {
  it("round-trips ALL fields including the four M3 fields", () => {
    ensureLoopReleaseTable(db);
    const input: LoopReleaseInput = {
      ...baseLoopInput,
      id: "loop-m3-full",
      shareable: false,
      share_excluded_paths: [".peaks/memory/personal/", "state.db"],
      desktop_visible: false,
      export_bundle_format: "peaks.bundle/1",
    };
    const parsed = LoopReleaseSchema.parse(input) as ReturnType<typeof LoopReleaseSchema.parse>;
    insertLoopRelease(db, parsed);
    const got = getLoopRelease(db, "loop-m3-full");
    expect(got).toBeDefined();
    expect(got?.id).toBe("loop-m3-full");
    expect(got?.shareable).toBe(false);
    expect(got?.share_excluded_paths).toEqual([
      ".peaks/memory/personal/",
      "state.db",
    ]);
    expect(got?.desktop_visible).toBe(false);
    expect(got?.export_bundle_format).toBe("peaks.bundle/1");
  });

  it("round-trips a row with M3 fields omitted — defaults flow through insert and read", () => {
    ensureLoopReleaseTable(db);
    const parsed = LoopReleaseSchema.parse({
      ...baseLoopInput,
      id: "loop-m3-defaults",
    });
    insertLoopRelease(db, parsed);
    const got = getLoopRelease(db, "loop-m3-defaults");
    expect(got?.shareable).toBe(true);
    expect(got?.share_excluded_paths).toEqual([]);
    expect(got?.desktop_visible).toBe(true);
    expect(got?.export_bundle_format).toBe("peaks.bundle/1");
  });
});

describe("M3 store round-trip — bee_release", () => {
  it("retainRelease writes shareable=1 / desktop_visible=1 (spec defaults)", () => {
    const id = retainRelease({ db, blobsDir, scratchDir, manifest });
    const r = db
      .prepare("SELECT shareable, desktop_visible FROM bee_release WHERE id = ?")
      .get(id) as { shareable: number; desktop_visible: number };
    expect(r.shareable).toBe(1);
    expect(r.desktop_visible).toBe(1);
  });

  it("a pre-existing 4.x bee_release row remains readable after migration 004", () => {
    // Insert a row that simulates a pre-M3 insert: only the 4.x columns.
    // Migration 004 added DEFAULT 1 for both new columns; an INSERT
    // that lists only the pre-existing columns must still succeed
    // (the DEFAULT fills shareable / desktop_visible).
    db.prepare(
      `INSERT INTO bee_release (bee_name, version, source, archived_at, archived_by, user_intent_raw, description, parent_version, changelog)
       VALUES (?, ?, 'user', ?, 'user', ?, ?, ?, ?)`
    ).run(
      "legacy-bee-m3",
      "0.1.0",
      "2026-07-01T00:00:00Z",
      "legacy intent",
      "legacy desc",
      null,
      "legacy changelog"
    );
    const r = db
      .prepare(
        "SELECT bee_name, version, description, shareable, desktop_visible FROM bee_release WHERE bee_name = ?"
      )
      .get("legacy-bee-m3") as {
      bee_name: string;
      version: string;
      description: string;
      shareable: number;
      desktop_visible: number;
    };
    expect(r.bee_name).toBe("legacy-bee-m3");
    expect(r.version).toBe("0.1.0");
    expect(r.description).toBe("legacy desc");
    // DEFAULT 1 / 1 from migration 004.
    expect(r.shareable).toBe(1);
    expect(r.desktop_visible).toBe(1);
  });
});

describe("M3 AC-3 — non-breaking coexistence with 4.x bee_release", () => {
  it("every pre-existing 4.x column is preserved; ONLY shareable + desktop_visible are added", () => {
    // Snapshot the column set of bee_release after the migration
    // runs. This is the AC-3 anchor: the column set must be exactly
    // the 4.x columns PLUS the two new M3 columns, in that order of
    // definition (4.x first, M3 appended).
    const cols = db
      .prepare("PRAGMA table_info(bee_release)")
      .all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    // 4.x columns (from migration 001-initial.sql), unchanged.
    expect(colNames).toEqual([
      "id",
      "bee_name",
      "version",
      "source",
      "archived_at",
      "archived_by",
      "user_intent_raw",
      "description",
      "parent_version",
      "changelog",
      // M3 additions, appended at the end:
      "shareable",
      "desktop_visible",
    ]);
  });

  it("loop_release and bee_release side-by-side — neither migration modifies the other's pre-existing columns", () => {
    // Pre-existing 4.x bee_release row.
    db.prepare(
      `INSERT INTO bee_release (bee_name, version, source, archived_at, archived_by, user_intent_raw, description, parent_version, changelog)
       VALUES (?, ?, 'user', ?, 'user', ?, ?, ?, ?)`
    ).run(
      "coexist-bee",
      "0.2.0",
      "2026-06-15T00:00:00Z",
      "intent",
      "desc",
      "0.1.0",
      "changelog"
    );
    // Loop row alongside.
    ensureLoopReleaseTable(db);
    insertLoopRelease(
      db,
      LoopReleaseSchema.parse({ ...baseLoopInput, id: "loop-coexist" })
    );
    // 4.x bee_release row still reads cleanly.
    const r = db
      .prepare("SELECT * FROM bee_release WHERE bee_name = ?")
      .get("coexist-bee") as Record<string, unknown>;
    expect(r.bee_name).toBe("coexist-bee");
    expect(r.version).toBe("0.2.0");
    expect(r.parent_version).toBe("0.1.0");
    expect(r.changelog).toBe("changelog");
    expect(r.description).toBe("desc");
    // M3 defaults applied.
    expect(r.shareable).toBe(1);
    expect(r.desktop_visible).toBe(1);
    // Loop row reads cleanly with M3 defaults.
    const loopRow = db
      .prepare("SELECT * FROM loop_release WHERE id = ?")
      .get("loop-coexist") as Record<string, unknown>;
    expect(loopRow.shareable).toBe(1);
    expect(loopRow.share_excluded_paths).toBe("[]");
    expect(loopRow.desktop_visible).toBe(1);
    expect(loopRow.export_bundle_format).toBe("peaks.bundle/1");
  });
});

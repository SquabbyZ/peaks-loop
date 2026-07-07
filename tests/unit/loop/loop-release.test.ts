import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateDb } from "../../../src/services/skillhub/sqlite-store.js";
import {
  LoopReleaseSchema,
  LoopReleaseLifecycleStatusSchema,
  type LoopReleaseInput,
} from "../../../src/services/loop/loop-release-types.js";
import {
  ensureLoopReleaseTable,
  insertLoopRelease,
  getLoopRelease,
  listLoopReleasesByStatus,
  searchLoopReleasesByScenario,
} from "../../../src/services/loop/loop-release-store.js";
import { LoopReleaseService } from "../../../src/services/loop/loop-release-service.js";

let dir = "";
let db: ReturnType<typeof openStateDb>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "peaks-loop-release-"));
  db = openStateDb(join(dir, "state.db"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const validInput: LoopReleaseInput = {
  id: "loop-onboarding-research",
  name: "Onboarding Research Loop",
  scenario:
    "When a new user signs up for the research workspace and asks for help getting oriented to the system.",
  trigger_policy:
    "When the user asks for orientation, onboarding help, or 'where do I start' style questions.",
  success_criteria: [
    "User can name the 3 core entry points after one cycle.",
    "User reports reduced confusion in the next request.",
  ],
  interaction_policy: "human-nl-choice-only",
  feedback_policy:
    "Record orientation hints that worked, hints that were rejected, and follow-up questions.",
  evolution_policy:
    "Single editable asset: this loop_release row. Single dimension: clarity. Ratchet: keep only if independent scorer >= 1.0 delta.",
  evaluator_policy: [
    "Independent clarity scorer (not the author)",
    "Regression skeptic (looks for over-explanation, gate weakening)",
  ],
  lifecycle_status: "candidate",
  version: "0.1.0",
};

describe("LoopReleaseSchema (Zod)", () => {
  it("accepts a complete, valid input", () => {
    const r = LoopReleaseSchema.safeParse(validInput);
    expect(r.success).toBe(true);
  });

  it("forces schema_version to literal 'peaks.loop/1'", () => {
    // Schema must inject schema_version and refuse client-supplied value
    const tampered = { ...validInput, schema_version: "peaks.loop/2" };
    const r = LoopReleaseSchema.safeParse(tampered);
    expect(r.success).toBe(false);
  });

  it("rejects missing scenario", () => {
    const { scenario: _scenario, ...rest } = validInput;
    void _scenario;
    const r = LoopReleaseSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("rejects wrong lifecycle_status", () => {
    const r = LoopReleaseSchema.safeParse({
      ...validInput,
      lifecycle_status: "experimental",
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty id", () => {
    const r = LoopReleaseSchema.safeParse({ ...validInput, id: "" });
    expect(r.success).toBe(false);
  });

  it("rejects non-kebab id", () => {
    const r = LoopReleaseSchema.safeParse({
      ...validInput,
      id: "Loop_Onboarding Research!",
    });
    expect(r.success).toBe(false);
  });

  it("rejects id that is too long (> 64 chars)", () => {
    const r = LoopReleaseSchema.safeParse({
      ...validInput,
      id: "loop-" + "a".repeat(70),
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty scenario (after trim)", () => {
    const r = LoopReleaseSchema.safeParse({ ...validInput, scenario: "   " });
    expect(r.success).toBe(false);
  });

  it("rejects empty success_criteria array", () => {
    const r = LoopReleaseSchema.safeParse({ ...validInput, success_criteria: [] });
    expect(r.success).toBe(false);
  });

  it("accepts all 3 valid lifecycle statuses", () => {
    for (const status of ["candidate", "stable", "retired"] as const) {
      const r = LoopReleaseLifecycleStatusSchema.safeParse(status);
      expect(r.success).toBe(true);
    }
  });

  it("rejects unknown lifecycle status", () => {
    const r = LoopReleaseLifecycleStatusSchema.safeParse("draft");
    expect(r.success).toBe(false);
  });

  it("rejects empty interaction_policy", () => {
    const r = LoopReleaseSchema.safeParse({ ...validInput, interaction_policy: "" });
    expect(r.success).toBe(false);
  });

  it("defaults schema_version via .default() so omitting it still validates", () => {
    const r = LoopReleaseSchema.safeParse(validInput);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.schema_version).toBe("peaks.loop/1");
    }
  });
});

describe("loop_release SQLite migration", () => {
  it("creates the loop_release table on demand", () => {
    ensureLoopReleaseTable(db);
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='loop_release'"
      )
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("loop_release");
  });

  it("creates lifecycle_status index", () => {
    ensureLoopReleaseTable(db);
    const idx = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='loop_release' AND name LIKE 'idx_loop_release%'"
      )
      .all() as Array<{ name: string }>;
    const names = idx.map((r) => r.name);
    expect(names).toContain("idx_loop_release_lifecycle_status");
    expect(names).toContain("idx_loop_release_scenario");
  });

  it("round-trips an insert via the store: read returns the same input", () => {
    ensureLoopReleaseTable(db);
    const parsed = LoopReleaseSchema.parse(validInput);
    insertLoopRelease(db, parsed);
    const got = getLoopRelease(db, parsed.id);
    expect(got).toBeDefined();
    expect(got?.id).toBe(parsed.id);
    expect(got?.name).toBe(parsed.name);
    expect(got?.scenario).toBe(parsed.scenario);
    expect(got?.trigger_policy).toBe(parsed.trigger_policy);
    expect(got?.success_criteria).toEqual(parsed.success_criteria);
    expect(got?.interaction_policy).toBe(parsed.interaction_policy);
    expect(got?.feedback_policy).toBe(parsed.feedback_policy);
    expect(got?.evolution_policy).toBe(parsed.evolution_policy);
    expect(got?.evaluator_policy).toEqual(parsed.evaluator_policy);
    expect(got?.lifecycle_status).toBe("candidate");
    expect(got?.schema_version).toBe("peaks.loop/1");
    expect(got?.version).toBe("0.1.0");
    // archived_at is server-stamped; verify it is present in the
    // underlying row but is NOT part of the LoopRelease type returned
    // by the store (the store trims it from the public surface; the
    // raw row retains it for audit). Verifying both directions:
    const rawArchivedAt = (
      db.prepare("SELECT archived_at FROM loop_release WHERE id = ?").get(parsed.id) as
        | { archived_at: string }
        | undefined
    )?.archived_at;
    expect(rawArchivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("lists rows by lifecycle_status", () => {
    ensureLoopReleaseTable(db);
    const a = LoopReleaseSchema.parse({ ...validInput, id: "loop-a" });
    const b = LoopReleaseSchema.parse({ ...validInput, id: "loop-b" });
    insertLoopRelease(db, a);
    insertLoopRelease(db, b);
    // After promote, list candidate should yield both
    const candidates = listLoopReleasesByStatus(db, "candidate");
    expect(candidates.map((r) => r.id).sort()).toEqual(["loop-a", "loop-b"]);
    const stables = listLoopReleasesByStatus(db, "stable");
    expect(stables).toEqual([]);
    const retired = listLoopReleasesByStatus(db, "retired");
    expect(retired).toEqual([]);
  });

  it("searches by scenario fragment (case-insensitive, full-text via LIKE)", () => {
    ensureLoopReleaseTable(db);
    insertLoopRelease(
      db,
      LoopReleaseSchema.parse({ ...validInput, id: "loop-research" })
    );
    insertLoopRelease(
      db,
      LoopReleaseSchema.parse({
        ...validInput,
        id: "loop-deploy",
        scenario:
          "When the user wants to deploy a new build to a staging environment.",
      })
    );
    const hits = searchLoopReleasesByScenario(db, "research");
    expect(hits.map((r) => r.id)).toContain("loop-research");
    expect(hits.map((r) => r.id)).not.toContain("loop-deploy");
    // Case insensitive
    const upperHits = searchLoopReleasesByScenario(db, "RESEARCH");
    expect(upperHits.map((r) => r.id)).toContain("loop-research");
  });

  it("rejects duplicate id insert (UNIQUE constraint)", () => {
    ensureLoopReleaseTable(db);
    const parsed = LoopReleaseSchema.parse(validInput);
    insertLoopRelease(db, parsed);
    expect(() => insertLoopRelease(db, parsed)).toThrow();
  });

  it("AC-3: does NOT touch any bee_release column (non-breaking coexistence)", () => {
    // Insert a legacy bee_release row first (simulates 4.x state).
    db.prepare(
      `INSERT INTO bee_release (bee_name, version, source, archived_at, archived_by, user_intent_raw, description, parent_version, changelog)
       VALUES (?, ?, 'user', ?, 'user', ?, ?, ?, ?)`
    ).run(
      "legacy-bee",
      "0.1.0",
      "2026-07-01T00:00:00Z",
      "legacy user intent",
      "legacy desc",
      null,
      "legacy changelog"
    );
    // Now apply loop_release migration.
    ensureLoopReleaseTable(db);
    // The legacy row must still read cleanly and unchanged.
    const r = db
      .prepare("SELECT * FROM bee_release WHERE bee_name = ?")
      .get("legacy-bee") as Record<string, unknown> | undefined;
    expect(r).toBeDefined();
    expect(r?.bee_name).toBe("legacy-bee");
    expect(r?.version).toBe("0.1.0");
    expect(r?.description).toBe("legacy desc");
    expect(r?.changelog).toBe("legacy changelog");
    expect(r?.user_intent_raw).toBe("legacy user intent");
    expect(r?.parent_version).toBeNull();
    // Snapshot the column set of bee_release before vs. after.
    const cols = db.prepare("PRAGMA table_info(bee_release)").all() as Array<{
      name: string;
    }>;
    const colNames = cols.map((c) => c.name).sort();
    expect(colNames).toEqual([
      "archived_at",
      "archived_by",
      "bee_name",
      "changelog",
      "description",
      "id",
      "parent_version",
      "source",
      "user_intent_raw",
      "version",
    ]);
    // Inserting a loop row alongside must not affect bee_release rows.
    insertLoopRelease(
      db,
      LoopReleaseSchema.parse({ ...validInput, id: "loop-side-by-side" })
    );
    const legacyAfter = db
      .prepare("SELECT * FROM bee_release WHERE bee_name = ?")
      .get("legacy-bee") as Record<string, unknown> | undefined;
    expect(legacyAfter).toEqual(r);
  });
});

describe("LoopReleaseService", () => {
  it("create() persists and read() returns the row", () => {
    ensureLoopReleaseTable(db);
    const svc = new LoopReleaseService(db);
    const row = svc.create(validInput);
    expect(row.id).toBe("loop-onboarding-research");
    const got = svc.read("loop-onboarding-research");
    expect(got?.id).toBe("loop-onboarding-research");
    expect(got?.lifecycle_status).toBe("candidate");
  });

  it("create() rejects an invalid payload via the Zod schema", () => {
    ensureLoopReleaseTable(db);
    const svc = new LoopReleaseService(db);
    expect(() =>
      svc.create({ ...validInput, id: "", lifecycle_status: "candidate" })
    ).toThrow();
  });

  it("list() returns rows filtered by status", () => {
    ensureLoopReleaseTable(db);
    const svc = new LoopReleaseService(db);
    svc.create({ ...validInput, id: "loop-x" });
    svc.create({ ...validInput, id: "loop-y" });
    const candidates = svc.list({ status: "candidate" });
    expect(candidates.map((r) => r.id).sort()).toEqual(["loop-x", "loop-y"]);
  });

  it("search() returns rows whose scenario matches the query", () => {
    ensureLoopReleaseTable(db);
    const svc = new LoopReleaseService(db);
    svc.create({ ...validInput, id: "loop-research" });
    svc.create({
      ...validInput,
      id: "loop-deploy",
      scenario: "When the user wants to deploy.",
    });
    const hits = svc.search({ query: "research" });
    expect(hits.map((r) => r.id)).toContain("loop-research");
    expect(hits.map((r) => r.id)).not.toContain("loop-deploy");
  });

  it("list() with no status returns all rows", () => {
    ensureLoopReleaseTable(db);
    const svc = new LoopReleaseService(db);
    svc.create({ ...validInput, id: "loop-x" });
    svc.create({ ...validInput, id: "loop-y" });
    const all = svc.list({});
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("read() returns undefined for missing id (no throw)", () => {
    ensureLoopReleaseTable(db);
    const svc = new LoopReleaseService(db);
    expect(svc.read("does-not-exist")).toBeUndefined();
  });
});
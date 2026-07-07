import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateDb } from "../../../src/services/skillhub/sqlite-store.js";
import {
  LoopBeeRelationSchema,
  LoopBeeRelationInputSchema,
  LoopBeeRelationRoleSchema,
  LOOP_BEE_RELATION_ROLES,
  type LoopBeeRelationInput,
} from "../../../src/services/loop/loop-bee-relation-types.js";
import {
  ensureLoopBeeRelationTable,
} from "../../../src/services/loop/loop-bee-relation-store.js";
import { ensureLoopReleaseTable } from "../../../src/services/loop/loop-release-store.js";
import {
  LoopBeeRelationService,
  LoopBeeRelationIntegrityError,
} from "../../../src/services/loop/loop-bee-relation-service.js";
import {
  LoopReleaseSchema,
  type LoopReleaseInput,
} from "../../../src/services/loop/loop-release-types.js";

let dir = "";
let db: ReturnType<typeof openStateDb>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "peaks-loop-bee-relation-"));
  db = openStateDb(join(dir, "state.db"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/* ---------------------------------------------------------------------- */
/* Seed helpers — produce a loop + bee release rows the relation can FK to. */
/* ---------------------------------------------------------------------- */

const validLoopInput: LoopReleaseInput = {
  id: "loop-onboarding-research",
  name: "Onboarding Research Loop",
  scenario: "When a new user signs up for the research workspace.",
  trigger_policy: "When the user asks for orientation.",
  success_criteria: ["User can name the 3 core entry points after one cycle."],
  interaction_policy: "human-nl-choice-only",
  feedback_policy: "Record orientation hints that worked.",
  evolution_policy:
    "Single editable asset: this loop_release row. Single dimension: clarity.",
  evaluator_policy: ["Independent clarity scorer"],
  lifecycle_status: "candidate",
  version: "0.1.0",
};

/** Insert a loop_release row; returns its id. */
function seedLoop(
  idSuffix: string = "",
  status: "candidate" | "stable" | "retired" = "candidate"
): string {
  ensureLoopReleaseTable(db);
  const loopId = `loop-${idSuffix || "default"}`;
  const input: LoopReleaseInput = { ...validLoopInput, id: loopId, lifecycle_status: status };
  const row = LoopReleaseSchema.parse(input);
  db.prepare(
    `INSERT INTO loop_release (
       id, name, scenario, trigger_policy,
       success_criteria_json, interaction_policy, feedback_policy, evolution_policy,
       evaluator_policy_json, linked_bees_json, run_history_json, crystallization_evidence_json,
       lifecycle_status, version, schema_version, archived_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.name,
    row.scenario,
    row.trigger_policy,
    JSON.stringify(row.success_criteria),
    row.interaction_policy,
    row.feedback_policy,
    row.evolution_policy,
    JSON.stringify(row.evaluator_policy),
    JSON.stringify(row.linked_bees),
    JSON.stringify(row.run_history),
    JSON.stringify(row.crystallization_evidence),
    row.lifecycle_status,
    row.version,
    row.schema_version,
    new Date().toISOString()
  );
  return loopId;
}

/** Insert a bee_release row; returns its autoincrement id. */
function seedBee(name: string = "test-bee"): number {
  const info = db
    .prepare(
      `INSERT INTO bee_release (bee_name, version, source, archived_at, archived_by, user_intent_raw, description, parent_version, changelog)
       VALUES (?, '0.1.0', 'user', ?, 'user', ?, ?, NULL, ?)`
    )
    .run(
      name,
      new Date().toISOString(),
      `seeded for loop-bee-relation test (${name})`,
      `seeded bee ${name}`,
      `seeded changelog for ${name}`
    );
  return Number(info.lastInsertRowid);
}

const validInput: LoopBeeRelationInput = {
  loop_release_id: "loop-onboarding-research",
  bee_release_id: 1,
  role: "main",
  reason: "Primary bee — implements the loop's success_criteria.",
};

/* ---------------------------------------------------------------------- */
/* Schema tests                                                            */
/* ---------------------------------------------------------------------- */

describe("LoopBeeRelationSchema (Zod)", () => {
  it("accepts a complete, valid input (without server fields)", () => {
    const r = LoopBeeRelationInputSchema.safeParse(validInput);
    expect(r.success).toBe(true);
  });

  it("forces schema_version to literal 'peaks.loop-bee-relation/1'", () => {
    const tampered = {
      ...validInput,
      id: 1,
      created_at: new Date().toISOString(),
      schema_version: "peaks.loop-bee-relation/2",
    };
    const r = LoopBeeRelationSchema.safeParse(tampered);
    expect(r.success).toBe(false);
  });

  it("defaults schema_version via .default() so omitting it still validates", () => {
    const r = LoopBeeRelationSchema.safeParse({
      id: 1,
      ...validInput,
      created_at: new Date().toISOString(),
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.schema_version).toBe("peaks.loop-bee-relation/1");
    }
  });

  it("rejects missing role", () => {
    const { role: _role, ...rest } = validInput;
    void _role;
    const r = LoopBeeRelationInputSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("rejects wrong role value", () => {
    const r = LoopBeeRelationInputSchema.safeParse({
      ...validInput,
      role: "primary",
    });
    expect(r.success).toBe(false);
  });

  it("accepts all 4 valid roles", () => {
    expect(LOOP_BEE_RELATION_ROLES).toEqual([
      "main",
      "supporting",
      "candidate",
      "retired",
    ]);
    for (const role of LOOP_BEE_RELATION_ROLES) {
      const r = LoopBeeRelationRoleSchema.safeParse(role);
      expect(r.success).toBe(true);
    }
  });

  it("rejects unknown role", () => {
    const r = LoopBeeRelationRoleSchema.safeParse("optional");
    expect(r.success).toBe(false);
  });

  it("rejects empty reason", () => {
    const r = LoopBeeRelationInputSchema.safeParse({ ...validInput, reason: "  " });
    expect(r.success).toBe(false);
  });

  it("rejects non-kebab loop_release_id", () => {
    const r = LoopBeeRelationInputSchema.safeParse({
      ...validInput,
      loop_release_id: "Loop_Onboarding",
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-positive bee_release_id", () => {
    const r = LoopBeeRelationInputSchema.safeParse({
      ...validInput,
      bee_release_id: 0,
    });
    expect(r.success).toBe(false);
    const r2 = LoopBeeRelationInputSchema.safeParse({
      ...validInput,
      bee_release_id: -3,
    });
    expect(r2.success).toBe(false);
  });

  it("rejects non-integer bee_release_id", () => {
    const r = LoopBeeRelationInputSchema.safeParse({
      ...validInput,
      bee_release_id: 1.5,
    });
    expect(r.success).toBe(false);
  });
});

/* ---------------------------------------------------------------------- */
/* Migration / store tests                                                 */
/* ---------------------------------------------------------------------- */

describe("loop_bee_relation SQLite migration", () => {
  it("creates the loop_bee_relation table on demand", () => {
    ensureLoopBeeRelationTable(db);
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='loop_bee_relation'"
      )
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("loop_bee_relation");
  });

  it("creates the partial unique index enforcing one-main-per-loop", () => {
    ensureLoopBeeRelationTable(db);
    const idx = db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='loop_bee_relation'"
      )
      .all() as Array<{ name: string; sql: string }>;
    const names = idx.map((r) => r.name);
    expect(names).toContain("idx_loop_bee_relation_one_main_per_loop");
    expect(names).toContain("idx_loop_bee_relation_loop_id");
    expect(names).toContain("idx_loop_bee_relation_bee_id");
    expect(names).toContain("idx_loop_bee_relation_loop_role");
    const partial = idx.find((r) => r.name === "idx_loop_bee_relation_one_main_per_loop");
    expect(partial?.sql).toMatch(/WHERE role = 'main'/);
  });

  it("AC-3: does NOT touch any bee_release column (non-breaking coexistence)", () => {
    // Insert a legacy 4.x bee_release row first.
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
    // Snapshot the column set BEFORE applying the relation migration.
    const colsBefore = db.prepare("PRAGMA table_info(bee_release)").all() as Array<{
      name: string;
    }>;
    const namesBefore = colsBefore.map((c) => c.name).sort();
    // Apply the relation migration.
    ensureLoopBeeRelationTable(db);
    const colsAfter = db.prepare("PRAGMA table_info(bee_release)").all() as Array<{
      name: string;
    }>;
    const namesAfter = colsAfter.map((c) => c.name).sort();
    expect(namesAfter).toEqual(namesBefore);
    // 4.x column set must remain canonical (AC-3).
    expect(namesAfter).toEqual([
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
    // Legacy row remains readable and unchanged.
    const legacy = db
      .prepare("SELECT * FROM bee_release WHERE bee_name = ?")
      .get("legacy-bee") as Record<string, unknown> | undefined;
    expect(legacy?.bee_name).toBe("legacy-bee");
    expect(legacy?.user_intent_raw).toBe("legacy user intent");
    expect(legacy?.changelog).toBe("legacy changelog");
    expect(legacy?.parent_version).toBeNull();
  });
});

/* ---------------------------------------------------------------------- */
/* Service tests (AC-2 + integrity)                                        */
/* ---------------------------------------------------------------------- */

describe("LoopBeeRelationService — AC-2 + integrity", () => {
  it("create() persists and read() returns the row", () => {
    const loopId = seedLoop("one");
    const beeId = seedBee("bee-one");
    const svc = new LoopBeeRelationService(db);
    const row = svc.create({
      loop_release_id: loopId,
      bee_release_id: beeId,
      role: "main",
      reason: "primary bee",
    });
    expect(row.id).toBeGreaterThan(0);
    expect(row.loop_release_id).toBe(loopId);
    expect(row.bee_release_id).toBe(beeId);
    expect(row.role).toBe("main");
    expect(row.schema_version).toBe("peaks.loop-bee-relation/1");
    const got = svc.read(row.id);
    expect(got).toEqual(row);
  });

  it("AC-2: supports all four roles (main / supporting / candidate / retired)", () => {
    const loopId = seedLoop("ac2");
    const beeMain = seedBee("bee-main");
    const beeSupp = seedBee("bee-supporting");
    const beeCand = seedBee("bee-candidate");
    const beeRet = seedBee("bee-retired");
    const svc = new LoopBeeRelationService(db);
    svc.create({
      loop_release_id: loopId,
      bee_release_id: beeMain,
      role: "main",
      reason: "primary",
    });
    svc.create({
      loop_release_id: loopId,
      bee_release_id: beeSupp,
      role: "supporting",
      reason: "support",
    });
    svc.create({
      loop_release_id: loopId,
      bee_release_id: beeCand,
      role: "candidate",
      reason: "candidate",
    });
    svc.create({
      loop_release_id: loopId,
      bee_release_id: beeRet,
      role: "retired",
      reason: "retired (was main in v0)",
    });
    expect(svc.listByLoop({ loop_release_id: loopId }).length).toBe(4);
    expect(svc.listByLoop({ loop_release_id: loopId, role: "main" }).length).toBe(1);
    expect(svc.listByLoop({ loop_release_id: loopId, role: "supporting" }).length).toBe(1);
    expect(svc.listByLoop({ loop_release_id: loopId, role: "candidate" }).length).toBe(1);
    expect(svc.listByLoop({ loop_release_id: loopId, role: "retired" }).length).toBe(1);
  });

  it("integrity: a loop cannot have two main bees (TWO_MAIN_BEES)", () => {
    const loopId = seedLoop("twomain");
    const bee1 = seedBee("bee-m1");
    const bee2 = seedBee("bee-m2");
    const svc = new LoopBeeRelationService(db);
    svc.create({
      loop_release_id: loopId,
      bee_release_id: bee1,
      role: "main",
      reason: "first main",
    });
    let caught: unknown;
    try {
      svc.create({
        loop_release_id: loopId,
        bee_release_id: bee2,
        role: "main",
        reason: "second main attempt",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LoopBeeRelationIntegrityError);
    expect((caught as LoopBeeRelationIntegrityError).code).toBe("TWO_MAIN_BEES");
  });

  it("integrity: no relation to a retired loop (LOOP_RETIRED)", () => {
    const loopId = seedLoop("retired", "retired");
    const beeId = seedBee("bee-r");
    const svc = new LoopBeeRelationService(db);
    let caught: unknown;
    try {
      svc.create({
        loop_release_id: loopId,
        bee_release_id: beeId,
        role: "supporting",
        reason: "should fail",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LoopBeeRelationIntegrityError);
    expect((caught as LoopBeeRelationIntegrityError).code).toBe("LOOP_RETIRED");
  });

  it("integrity: FK to loop_release enforced (FK_LOOP_NOT_FOUND)", () => {
    const beeId = seedBee("bee-orphan");
    const svc = new LoopBeeRelationService(db);
    let caught: unknown;
    try {
      svc.create({
        loop_release_id: "loop-does-not-exist",
        bee_release_id: beeId,
        role: "supporting",
        reason: "should fail",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LoopBeeRelationIntegrityError);
    expect((caught as LoopBeeRelationIntegrityError).code).toBe("FK_LOOP_NOT_FOUND");
  });

  it("integrity: FK to bee_release enforced (FK_BEE_NOT_FOUND)", () => {
    const loopId = seedLoop("fk-bee");
    const svc = new LoopBeeRelationService(db);
    let caught: unknown;
    try {
      svc.create({
        loop_release_id: loopId,
        bee_release_id: 999_999,
        role: "supporting",
        reason: "should fail",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LoopBeeRelationIntegrityError);
    expect((caught as LoopBeeRelationIntegrityError).code).toBe("FK_BEE_NOT_FOUND");
  });

  it("integrity: duplicate (loop, bee) pair rejected (DUP_RELATION)", () => {
    const loopId = seedLoop("dup");
    const beeId = seedBee("bee-dup");
    const svc = new LoopBeeRelationService(db);
    svc.create({
      loop_release_id: loopId,
      bee_release_id: beeId,
      role: "supporting",
      reason: "first",
    });
    let caught: unknown;
    try {
      svc.create({
        loop_release_id: loopId,
        bee_release_id: beeId,
        role: "candidate",
        reason: "second attempt, same pair",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LoopBeeRelationIntegrityError);
    expect((caught as LoopBeeRelationIntegrityError).code).toBe("DUP_RELATION");
  });

  it("listByBee returns relations for the given bee across all roles", () => {
    const loopA = seedLoop("loop-a");
    const loopB = seedLoop("loop-b");
    const beeId = seedBee("shared-bee");
    const svc = new LoopBeeRelationService(db);
    svc.create({ loop_release_id: loopA, bee_release_id: beeId, role: "main", reason: "A main" });
    svc.create({ loop_release_id: loopB, bee_release_id: beeId, role: "supporting", reason: "B support" });
    const all = svc.listByBee({ bee_release_id: beeId });
    expect(all.length).toBe(2);
    expect(all.map((r) => r.loop_release_id).sort()).toEqual([loopA, loopB].sort());
    const onlyMain = svc.listByBee({ bee_release_id: beeId, role: "main" });
    expect(onlyMain.length).toBe(1);
    expect(onlyMain[0]?.loop_release_id).toBe(loopA);
  });

  it("updateRole changes a relation's role", () => {
    const loopId = seedLoop("upd");
    const beeId = seedBee("bee-upd");
    const svc = new LoopBeeRelationService(db);
    const row = svc.create({
      loop_release_id: loopId,
      bee_release_id: beeId,
      role: "supporting",
      reason: "support",
    });
    const updated = svc.updateRole(row.id, "candidate");
    expect(updated?.role).toBe("candidate");
    expect(svc.read(row.id)?.role).toBe("candidate");
  });

  it("updateRole to main on a loop that already has main throws TWO_MAIN_BEES", () => {
    const loopId = seedLoop("upd-main");
    const beeMain = seedBee("bee-main-existing");
    const beeSupp = seedBee("bee-supp-promoting");
    const svc = new LoopBeeRelationService(db);
    svc.create({ loop_release_id: loopId, bee_release_id: beeMain, role: "main", reason: "first main" });
    const supp = svc.create({
      loop_release_id: loopId,
      bee_release_id: beeSupp,
      role: "supporting",
      reason: "to be promoted",
    });
    let caught: unknown;
    try {
      svc.updateRole(supp.id, "main");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LoopBeeRelationIntegrityError);
    expect((caught as LoopBeeRelationIntegrityError).code).toBe("TWO_MAIN_BEES");
  });

  it("remove() deletes the relation and returns true on hit, false on miss", () => {
    const loopId = seedLoop("rm");
    const beeId = seedBee("bee-rm");
    const svc = new LoopBeeRelationService(db);
    const row = svc.create({
      loop_release_id: loopId,
      bee_release_id: beeId,
      role: "supporting",
      reason: "rm-test",
    });
    expect(svc.remove(row.id)).toBe(true);
    expect(svc.read(row.id)).toBeUndefined();
    expect(svc.remove(row.id)).toBe(false);
  });

  it("read() returns undefined for missing id", () => {
    const svc = new LoopBeeRelationService(db);
    expect(svc.read(999_999)).toBeUndefined();
  });

  it("create() rejects invalid input via the Zod schema", () => {
    const loopId = seedLoop("zod");
    const beeId = seedBee("bee-zod");
    const svc = new LoopBeeRelationService(db);
    expect(() =>
      svc.create({
        loop_release_id: loopId,
        bee_release_id: beeId,
        role: "primary" as unknown as "main",
        reason: "wrong role",
      })
    ).toThrow();
    expect(() =>
      svc.create({
        loop_release_id: "Bad_Id",
        bee_release_id: beeId,
        role: "main",
        reason: "non-kebab loop id",
      })
    ).toThrow();
    expect(() =>
      svc.create({
        loop_release_id: loopId,
        bee_release_id: beeId,
        role: "main",
        reason: "",
      })
    ).toThrow();
  });

  it("promote a supporting to main after the original main is retired", () => {
    const loopId = seedLoop("promote");
    const beeMain = seedBee("bee-promote-original");
    const beeSupp = seedBee("bee-promote-new");
    const svc = new LoopBeeRelationService(db);
    const main = svc.create({
      loop_release_id: loopId,
      bee_release_id: beeMain,
      role: "main",
      reason: "original main",
    });
    const supp = svc.create({
      loop_release_id: loopId,
      bee_release_id: beeSupp,
      role: "supporting",
      reason: "ready to take over",
    });
    // Retire the original main first.
    svc.updateRole(main.id, "retired");
    // Now promote supporting → main; should succeed.
    const promoted = svc.updateRole(supp.id, "main");
    expect(promoted?.role).toBe("main");
    const mains = svc.listByLoop({ loop_release_id: loopId, role: "main" });
    expect(mains.length).toBe(1);
    expect(mains[0]?.bee_release_id).toBe(beeSupp);
  });

  it("AC-3 (cross-table): legacy bee_release rows are FK-targets without alteration", () => {
    // Pre-existing 4.x bee_release row.
    db.prepare(
      `INSERT INTO bee_release (bee_name, version, source, archived_at, archived_by, user_intent_raw, description, parent_version, changelog)
       VALUES (?, ?, 'user', ?, 'user', ?, ?, ?, ?)`
    ).run(
      "legacy-target-bee",
      "0.2.5",
      "2026-06-01T00:00:00Z",
      "old user intent",
      "old desc",
      "0.2.4",
      "old changelog"
    );
    const legacyRow = db
      .prepare("SELECT id FROM bee_release WHERE bee_name = ?")
      .get("legacy-target-bee") as { id: number } | undefined;
    expect(legacyRow).toBeDefined();
    const legacyId = legacyRow!.id;
    // Apply migration + create a relation against the legacy bee.
    ensureLoopBeeRelationTable(db);
    const loopId = seedLoop("legacy-target");
    const svc = new LoopBeeRelationService(db);
    const rel = svc.create({
      loop_release_id: loopId,
      bee_release_id: legacyId,
      role: "main",
      reason: "loop now owns this legacy bee",
    });
    expect(rel.bee_release_id).toBe(legacyId);
    // Legacy row remains unchanged after the relation.
    const after = db
      .prepare("SELECT * FROM bee_release WHERE id = ?")
      .get(legacyId) as Record<string, unknown> | undefined;
    expect(after?.bee_name).toBe("legacy-target-bee");
    expect(after?.version).toBe("0.2.5");
    expect(after?.user_intent_raw).toBe("old user intent");
    expect(after?.description).toBe("old desc");
    expect(after?.parent_version).toBe("0.2.4");
    expect(after?.changelog).toBe("old changelog");
  });
});
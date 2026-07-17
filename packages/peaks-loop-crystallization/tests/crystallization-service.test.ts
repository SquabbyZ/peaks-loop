import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type DatabaseT from "better-sqlite3";
import {
  CrystallizationService,
  CrystallizationIntegrityError,
  ensureCrystallizationEventTable,
  type CrystallizationTaskState,
  type CrystallizationOptions,
} from "../src/index.js";
import type { EvidenceBrief } from "../src/index.js";
import { z } from "zod";

/* ---------------------------------------------------------------------- */
/* Inline schemas + insert helpers (slice-4 Option C dependency injection) */
/* ---------------------------------------------------------------------- */

const LoopReleaseSchemaLocal = z.object({
  id: z.string(),
  name: z.string(),
  scenario: z.string(),
  trigger_policy: z.string(),
  success_criteria: z.array(z.string()),
  interaction_policy: z.string(),
  feedback_policy: z.string(),
  evolution_policy: z.string(),
  evaluator_policy: z.array(z.string()),
  linked_bees: z.array(z.unknown()),
  run_history: z.array(z.unknown()),
  crystallization_evidence: z.array(z.unknown()),
  lifecycle_status: z.enum(["candidate", "stable", "retired"]),
  version: z.string(),
});
const LoopBeeRelationSchemaLocal = z.object({
  id: z.number().optional(),
  created_at: z.string().optional(),
  loop_release_id: z.string(),
  bee_release_id: z.number(),
  role: z.string(),
  reason: z.string(),
});

const loopInsertRelease = (db: DatabaseT.Database, row: unknown) => {
  const r = row as Record<string, unknown>;
  db.prepare(
    `INSERT INTO loop_release (id, name, scenario, trigger_policy, success_criteria_json,
      interaction_policy, feedback_policy, evolution_policy, evaluator_policy_json,
      linked_bees_json, run_history_json, crystallization_evidence_json,
      lifecycle_status, version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    r.id, r.name, r.scenario, r.trigger_policy, JSON.stringify(r.success_criteria),
    r.interaction_policy, r.feedback_policy, r.evolution_policy, JSON.stringify(r.evaluator_policy),
    JSON.stringify(r.linked_bees), JSON.stringify(r.run_history), JSON.stringify(r.crystallization_evidence),
    r.lifecycle_status, r.version, new Date().toISOString()
  );
};

const loopInsertRelation = (db: DatabaseT.Database, row: unknown) => {
  const r = row as Record<string, unknown>;
  const result = db.prepare(
    `INSERT INTO loop_bee_relation (loop_release_id, bee_release_id, role, reason, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(r.loop_release_id, r.bee_release_id, r.role, r.reason, new Date().toISOString());
  return { id: Number(result.lastInsertRowid) };
};

const testOpts: CrystallizationOptions = {
  loopReleaseSchema: LoopReleaseSchemaLocal as unknown as CrystallizationOptions["loopReleaseSchema"],
  loopBeeRelationSchema: LoopBeeRelationSchemaLocal as unknown as CrystallizationOptions["loopBeeRelationSchema"],
  insertLoopRelease: loopInsertRelease,
  insertLoopBeeRelation: loopInsertRelation,
};

/* ---------------------------------------------------------------------- */
/* Test DB setup                                                          */
/* ---------------------------------------------------------------------- */

function openTestDb(path: string): DatabaseT.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Minimal schema sufficient for crystallization tests
  db.exec(`
    CREATE TABLE IF NOT EXISTS loop_release (
      id TEXT PRIMARY KEY, name TEXT, scenario TEXT, trigger_policy TEXT,
      success_criteria_json TEXT, interaction_policy TEXT, feedback_policy TEXT,
      evolution_policy TEXT, evaluator_policy_json TEXT,
      linked_bees_json TEXT, run_history_json TEXT, crystallization_evidence_json TEXT,
      lifecycle_status TEXT, version TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS bee_release (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bee_name TEXT, version TEXT, source TEXT, archived_at TEXT,
      archived_by TEXT, user_intent_raw TEXT, description TEXT,
      parent_version TEXT, changelog TEXT, shareable INTEGER, desktop_visible INTEGER,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS bee_manifest (
      release_id INTEGER, schema_version TEXT, description TEXT, segments_json TEXT,
      entrypoint_preamble TEXT, promotion TEXT, min_cycles INTEGER,
      requires_human INTEGER, requires_smoke INTEGER, retire_on_misses INTEGER,
      FOREIGN KEY (release_id) REFERENCES bee_release(id)
    );
    CREATE TABLE IF NOT EXISTS loop_bee_relation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loop_release_id TEXT, bee_release_id INTEGER, role TEXT, reason TEXT, created_at TEXT,
      FOREIGN KEY (loop_release_id) REFERENCES loop_release(id),
      FOREIGN KEY (bee_release_id) REFERENCES bee_release(id)
    );
    CREATE TABLE IF NOT EXISTS bee_release_pointer (
      bee_name TEXT PRIMARY KEY, latest_version TEXT, released_at TEXT
    );
  `);
  ensureCrystallizationEventTable(db);
  return db;
}

let dir = "";
let db: DatabaseT.Database;
let svc: CrystallizationService;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "peaks-loop-crystallization-"));
  db = openTestDb(join(dir, "state.db"));
  svc = new CrystallizationService(db, testOpts);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function makeBrief(overrides: Partial<EvidenceBrief> = {}): EvidenceBrief {
  return {
    what_happened: "Run produced a candidate loop + main bee + crystallization event.",
    why_it_matters: "Without crystallization the asset cannot be promoted to stable.",
    what_learned: "4-section brief outperforms count-only evidence.",
    what_action: "Promote after 2 cycles.",
    ...overrides,
  };
}

function makeLoopInput(loopId: string) {
  return {
    id: loopId,
    name: `Loop ${loopId}`,
    scenario: "What real problem this loop solves.",
    trigger_policy: "When the user asks about M5.",
    success_criteria: ["crystallization_event row written", "brief has 4 sections"],
    interaction_policy: "Human-NL-Choice-Only.",
    feedback_policy: "Counts feed evidence_bullets; the brief stays NL.",
    evolution_policy: "Darwin-style ratchet: single asset + single dimension per round.",
    evaluator_policy: ["independent scorer", "regression skeptic"],
    linked_bees: [],
    run_history: [],
    crystallization_evidence: [],
    lifecycle_status: "candidate" as const,
    version: "0.1.0",
  };
}

function makeBeeInput(name: string) {
  return {
    bee_name: name,
    version: "0.1.0",
    description: `Bee ${name}`,
  };
}

describe("CrystallizationService", () => {
  it("rejects pre-run crystallization (AC-4 / RL-2)", () => {
    const task: CrystallizationTaskState = {
      task_id: "t1",
      task_status: "running",
      gates_passed: false,
      evidence_collected: false,
    };
    expect(() =>
      svc.crystallize({
        task,
        loop_input: makeLoopInput("loop-1"),
        trigger: "user_explicit",
        bee_input: makeBeeInput("bee-1"),
        bee_relation_reason: "main pairing",
        evidence_brief: makeBrief(),
      })
    ).toThrow(CrystallizationIntegrityError);
  });

  it("crystallizes a complete loop+bee+relation+event in one transaction", () => {
    const task: CrystallizationTaskState = {
      task_id: "t1",
      task_status: "completed",
      gates_passed: true,
      evidence_collected: true,
    };
    const event = svc.crystallize({
      task,
      loop_input: makeLoopInput("loop-1"),
        trigger: "user_explicit",
      bee_input: makeBeeInput("bee-1"),
      bee_relation_reason: "main pairing",
      evidence_brief: makeBrief(),
    });
    expect(event.crystallization_event_id).toBeTruthy();
    expect(event.loop_release_lifecycle_status).toBe("candidate");
  });

  it("rejects brief missing any of 4 required sections (AC-15 / RL-7)", () => {
    const task: CrystallizationTaskState = {
      task_id: "t1",
      task_status: "completed",
      gates_passed: true,
      evidence_collected: true,
    };
    expect(() =>
      svc.crystallize({
        task,
        loop_input: makeLoopInput("loop-1"),
        trigger: "user_explicit",
        bee_input: makeBeeInput("bee-1"),
        bee_relation_reason: "main pairing",
        evidence_brief: makeBrief({ what_action: "" }),
      })
    ).toThrow(CrystallizationIntegrityError);
  });
});
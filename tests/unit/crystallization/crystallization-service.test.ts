import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { openStateDb } from "../../../src/services/skillhub/sqlite-store.js";
import {
  CrystallizationService,
  CrystallizationIntegrityError,
  type CrystallizationTaskState,
} from "../../../src/services/crystallization/crystallization-service.js";
import type { EvidenceBrief } from "../../../src/services/crystallization/crystallization-types.js";

/* ---------------------------------------------------------------------- */
/* Helpers                                                                 */
/* ---------------------------------------------------------------------- */

let dir = "";
let db: Database.Database;
let svc: CrystallizationService;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "peaks-loop-crystallization-"));
  db = openStateDb(join(dir, "state.db"));
  svc = new CrystallizationService(db);
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
    description: `Main bee for ${name}`,
  };
}

function makeTask(
  overrides: Partial<{
    task_id: string;
    task_status: "completed" | "in_progress" | "failed";
    gates_passed: boolean;
    evidence_collected: boolean;
  }> = {}
): CrystallizationTaskState {
  const merged = {
    task_id: "task-1",
    task_status: "completed" as const,
    gates_passed: true as const,
    evidence_collected: true as const,
    ...overrides,
  };
  // Override can widen the literal types (e.g. task_status:
  // "in_progress" via `as unknown as "completed"`), but the
  // production schema is strict-literal; cast at the test boundary.
  return merged as unknown as CrystallizationTaskState;
}

/* ---------------------------------------------------------------------- */
/* Pre-run gate — AC-4 / RL-2                                              */
/* ---------------------------------------------------------------------- */

describe("CrystallizationService — AC-4 pre-run gate", () => {
  it("rejects when task_status is not 'completed'", () => {
    expect(() =>
      svc.crystallize({
        task: makeTask({ task_status: "in_progress" as unknown as "completed" }),
        loop_input: makeLoopInput("loop-test"),
        bee_input: makeBeeInput("bee-test"),
        bee_relation_reason: "primary bee",
        evidence_brief: makeBrief(),
        trigger: "user_explicit",
      })
    ).toThrow(CrystallizationIntegrityError);
    try {
      svc.crystallize({
        task: makeTask({ task_status: "in_progress" as unknown as "completed" }),
        loop_input: makeLoopInput("loop-test"),
        bee_input: makeBeeInput("bee-test"),
        bee_relation_reason: "primary bee",
        evidence_brief: makeBrief(),
        trigger: "user_explicit",
      });
    } catch (err) {
      expect((err as CrystallizationIntegrityError).code).toBe(
        "CRYSTALLIZATION_PRE_RUN"
      );
    }
  });

  it("rejects when gates_passed is false", () => {
    expect(() =>
      svc.crystallize({
        task: {
          task_id: "task-1",
          task_status: "completed",
          gates_passed: false as unknown as true,
          evidence_collected: true as unknown as true,
        },
        loop_input: makeLoopInput("loop-test"),
        bee_input: makeBeeInput("bee-test"),
        bee_relation_reason: "primary bee",
        evidence_brief: makeBrief(),
        trigger: "user_explicit",
      })
    ).toThrow(CrystallizationIntegrityError);
  });

  it("rejects when evidence_collected is false", () => {
    expect(() =>
      svc.crystallize({
        task: {
          task_id: "task-1",
          task_status: "completed",
          gates_passed: true as unknown as true,
          evidence_collected: false as unknown as true,
        },
        loop_input: makeLoopInput("loop-test"),
        bee_input: makeBeeInput("bee-test"),
        bee_relation_reason: "primary bee",
        evidence_brief: makeBrief(),
        trigger: "user_explicit",
      })
    ).toThrow(CrystallizationIntegrityError);
  });

  it("rejects when the brief is missing a section (AC-15 / RL-7)", () => {
    const brief = {
      what_happened: "x",
      why_it_matters: "x",
      what_learned: "x",
      // what_action missing
    } as unknown as EvidenceBrief;
    expect(() =>
      svc.crystallize({
        task: makeTask(),
        loop_input: makeLoopInput("loop-test"),
        bee_input: makeBeeInput("bee-test"),
        bee_relation_reason: "primary bee",
        evidence_brief: brief,
        trigger: "user_explicit",
      })
    ).toThrow(CrystallizationIntegrityError);
    try {
      svc.crystallize({
        task: makeTask(),
        loop_input: makeLoopInput("loop-test"),
        bee_input: makeBeeInput("bee-test"),
        bee_relation_reason: "primary bee",
        evidence_brief: brief,
        trigger: "user_explicit",
      });
    } catch (err) {
      expect((err as CrystallizationIntegrityError).code).toBe(
        "MISSING_BRIEF_SECTION"
      );
    }
  });
});

/* ---------------------------------------------------------------------- */
/* AC-6 single-transaction write + brief persisted                        */
/* ---------------------------------------------------------------------- */

describe("CrystallizationService — AC-6 single-transaction write", () => {
  it("persists loop + bee + relation + crystallization_event atomically", () => {
    const result = svc.crystallize({
      task: makeTask(),
      loop_input: makeLoopInput("loop-onboarding-research"),
      bee_input: makeBeeInput("bee-onboarding-research"),
      bee_relation_reason: "primary bee implementing the loop's success_criteria",
      evidence_brief: makeBrief(),
      evidence_bullets: ["3 phases", "2 gates passed"],
      source_trace_pointers: ["trace-1"],
      evaluator_summary: "scorer says ok",
      user_decision_summary: "user picked create",
      trigger: "user_explicit",
    });
    expect(result.loop_release_id).toBe("loop-onboarding-research");
    expect(result.bee_release_id).toBeGreaterThan(0);
    expect(result.loop_bee_relation_id).toBeGreaterThan(0);
    expect(result.crystallization_event_id).toMatch(/^crys-[0-9a-f]{12}$/);

    // AC-17: brief persisted on crystallization_event.
    const event = svc.read(result.crystallization_event_id);
    expect(event).toBeDefined();
    expect(event?.evidence_brief.what_action).toMatch(/Promote after 2 cycles/);
    expect(event?.evidence_brief.what_happened).toMatch(/candidate loop/);
    expect(event?.trigger).toBe("user_explicit");
    expect(event?.source_trace_pointers).toEqual(["trace-1"]);
    expect(event?.evaluator_summary).toBe("scorer says ok");
    expect(event?.user_decision_summary).toBe("user picked create");
    expect(event?.lifecycle_status).toBe("candidate");
    expect(event?.created_loop_release_id).toBe(result.loop_release_id);
    expect(event?.created_bee_release_id).toBe(result.bee_release_id);
  });

  it("preserves all 4 brief sections through a round-trip", () => {
    const brief = makeBrief();
    const result = svc.crystallize({
      task: makeTask(),
      loop_input: makeLoopInput("loop-round-trip"),
      bee_input: makeBeeInput("bee-round-trip"),
      bee_relation_reason: "primary bee",
      evidence_brief: brief,
      trigger: "llm_suggested",
    });
    const event = svc.read(result.crystallization_event_id);
    expect(event?.evidence_brief.what_happened).toBe(brief.what_happened);
    expect(event?.evidence_brief.why_it_matters).toBe(brief.why_it_matters);
    expect(event?.evidence_brief.what_learned).toBe(brief.what_learned);
    expect(event?.evidence_brief.what_action).toBe(brief.what_action);
  });

  it("writes all 4 lifecycle tables with the correct schema_version", () => {
    const result = svc.crystallize({
      task: makeTask(),
      loop_input: makeLoopInput("loop-lifecycle"),
      bee_input: makeBeeInput("bee-lifecycle"),
      bee_relation_reason: "primary bee",
      evidence_brief: makeBrief(),
      trigger: "success_default_prompt",
    });
    // loop_release row
    const loopRow = db
      .prepare("SELECT * FROM loop_release WHERE id = ?")
      .get(result.loop_release_id) as { schema_version: string } | undefined;
    expect(loopRow?.schema_version).toBe("peaks.loop/1");
    // loop_bee_relation row
    const relRow = db
      .prepare("SELECT * FROM loop_bee_relation WHERE id = ?")
      .get(result.loop_bee_relation_id) as
      | { schema_version: string; role: string }
      | undefined;
    expect(relRow?.schema_version).toBe("peaks.loop-bee-relation/1");
    expect(relRow?.role).toBe("main");
    // crystallization_event row
    const evtRow = db
      .prepare("SELECT * FROM crystallization_event WHERE id = ?")
      .get(result.crystallization_event_id) as
      | { schema_version: string }
      | undefined;
    expect(evtRow?.schema_version).toBe("peaks.crystallization/1");
  });
});

/* ---------------------------------------------------------------------- */
/* List / read / status                                                   */
/* ---------------------------------------------------------------------- */

describe("CrystallizationService — read / list / updateStatus", () => {
  it("list() returns all events when no filter is provided", () => {
    svc.crystallize({
      task: makeTask(),
      loop_input: makeLoopInput("loop-list-a"),
      bee_input: makeBeeInput("bee-list-a"),
      bee_relation_reason: "primary",
      evidence_brief: makeBrief(),
      trigger: "user_explicit",
    });
    svc.crystallize({
      task: makeTask({ task_id: "task-2" }),
      loop_input: makeLoopInput("loop-list-b"),
      bee_input: makeBeeInput("bee-list-b"),
      bee_relation_reason: "primary",
      evidence_brief: makeBrief(),
      trigger: "llm_suggested",
    });
    const all = svc.list();
    expect(all.length).toBe(2);
  });

  it("list({ created_loop_release_id }) filters by loop", () => {
    const a = svc.crystallize({
      task: makeTask(),
      loop_input: makeLoopInput("loop-x"),
      bee_input: makeBeeInput("bee-x"),
      bee_relation_reason: "primary",
      evidence_brief: makeBrief(),
      trigger: "user_explicit",
    });
    const filtered = svc.list({ created_loop_release_id: "loop-x" });
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.id).toBe(a.crystallization_event_id);
  });

  it("updateStatus moves lifecycle_status to retired (dispose path)", () => {
    const created = svc.crystallize({
      task: makeTask(),
      loop_input: makeLoopInput("loop-dispose"),
      bee_input: makeBeeInput("bee-dispose"),
      bee_relation_reason: "primary",
      evidence_brief: makeBrief(),
      trigger: "user_explicit",
    });
    const updated = svc.updateStatus(created.crystallization_event_id, "retired");
    expect(updated?.lifecycle_status).toBe("retired");
  });
});

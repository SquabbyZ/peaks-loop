import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateDb } from "../../../src/services/skillhub/sqlite-store.js";
import {
  EvolutionService,
  EvolutionIntegrityError,
} from "../../../src/services/evolution/evolution-service.js";
import type {
  EvolutionProposalInput,
  IndependentEvaluatorResult,
  RegressionSkepticResult,
} from "../../../src/services/evolution/evolution-types.js";

let dir = "";
let db: ReturnType<typeof openStateDb>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "peaks-loop-evolution-"));
  db = openStateDb(join(dir, "state.db"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/* ---------------------------------------------------------------------- */
/* Helpers                                                                 */
/* ---------------------------------------------------------------------- */

function baseInput(overrides: Partial<EvolutionProposalInput> = {}): EvolutionProposalInput {
  return {
    target_kind: "loop",
    target_release_id: "loop-1",
    optimization_dimension: "clarity",
    before_snapshot: {},
    after_snapshot: {},
    diff: {},
    before_score: 5.0,
    after_score: 8.0,
    score_delta_min: 1.0,
    author_id: "author-agent-1",
    single_object: true,
    single_optimization_dimension: true,
    rubric: {},
    red_lines: [],
    source_traces: [],
    ...overrides,
  };
}

function makeEvaluatorResult(score: number): IndependentEvaluatorResult {
  return {
    score,
    riskTags: [],
    refuteParagraph: "Independent context refute paragraph.",
  };
}

function makeSkepticResult(overrides: Partial<RegressionSkepticResult> = {}): RegressionSkepticResult {
  return {
    driftRisks: [],
    overfitRisks: [],
    safetyRegressionRisks: [],
    ...overrides,
  };
}

/* ---------------------------------------------------------------------- */
/* AC-8: single object / single dimension                                  */
/* ---------------------------------------------------------------------- */

describe("EvolutionService — AC-8 single object / single dimension", () => {
  it("rejects proposals that violate single_object", () => {
    const svc = new EvolutionService(db);
    // The Zod schema already enforces `single_object: literal(true)`;
    // a service-level test exercises the defense-in-depth path.
    const tampered = baseInput();
    // Bypass the Zod literal by mutating after parse.
    (tampered as unknown as { single_object: boolean }).single_object = false;
    expect(() => svc.createProposal(tampered)).toThrow(EvolutionIntegrityError);
    try {
      svc.createProposal(tampered);
    } catch (err) {
      expect(err).toBeInstanceOf(EvolutionIntegrityError);
      expect((err as EvolutionIntegrityError).code).toBe("EVOLUTION_MULTI_OBJECT");
    }
  });

  it("rejects proposals that violate single_optimization_dimension", () => {
    const svc = new EvolutionService(db);
    const tampered = baseInput();
    (tampered as unknown as { single_optimization_dimension: boolean }).single_optimization_dimension = false;
    expect(() => svc.createProposal(tampered)).toThrow(EvolutionIntegrityError);
    try {
      svc.createProposal(tampered);
    } catch (err) {
      expect(err).toBeInstanceOf(EvolutionIntegrityError);
      expect((err as EvolutionIntegrityError).code).toBe("EVOLUTION_MULTI_DIMENSION");
    }
  });

  it("accepts a valid single-object / single-dimension proposal", () => {
    const svc = new EvolutionService(db);
    const proposal = svc.createProposal(baseInput());
    expect(proposal.target_count).toBe(1);
    expect(proposal.dimensions.length).toBe(1);
    expect(proposal.single_object).toBe(true);
    expect(proposal.single_optimization_dimension).toBe(true);
    expect(proposal.score_delta).toBe(3.0);
  });
});

/* ---------------------------------------------------------------------- */
/* AC-10: no self-score                                                    */
/* ---------------------------------------------------------------------- */

describe("EvolutionService — AC-10 no self-score", () => {
  it("rejects when evaluator_id === author_id", () => {
    const svc = new EvolutionService(db);
    const proposal = svc.createProposal(baseInput({ author_id: "agent-1" }));
    expect(() =>
      svc.score(proposal.id, {
        evaluator_id: "agent-1",
        skeptic_id: "agent-2",
        evaluator_result: makeEvaluatorResult(7.0),
        skeptic_result: makeSkepticResult(),
      })
    ).toThrow(EvolutionIntegrityError);
    try {
      svc.score(proposal.id, {
        evaluator_id: "agent-1",
        skeptic_id: "agent-2",
        evaluator_result: makeEvaluatorResult(7.0),
        skeptic_result: makeSkepticResult(),
      });
    } catch (err) {
      expect((err as EvolutionIntegrityError).code).toBe("EVOLUTION_SELF_SCORE");
    }
  });

  it("rejects when skeptic_id === author_id", () => {
    const svc = new EvolutionService(db);
    const proposal = svc.createProposal(baseInput({ author_id: "agent-1" }));
    expect(() =>
      svc.score(proposal.id, {
        evaluator_id: "agent-2",
        skeptic_id: "agent-1",
        evaluator_result: makeEvaluatorResult(7.0),
        skeptic_result: makeSkepticResult(),
      })
    ).toThrow(EvolutionIntegrityError);
  });

  it("rejects when skeptic_id === evaluator_id", () => {
    const svc = new EvolutionService(db);
    const proposal = svc.createProposal(baseInput({ author_id: "agent-1" }));
    expect(() =>
      svc.score(proposal.id, {
        evaluator_id: "agent-2",
        skeptic_id: "agent-2",
        evaluator_result: makeEvaluatorResult(7.0),
        skeptic_result: makeSkepticResult(),
      })
    ).toThrow(EvolutionIntegrityError);
  });

  it("accepts when all three ids differ", () => {
    const svc = new EvolutionService(db);
    const proposal = svc.createProposal(baseInput({ author_id: "agent-1" }));
    const result = svc.score(proposal.id, {
      evaluator_id: "agent-2",
      skeptic_id: "agent-3",
      evaluator_result: makeEvaluatorResult(7.0),
      skeptic_result: makeSkepticResult(),
    });
    expect(result.evaluator_id).toBe("agent-2");
    expect(result.skeptic_id).toBe("agent-3");
  });
});

/* ---------------------------------------------------------------------- */
/* AC-11: delta threshold                                                  */
/* ---------------------------------------------------------------------- */

describe("EvolutionService — AC-11 score-delta threshold", () => {
  it("auto-derives verdict='revert' when score_delta < score_delta_min (default 1.0)", () => {
    const svc = new EvolutionService(db);
    const proposal = svc.createProposal(
      baseInput({ before_score: 7.0, after_score: 7.5 }) // delta=0.5 < 1.0
    );
    const result = svc.score(proposal.id, {
      evaluator_id: "agent-2",
      skeptic_id: "agent-3",
      evaluator_result: makeEvaluatorResult(7.5),
      skeptic_result: makeSkepticResult(),
    });
    expect(result.verdict).toBe("revert");
  });

  it("rejects explicit markVerdict('keep') when score_delta < score_delta_min (AC-11)", () => {
    const svc = new EvolutionService(db);
    const proposal = svc.createProposal(
      baseInput({ before_score: 7.0, after_score: 7.5 })
    );
    svc.score(proposal.id, {
      evaluator_id: "agent-2",
      skeptic_id: "agent-3",
      evaluator_result: makeEvaluatorResult(7.5),
      skeptic_result: makeSkepticResult(),
    });
    expect(() => svc.markVerdict(proposal.id, "keep", "user-choice-1")).toThrow(
      EvolutionIntegrityError
    );
    try {
      svc.markVerdict(proposal.id, "keep", "user-choice-1");
    } catch (err) {
      expect((err as EvolutionIntegrityError).code).toBe(
        "EVOLUTION_DELTA_BELOW_THRESHOLD"
      );
    }
  });

  it("allows markVerdict('keep') when score_delta >= score_delta_min and user_confirmation_pointer is set", () => {
    const svc = new EvolutionService(db);
    const proposal = svc.createProposal(baseInput()); // delta=3.0 >= 1.0
    svc.score(proposal.id, {
      evaluator_id: "agent-2",
      skeptic_id: "agent-3",
      evaluator_result: makeEvaluatorResult(8.0),
      skeptic_result: makeSkepticResult(),
    });
    const updated = svc.markVerdict(proposal.id, "keep", "user-choice-1");
    expect(updated?.verdict).toBe("keep");
    expect(updated?.user_confirmation_pointer).toBe("user-choice-1");
  });

  it("rejects markVerdict('keep') without user_confirmation_pointer (AC-15)", () => {
    const svc = new EvolutionService(db);
    const proposal = svc.createProposal(baseInput());
    svc.score(proposal.id, {
      evaluator_id: "agent-2",
      skeptic_id: "agent-3",
      evaluator_result: makeEvaluatorResult(8.0),
      skeptic_result: makeSkepticResult(),
    });
    expect(() => svc.markVerdict(proposal.id, "keep")).toThrow(
      EvolutionIntegrityError
    );
  });
});

/* ---------------------------------------------------------------------- */
/* Skeptic blocker                                                         */
/* ---------------------------------------------------------------------- */

describe("EvolutionService — skeptic blocker", () => {
  it("auto-derives verdict='revert' when skeptic emits a blocker", () => {
    const svc = new EvolutionService(db);
    const proposal = svc.createProposal(baseInput());
    const result = svc.score(proposal.id, {
      evaluator_id: "agent-2",
      skeptic_id: "agent-3",
      evaluator_result: makeEvaluatorResult(8.0),
      skeptic_result: makeSkepticResult({ blocker: "safety_regression" }),
    });
    expect(result.verdict).toBe("revert");
  });
});

/* ---------------------------------------------------------------------- */
/* Read / list / status                                                    */
/* ---------------------------------------------------------------------- */

describe("EvolutionService — read / list / status", () => {
  it("read() returns the row", () => {
    const svc = new EvolutionService(db);
    const proposal = svc.createProposal(baseInput());
    const got = svc.read(proposal.id);
    expect(got?.id).toBe(proposal.id);
  });

  it("listByTarget returns rows for the target", () => {
    const svc = new EvolutionService(db);
    const a = svc.createProposal(baseInput({ target_release_id: "loop-A" }));
    const b = svc.createProposal(baseInput({ target_release_id: "loop-B" }));
    const listA = svc.listByTarget({
      target_kind: "loop",
      target_release_id: "loop-A",
    });
    expect(listA.map((r) => r.id)).toContain(a.id);
    expect(listA.map((r) => r.id)).not.toContain(b.id);
  });

  it("status returns counts by verdict", () => {
    const svc = new EvolutionService(db);
    const a = svc.createProposal(baseInput({ target_release_id: "loop-A" }));
    svc.score(a.id, {
      evaluator_id: "agent-2",
      skeptic_id: "agent-3",
      evaluator_result: makeEvaluatorResult(8.0),
      skeptic_result: makeSkepticResult(),
    });
    svc.markVerdict(a.id, "keep", "user-choice-1");
    const status = svc.status({
      target_kind: "loop",
      target_release_id: "loop-A",
    });
    expect(status.byVerdict.keep).toBe(1);
    expect(status.total).toBe(1);
  });
});

/* ---------------------------------------------------------------------- */
/* Revert                                                                  */
/* ---------------------------------------------------------------------- */

describe("EvolutionService — revert", () => {
  it("revert() is always allowed and sets verdict='revert'", () => {
    const svc = new EvolutionService(db);
    const proposal = svc.createProposal(baseInput());
    const updated = svc.revert(proposal.id, "user-choice-revert");
    expect(updated?.verdict).toBe("revert");
    expect(updated?.user_confirmation_pointer).toBe("user-choice-revert");
  });

  it("revert() returns undefined for unknown id", () => {
    const svc = new EvolutionService(db);
    expect(svc.revert("eval-deadbeefdead")).toBeUndefined();
  });
});

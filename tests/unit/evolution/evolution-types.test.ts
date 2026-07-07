import { describe, expect, it } from "vitest";
import {
  EvolutionEvaluationSchema,
  EvolutionProposalInputSchema,
  EvolutionProposalSchema,
  EvolutionTargetKindSchema,
  EvolutionVerdictSchema,
  EVOLUTION_DEFAULT_DELTA_MIN,
  EVOLUTION_TARGET_KINDS,
  EVOLUTION_VERDICTS,
  parseEvolutionEvaluation,
  parseEvolutionProposal,
  safeParseEvolutionEvaluation,
  type EvolutionProposalInput,
} from "../../../src/services/evolution/evolution-types.js";

/* ---------------------------------------------------------------------- */
/* Target kind / verdict unions                                            */
/* ---------------------------------------------------------------------- */

describe("EvolutionTargetKindSchema / EVOLUTION_TARGET_KINDS", () => {
  it("accepts all 5 spec kinds", () => {
    expect(EVOLUTION_TARGET_KINDS).toEqual([
      "loop",
      "bee",
      "policy",
      "gate",
      "evaluator",
    ]);
    for (const k of EVOLUTION_TARGET_KINDS) {
      expect(EvolutionTargetKindSchema.safeParse(k).success).toBe(true);
    }
  });

  it("rejects unknown kinds", () => {
    expect(EvolutionTargetKindSchema.safeParse("workflow").success).toBe(false);
    expect(EvolutionTargetKindSchema.safeParse("").success).toBe(false);
  });
});

describe("EvolutionVerdictSchema / EVOLUTION_VERDICTS", () => {
  it("accepts all 3 verdicts", () => {
    expect(EVOLUTION_VERDICTS).toEqual([
      "keep",
      "revert",
      "needs-user-decision",
    ]);
    for (const v of EVOLUTION_VERDICTS) {
      expect(EvolutionVerdictSchema.safeParse(v).success).toBe(true);
    }
  });

  it("rejects unknown verdicts", () => {
    expect(EvolutionVerdictSchema.safeParse("approve").success).toBe(false);
    expect(EvolutionVerdictSchema.safeParse("").success).toBe(false);
  });
});

/* ---------------------------------------------------------------------- */
/* Proposal input                                                          */
/* ---------------------------------------------------------------------- */

const validInput: EvolutionProposalInput = {
  target_kind: "loop",
  target_release_id: "loop-onboarding-research",
  optimization_dimension: "clarity",
  before_snapshot: { coverage: 0.6 },
  after_snapshot: { coverage: 0.85 },
  diff: { coverage: { from: 0.6, to: 0.85 } },
  before_score: 6.0,
  after_score: 8.0,
  score_delta_min: 1.0,
  author_id: "author-agent-1",
  single_object: true,
  single_optimization_dimension: true,
  rubric: { clarity: 0.7 },
  red_lines: ["Human-NL-Choice-Only"],
  source_traces: ["trace-001", "trace-002"],
};

describe("EvolutionProposalInputSchema", () => {
  it("accepts a complete, valid input", () => {
    const r = EvolutionProposalInputSchema.safeParse(validInput);
    expect(r.success).toBe(true);
  });

  it("applies default score_delta_min = 1.0 (spec §6.1 #5)", () => {
    const { score_delta_min: _omit, ...rest } = validInput;
    void _omit;
    const r = EvolutionProposalInputSchema.parse(rest);
    expect(r.score_delta_min).toBe(EVOLUTION_DEFAULT_DELTA_MIN);
  });

  it("forces single_object to literal true (AC-8)", () => {
    const tampered = { ...validInput, single_object: false as const };
    const r = EvolutionProposalInputSchema.safeParse(tampered);
    expect(r.success).toBe(false);
  });

  it("forces single_optimization_dimension to literal true (AC-8)", () => {
    const tampered = { ...validInput, single_optimization_dimension: false as const };
    const r = EvolutionProposalInputSchema.safeParse(tampered);
    expect(r.success).toBe(false);
  });

  it("rejects empty optimization_dimension", () => {
    const r = EvolutionProposalInputSchema.safeParse({
      ...validInput,
      optimization_dimension: "   ",
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-finite scores", () => {
    const r1 = EvolutionProposalInputSchema.safeParse({
      ...validInput,
      before_score: Number.POSITIVE_INFINITY,
    });
    expect(r1.success).toBe(false);
    const r2 = EvolutionProposalInputSchema.safeParse({
      ...validInput,
      after_score: Number.NaN,
    });
    expect(r2.success).toBe(false);
  });

  it("rejects out-of-range scores", () => {
    const r1 = EvolutionProposalInputSchema.safeParse({
      ...validInput,
      before_score: -0.1,
    });
    expect(r1.success).toBe(false);
    const r2 = EvolutionProposalInputSchema.safeParse({
      ...validInput,
      after_score: 10.1,
    });
    expect(r2.success).toBe(false);
  });

  it("rejects empty author_id", () => {
    const r = EvolutionProposalInputSchema.safeParse({
      ...validInput,
      author_id: "  ",
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative score_delta_min", () => {
    const r = EvolutionProposalInputSchema.safeParse({
      ...validInput,
      score_delta_min: -0.1,
    });
    expect(r.success).toBe(false);
  });
});

describe("EvolutionProposalSchema (persisted)", () => {
  it("requires exactly one dimension (AC-8)", () => {
    const r = EvolutionProposalSchema.safeParse({
      id: "eval-1234567890ab",
      target_kind: "loop",
      target_release_id: "loop-1",
      optimization_dimension: "clarity",
      dimensions: ["clarity", "speed"],
      target_count: 1,
      single_object: true,
      single_optimization_dimension: true,
      before_snapshot: {},
      after_snapshot: {},
      diff: {},
      before_score: 5.0,
      after_score: 7.0,
      score_delta_min: 1.0,
      score_delta: 2.0,
      author_id: "author-1",
      rubric: {},
      red_lines: [],
      source_traces: [],
      schema_version: "peaks.evolution/1",
      created_at: new Date().toISOString(),
    });
    expect(r.success).toBe(false);
  });

  it("forces target_count to literal 1 (AC-8)", () => {
    const r = EvolutionProposalSchema.safeParse({
      id: "eval-1234567890ab",
      target_kind: "loop",
      target_release_id: "loop-1",
      optimization_dimension: "clarity",
      dimensions: ["clarity"],
      target_count: 2,
      single_object: true,
      single_optimization_dimension: true,
      before_snapshot: {},
      after_snapshot: {},
      diff: {},
      before_score: 5.0,
      after_score: 7.0,
      score_delta_min: 1.0,
      score_delta: 2.0,
      author_id: "author-1",
      rubric: {},
      red_lines: [],
      source_traces: [],
      schema_version: "peaks.evolution/1",
      created_at: new Date().toISOString(),
    });
    expect(r.success).toBe(false);
  });

  it("forces schema_version to 'peaks.evolution/1'", () => {
    const r = EvolutionProposalSchema.safeParse({
      id: "eval-1234567890ab",
      target_kind: "loop",
      target_release_id: "loop-1",
      optimization_dimension: "clarity",
      dimensions: ["clarity"],
      target_count: 1,
      single_object: true,
      single_optimization_dimension: true,
      before_snapshot: {},
      after_snapshot: {},
      diff: {},
      before_score: 5.0,
      after_score: 7.0,
      score_delta_min: 1.0,
      score_delta: 2.0,
      author_id: "author-1",
      rubric: {},
      red_lines: [],
      source_traces: [],
      schema_version: "peaks.evolution/2",
      created_at: new Date().toISOString(),
    });
    expect(r.success).toBe(false);
  });

  it("parseEvolutionProposal throws on bad input", () => {
    expect(() => parseEvolutionProposal({})).toThrow();
  });
});

/* ---------------------------------------------------------------------- */
/* Evaluation schema                                                       */
/* ---------------------------------------------------------------------- */

describe("EvolutionEvaluationSchema", () => {
  function buildEvaluation(overrides: Record<string, unknown> = {}) {
    return {
      id: "eval-1234567890ab",
      proposal: {
        id: "eval-1234567890ab",
        target_kind: "loop",
        target_release_id: "loop-1",
        optimization_dimension: "clarity",
        dimensions: ["clarity"],
        target_count: 1,
        single_object: true,
        single_optimization_dimension: true,
        before_snapshot: {},
        after_snapshot: {},
        diff: {},
        before_score: 5.0,
        after_score: 7.0,
        score_delta_min: 1.0,
        score_delta: 2.0,
        author_id: "author-1",
        rubric: {},
        red_lines: [],
        source_traces: [],
        schema_version: "peaks.evolution/1",
        created_at: new Date().toISOString(),
      },
      evaluator_id: "evaluator-1",
      skeptic_id: "skeptic-1",
      evaluator_result: {
        score: 7.0,
        riskTags: [],
        refuteParagraph: "Looks good.",
      },
      skeptic_result: {
        driftRisks: [],
        overfitRisks: [],
        safetyRegressionRisks: [],
      },
      verdict: "needs-user-decision",
      schema_version: "peaks.evolution/1",
      created_at: new Date().toISOString(),
      score_delta: 2.0,
      ...overrides,
    };
  }

  it("accepts a complete valid evaluation", () => {
    const r = EvolutionEvaluationSchema.safeParse(buildEvaluation());
    expect(r.success).toBe(true);
  });

  it("rejects when evaluator_id is missing", () => {
    const r = EvolutionEvaluationSchema.safeParse(
      buildEvaluation({ evaluator_id: "" })
    );
    expect(r.success).toBe(false);
  });

  it("rejects when skeptic_id is missing", () => {
    const r = EvolutionEvaluationSchema.safeParse(
      buildEvaluation({ skeptic_id: "  " })
    );
    expect(r.success).toBe(false);
  });

  it("rejects when evaluator_result.refuteParagraph is empty", () => {
    const r = EvolutionEvaluationSchema.safeParse(
      buildEvaluation({
        evaluator_result: { score: 7.0, riskTags: [], refuteParagraph: "" },
      })
    );
    expect(r.success).toBe(false);
  });

  it("rejects when verdict is unknown", () => {
    const r = EvolutionEvaluationSchema.safeParse(
      buildEvaluation({ verdict: "approve" })
    );
    expect(r.success).toBe(false);
  });

  it("parseEvolutionEvaluation throws on bad input", () => {
    expect(() => parseEvolutionEvaluation({})).toThrow();
  });

  it("safeParseEvolutionEvaluation returns a findings list on failure", () => {
    const r = safeParseEvolutionEvaluation({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.findings.length).toBeGreaterThan(0);
    }
  });
});

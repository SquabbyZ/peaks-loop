import { describe, expect, it } from "vitest";
import {
  buildSkepticPrompt,
  deterministicInvokeSkepticLlm,
  runRegressionSkeptic,
  type SkepticLlmInvoke,
} from "../../../src/services/evolution/regression-skeptic-runner.js";
import {
  buildProposal,
  newEvaluationId,
} from "../../../src/services/evolution/evolution-store.js";
import type {
  EvolutionProposal,
  EvolutionProposalInput,
  IndependentEvaluatorResult,
} from "../../../src/services/evolution/evolution-types.js";

/* ---------------------------------------------------------------------- */
/* Helpers                                                                 */
/* ---------------------------------------------------------------------- */

function baseProposal(overrides: Partial<EvolutionProposalInput> = {}): EvolutionProposal {
  const input: EvolutionProposalInput = {
    target_kind: "loop",
    target_release_id: "loop-1",
    optimization_dimension: "clarity",
    before_snapshot: {},
    after_snapshot: {},
    diff: {},
    before_score: 5.0,
    after_score: 8.0,
    score_delta_min: 1.0,
    author_id: "author-1",
    single_object: true,
    single_optimization_dimension: true,
    rubric: {},
    red_lines: [],
    source_traces: [],
    ...overrides,
  };
  return buildProposal(newEvaluationId(), input, "2026-07-07T00:00:00.000Z");
}

const baseEvaluatorResult: IndependentEvaluatorResult = {
  score: 8.0,
  riskTags: [],
  refuteParagraph: "Independent context refute paragraph.",
};

/* ---------------------------------------------------------------------- */
/* AC-14: skeptic is a separate sub-agent                                  */
/* ---------------------------------------------------------------------- */

describe("RegressionSkepticRunner — AC-14 separate sub-agent", () => {
  it("default skeptic produces drift/overfit/safety lists", async () => {
    const proposal = baseProposal();
    const result = await runRegressionSkeptic(
      proposal,
      "needs-user-decision",
      baseEvaluatorResult,
      deterministicInvokeSkepticLlm
    );
    expect(Array.isArray(result.driftRisks)).toBe(true);
    expect(Array.isArray(result.overfitRisks)).toBe(true);
    expect(Array.isArray(result.safetyRegressionRisks)).toBe(true);
  });

  it("emits drift risk when red_lines are present but unaddressed", async () => {
    const proposal = baseProposal({ red_lines: ["Human-NL-Choice-Only"] });
    const result = await runRegressionSkeptic(
      proposal,
      "needs-user-decision",
      baseEvaluatorResult,
      deterministicInvokeSkepticLlm
    );
    expect(result.driftRisks.length).toBeGreaterThan(0);
    expect(result.driftRisks[0]).toContain("Human-NL-Choice-Only");
  });

  it("emits overfit risk for prompt_template changes without a rubric counter", async () => {
    const proposal = baseProposal({ diff: { prompt_template: "new" } });
    const result = await runRegressionSkeptic(
      proposal,
      "needs-user-decision",
      baseEvaluatorResult,
      deterministicInvokeSkepticLlm
    );
    expect(result.overfitRisks.length).toBeGreaterThan(0);
    expect(result.overfitRisks[0]).toMatch(/prompt inflation|gate weakening/);
  });

  it("emits a blocker when a red_line is dropped (safety regression)", async () => {
    const proposal = baseProposal({
      after_snapshot: { dropped_red_lines: ["Human-NL-Choice-Only"] },
    });
    const result = await runRegressionSkeptic(
      proposal,
      "needs-user-decision",
      baseEvaluatorResult,
      deterministicInvokeSkepticLlm
    );
    expect(result.safetyRegressionRisks.length).toBeGreaterThan(0);
    expect(result.blocker).toBeDefined();
    expect(result.blocker).toContain("safety_regression");
  });

  it("does NOT emit a blocker when there is no drift / overfit / safety regression", async () => {
    const proposal = baseProposal();
    const result = await runRegressionSkeptic(
      proposal,
      "needs-user-decision",
      baseEvaluatorResult,
      deterministicInvokeSkepticLlm
    );
    expect(result.blocker).toBeUndefined();
  });

  it("a custom LLM call can override the default", async () => {
    const proposal = baseProposal();
    const stub: SkepticLlmInvoke = async () => ({
      driftRisks: ["custom-drift"],
      overfitRisks: [],
      safetyRegressionRisks: [],
      blocker: "custom-blocker",
    });
    const result = await runRegressionSkeptic(
      proposal,
      "needs-user-decision",
      baseEvaluatorResult,
      stub
    );
    expect(result.driftRisks).toContain("custom-drift");
    expect(result.blocker).toBe("custom-blocker");
  });

  it("buildSkepticPrompt contains the verdict and evaluator result but no author identity", () => {
    const proposal = baseProposal();
    const pkg = {
      target_kind: proposal.target_kind,
      target_release_id: proposal.target_release_id,
      optimization_dimension: proposal.optimization_dimension,
      before_snapshot: proposal.before_snapshot,
      after_snapshot: proposal.after_snapshot,
      diff: proposal.diff,
      rubric: proposal.rubric,
      red_lines: proposal.red_lines,
      source_traces: proposal.source_traces,
    };
    const prompt = buildSkepticPrompt(pkg, "needs-user-decision", baseEvaluatorResult);
    expect(prompt).toContain("REFUTE");
    expect(prompt).toContain("needs-user-decision");
    expect(prompt).toContain("Independent context refute paragraph");
    expect(prompt).not.toContain("author-1");
  });
});

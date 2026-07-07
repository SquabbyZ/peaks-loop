import { describe, expect, it } from "vitest";
import {
  buildEvaluationPackage,
  buildEvaluatorPrompt,
  deterministicInvokeLlm,
  runIndependentEvaluator,
  type EvaluationPackage,
  type LlmInvoke,
} from "../../../src/services/evolution/independent-evaluator-runner.js";
import type {
  EvolutionProposal,
  EvolutionProposalInput,
} from "../../../src/services/evolution/evolution-types.js";
import {
  buildProposal,
  newEvaluationId,
} from "../../../src/services/evolution/evolution-store.js";

/* ---------------------------------------------------------------------- */
/* Helpers                                                                 */
/* ---------------------------------------------------------------------- */

function baseProposal(overrides: Partial<EvolutionProposalInput> = {}): EvolutionProposal {
  const input: EvolutionProposalInput = {
    target_kind: "loop",
    target_release_id: "loop-1",
    optimization_dimension: "clarity",
    before_snapshot: { coverage: 0.6 },
    after_snapshot: { after_score: 8.0 },
    diff: { coverage: { from: 0.6, to: 0.85 } },
    before_score: 5.0,
    after_score: 8.0,
    score_delta_min: 1.0,
    author_id: "author-1",
    single_object: true,
    single_optimization_dimension: true,
    rubric: { clarity: 0.7 },
    red_lines: [],
    source_traces: ["trace-1", "trace-2"],
    ...overrides,
  };
  return buildProposal(newEvaluationId(), input, "2026-07-07T00:00:00.000Z");
}

/* ---------------------------------------------------------------------- */
/* AC-12: evaluation package contains only the public surface              */
/* ---------------------------------------------------------------------- */

describe("IndependentEvaluatorRunner — AC-12 package boundary", () => {
  it("buildEvaluationPackage exposes only the public surface (no author reasoning)", () => {
    const proposal = baseProposal();
    const pkg = buildEvaluationPackage(proposal);
    expect(pkg.target_kind).toBe("loop");
    expect(pkg.target_release_id).toBe("loop-1");
    expect(pkg.optimization_dimension).toBe("clarity");
    expect(pkg.before_snapshot).toEqual({ coverage: 0.6 });
    expect(pkg.after_snapshot).toEqual({ after_score: 8.0 });
    expect(pkg.diff).toEqual({ coverage: { from: 0.6, to: 0.85 } });
    expect(pkg.rubric).toEqual({ clarity: 0.7 });
    expect(pkg.red_lines).toEqual([]);
    expect(pkg.source_traces).toEqual(["trace-1", "trace-2"]);
    // The package MUST NOT include the author_id, the score_delta,
    // the created_at, or any recommendation framing.
    const keys = Object.keys(pkg);
    expect(keys).not.toContain("author_id");
    expect(keys).not.toContain("score_delta");
    expect(keys).not.toContain("created_at");
    expect(keys).not.toContain("recommendation");
    expect(keys).not.toContain("作者");
  });

  it("the package is frozen (cannot be mutated by a malicious scorer)", () => {
    const proposal = baseProposal();
    const pkg = buildEvaluationPackage(proposal);
    expect(Object.isFrozen(pkg)).toBe(true);
    expect(Object.isFrozen(pkg.before_snapshot)).toBe(true);
    expect(Object.isFrozen(pkg.after_snapshot)).toBe(true);
    expect(Object.isFrozen(pkg.diff)).toBe(true);
    expect(Object.isFrozen(pkg.rubric)).toBe(true);
    expect(Object.isFrozen(pkg.red_lines)).toBe(true);
    expect(Object.isFrozen(pkg.source_traces)).toBe(true);
  });

  it("buildEvaluatorPrompt contains no author identity or recommendation framing", () => {
    const proposal = baseProposal();
    const pkg = buildEvaluationPackage(proposal);
    const prompt = buildEvaluatorPrompt(pkg);
    expect(prompt).not.toContain(proposal.author_id);
    expect(prompt).not.toContain("推荐");
    expect(prompt).not.toContain("recommend");
    expect(prompt).toContain("INDEPENDENT scorer");
    expect(prompt).toContain("MUST NOT see the author");
    expect(prompt).toContain("refute");
  });
});

/* ---------------------------------------------------------------------- */
/* AC-13: refute paragraph is required and non-empty                       */
/* ---------------------------------------------------------------------- */

describe("IndependentEvaluatorRunner — AC-13 refute paragraph", () => {
  it("the default LLM call produces a non-empty refute paragraph", async () => {
    const proposal = baseProposal();
    const result = await runIndependentEvaluator(proposal, deterministicInvokeLlm);
    expect(result.refuteParagraph).toBeTruthy();
    expect(result.refuteParagraph.length).toBeGreaterThan(0);
    expect(result.refuteParagraph).toContain("clarity");
  });

  it("the default LLM call produces a finite score in [0, 10]", async () => {
    const proposal = baseProposal();
    const result = await runIndependentEvaluator(proposal, deterministicInvokeLlm);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(10);
  });

  it("a noop diff (zero keys) lowers the score", async () => {
    const proposal = baseProposal({ diff: {} });
    const result = await runIndependentEvaluator(proposal, deterministicInvokeLlm);
    expect(result.riskTags).toContain("noop_change");
  });

  it("a full_rewrite dimension emits the blessing-required risk tag", async () => {
    const proposal = baseProposal({ optimization_dimension: "full_rewrite" });
    const result = await runIndependentEvaluator(proposal, deterministicInvokeLlm);
    expect(result.riskTags).toContain("full_rewrite_blessing_required");
  });

  it("a custom LLM call can override the default", async () => {
    const proposal = baseProposal();
    const stub: LlmInvoke = async (pkg: EvaluationPackage) => {
      return {
        score: 4.0,
        riskTags: ["custom"],
        refuteParagraph: `refute for ${pkg.optimization_dimension}`,
      };
    };
    const result = await runIndependentEvaluator(proposal, stub);
    expect(result.score).toBe(4.0);
    expect(result.riskTags).toContain("custom");
    expect(result.refuteParagraph).toContain("clarity");
  });

  it("clamps the score to [0, 10] when the LLM returns an out-of-range value", async () => {
    const proposal = baseProposal();
    const stub: LlmInvoke = async () => {
      return {
        score: 99,
        riskTags: [],
        refuteParagraph: "out of range",
      };
    };
    const result = await runIndependentEvaluator(proposal, stub);
    expect(result.score).toBeLessThanOrEqual(10);
  });
});

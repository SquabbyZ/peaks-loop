import { describe, expect, it } from "vitest";
import {
  BriefSectionError,
  buildEvidenceBrief,
  renderRecommendationPayload,
  safeRenderRecommendationPayload,
  type BriefTraceInput,
} from "../../../src/services/crystallization/evidence-brief-builder.js";

/* ---------------------------------------------------------------------- */
/* Helpers                                                                 */
/* ---------------------------------------------------------------------- */

function makeTrace(overrides: Partial<BriefTraceInput> = {}): BriefTraceInput {
  return {
    trace_id: "trace-1",
    what_happened: "Authored the M5 crystallization surface end-to-end.",
    why_it_matters:
      "Without crystallization, peaks-loop could not persist real loop engineering assets.",
    what_learned:
      "Brief-first framing outperforms count-only evidence in user-facing recommendations.",
    what_action: "Promote this run to a stable loop after 2 cycles.",
    bullets: ["4 sections", "1 transaction"],
    source_trace_pointers: ["trace-1"],
    ...overrides,
  };
}

/* ---------------------------------------------------------------------- */
/* buildEvidenceBrief — AC-15 / AC-16 / AC-17                             */
/* ---------------------------------------------------------------------- */

describe("buildEvidenceBrief — 4-section guard", () => {
  it("accepts a complete brief", () => {
    const brief = buildEvidenceBrief(makeTrace());
    expect(brief.what_happened).toMatch(/Authored/i);
    expect(brief.why_it_matters).toMatch(/crystallization/i);
    expect(brief.what_learned).toMatch(/brief-first/i);
    expect(brief.what_action).toMatch(/Promote/i);
  });

  it("rejects when what_happened is empty", () => {
    expect(() =>
      buildEvidenceBrief(makeTrace({ what_happened: "" }))
    ).toThrow(BriefSectionError);
    try {
      buildEvidenceBrief(makeTrace({ what_happened: "" }));
    } catch (err) {
      expect(err).toBeInstanceOf(BriefSectionError);
    }
  });

  it("rejects when why_it_matters is empty", () => {
    expect(() =>
      buildEvidenceBrief(makeTrace({ why_it_matters: "   " }))
    ).toThrow(BriefSectionError);
  });

  it("rejects when what_learned is empty", () => {
    expect(() =>
      buildEvidenceBrief(makeTrace({ what_learned: "" }))
    ).toThrow(BriefSectionError);
  });

  it("rejects when what_action is empty", () => {
    expect(() =>
      buildEvidenceBrief(makeTrace({ what_action: "" }))
    ).toThrow(BriefSectionError);
  });

  it("error is a BriefSectionError (the surface-level error type)", () => {
    try {
      buildEvidenceBrief(makeTrace({ what_action: "" }));
    } catch (err) {
      expect(err).toBeInstanceOf(BriefSectionError);
      expect((err as BriefSectionError).code).toBe("MISSING_BRIEF_SECTION");
    }
  });
});

/* ---------------------------------------------------------------------- */
/* renderRecommendationPayload — refuses to render a partial brief        */
/* ---------------------------------------------------------------------- */

describe("renderRecommendationPayload — refuses without all 4 sections", () => {
  it("renders a complete envelope", () => {
    const payload = renderRecommendationPayload(makeTrace(), {
      one_liner: "Independent scorer: ok",
      risk_tags: ["inflation"],
    });
    expect(payload.brief.what_action).toMatch(/Promote/);
    expect(payload.bullets).toContain("4 sections");
    expect(payload.source_trace_pointers).toContain("trace-1");
    expect(payload.evaluator_summary.one_liner).toContain("Independent");
  });

  it("throws when any section is missing", () => {
    expect(() =>
      renderRecommendationPayload(
        makeTrace({ what_happened: "" }),
        { one_liner: "", risk_tags: [] }
      )
    ).toThrow(BriefSectionError);
  });
});

/* ---------------------------------------------------------------------- */
/* safeRenderRecommendationPayload — Result-like API                      */
/* ---------------------------------------------------------------------- */

describe("safeRenderRecommendationPayload", () => {
  it("returns ok on a complete payload", () => {
    const r = safeRenderRecommendationPayload({
      brief: {
        what_happened: "a",
        why_it_matters: "b",
        what_learned: "c",
        what_action: "d",
      },
      bullets: [],
      source_trace_pointers: [],
      evaluator_summary: { one_liner: "", risk_tags: [] },
    });
    expect(r.ok).toBe(true);
  });

  it("returns MISSING_BRIEF_SECTION when a section is missing", () => {
    const r = safeRenderRecommendationPayload({
      brief: {
        what_happened: "a",
        why_it_matters: "b",
        what_learned: "c",
      },
      bullets: [],
      source_trace_pointers: [],
      evaluator_summary: { one_liner: "", risk_tags: [] },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("MISSING_BRIEF_SECTION");
  });
});

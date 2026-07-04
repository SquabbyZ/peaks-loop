import { describe, expect, it } from "vitest";
import { planDispose } from "../../../src/services/sediment/dispose-confirm.js";
import type { BeeManifest } from "../../../src/services/sediment/types.js";

describe("planDispose", () => {
  it("auto-destroys system bees", () => {
    const m: BeeManifest = { schemaVersion: "peaks.bee/1", name: "peaks-prd", source: "system", promotion_status: "system-stable", description: "d", segments: [], entrypoint: { preamble: "", refs: [] }, promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true }, createdBy: "llm", lastTouchedAt: "2026-07-04T12:00:00Z" };
    expect(planDispose(m)).toEqual({ decision: "destroy", auto: true });
  });
  it("requires user prompt for user bees", () => {
    const m: BeeManifest = { schemaVersion: "peaks.bee/1", name: "bee-x", source: "user", promotion_status: "candidate", description: "d", segments: [], entrypoint: { preamble: "", refs: [] }, promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true }, createdBy: "llm", lastTouchedAt: "2026-07-04T12:00:00Z" };
    const plan = planDispose(m);
    expect(plan.decision).toBeNull();
    if (plan.decision === null) {
      expect(plan.requiresUserPrompt).toBe(true);
    }
  });
});
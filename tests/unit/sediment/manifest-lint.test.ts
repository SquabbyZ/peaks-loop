import { describe, expect, it } from "vitest";
import { lintManifest } from "../../../src/services/sediment/manifest-lint.js";

const good = {
  schemaVersion: "peaks.bee/1" as const,
  name: "bee-x",
  source: "user" as const,
  promotion_status: "candidate" as const,
  description: "d",
  segments: [],
  entrypoint: { preamble: "## x", refs: [] },
  promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true },
  createdBy: "llm" as const,
  lastTouchedAt: "2026-07-04T12:00:00Z",
};

describe("lintManifest", () => {
  it("returns ok for a valid manifest", () => {
    expect(lintManifest(good)).toEqual({ ok: true });
  });
  it("returns findings for an invalid manifest", () => {
    const bad: any = { ...good, name: "Bad-Name", description: "" };
    const r = lintManifest(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.findings.length).toBeGreaterThan(0);
  });
});

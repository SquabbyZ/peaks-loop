import { describe, expect, it } from "vitest";
import { BeeManifestSchema } from "../../../src/services/sediment/json-schema.js";

describe("BeeManifestSchema", () => {
  it("accepts a well-formed manifest", () => {
    const ok = {
      schemaVersion: "peaks.bee/1",
      name: "bee-arxiv-daily-watcher",
      source: "user",
      promotion_status: "candidate",
      description: "Fetches arxiv oncology papers and posts to feed",
      segments: [],
      entrypoint: { preamble: "## bee-arxiv-daily-watcher", refs: [] },
      promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true },
      createdBy: "llm",
      lastTouchedAt: "2026-07-04T12:00:00Z",
    };
    expect(BeeManifestSchema.safeParse(ok).success).toBe(true);
  });

  it("rejects a manifest missing schemaVersion", () => {
    const bad = { name: "x", source: "user", promotion_status: "candidate", description: "d", segments: [], entrypoint: { preamble: "", refs: [] }, promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true }, createdBy: "llm", lastTouchedAt: "2026-07-04T12:00:00Z" };
    expect(BeeManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a manifest with source=system not allowed to have promotion_status=candidate", () => {
    const bad = {
      schemaVersion: "peaks.bee/1",
      name: "x",
      source: "system",
      promotion_status: "candidate",  // system must be system-stable
      description: "d",
      segments: [],
      entrypoint: { preamble: "", refs: [] },
      promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true },
      createdBy: "llm",
      lastTouchedAt: "2026-07-04T12:00:00Z",
    };
    expect(BeeManifestSchema.safeParse(bad).success).toBe(false);
  });
});

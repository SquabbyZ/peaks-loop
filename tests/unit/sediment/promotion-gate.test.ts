import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateGate } from "../../../src/services/sediment/promotion-gate.js";
import type { BeeManifest } from "../../../src/services/sediment/types.js";

let home = "";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "peaks-pg-"));
  mkdirSync(join(home, ".peaks/skills/bees/bee-x"), { recursive: true });
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const m: BeeManifest = {
  schemaVersion: "peaks.bee/1",
  name: "bee-x",
  source: "user",
  promotion_status: "candidate",
  description: "d",
  segments: [],
  entrypoint: { preamble: "", refs: [] },
  promotion: { minCycles: 2, requiresHumanApproval: true, requiresSmokeTest: true },
  createdBy: "llm",
  lastTouchedAt: "2026-07-04T12:00:00Z",
};

describe("evaluateGate", () => {
  it("fails when minCycles not met", () => {
    writeFileSync(
      join(home, ".peaks/skills/bees/bee-x/run-state.json"),
      JSON.stringify({ cycles: 1, lastOutcome: "success" }),
    );
    const r = evaluateGate({ home }, m, { humanApproved: true, smokeTestPresent: true });
    expect(r.ok).toBe(false);
    expect(r.failedSubconditions).toContain("minCycles");
  });

  it("fails when smoke test missing", () => {
    writeFileSync(
      join(home, ".peaks/skills/bees/bee-x/run-state.json"),
      JSON.stringify({ cycles: 5, lastOutcome: "success" }),
    );
    const r = evaluateGate({ home }, m, { humanApproved: true, smokeTestPresent: false });
    expect(r.ok).toBe(false);
    expect(r.failedSubconditions).toContain("smokeTest");
  });

  it("passes when all conditions met", () => {
    writeFileSync(
      join(home, ".peaks/skills/bees/bee-x/run-state.json"),
      JSON.stringify({ cycles: 5, lastOutcome: "success" }),
    );
    const r = evaluateGate({ home }, m, { humanApproved: true, smokeTestPresent: true });
    expect(r.ok).toBe(true);
  });

  it("system bees skip the gate", () => {
    const sysM: BeeManifest = { ...m, source: "system", promotion_status: "system-stable" };
    const r = evaluateGate({ home }, sysM, { humanApproved: false, smokeTestPresent: false });
    expect(r.ok).toBe(true);
  });
});
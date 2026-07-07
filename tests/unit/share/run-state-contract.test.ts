/**
 * run-state-contract.test.ts — M7 / spec §7A.3 / §10 RL-9.
 *
 * Pure schema tests for the read-only RunStateContract.
 *
 * Hard rules enforced at THIS layer:
 *   - Strict object shape (extra keys rejected).
 *   - status pinned to the canonical enum.
 *   - bee_id / current_step non-empty.
 *   - started_at / updated_at are ISO8601.
 *   - last_evaluator_verdict / last_user_choice are NL strings
 *     or null.
 *   - Module exports are read-only — no setters are exported
 *     (the surface is `parse*` / `safeParse*` / `buildRunState`,
 *     none of which mutate any external state).
 */

import { describe, expect, it } from "vitest";
import * as contract from "../../../src/services/share/run-state-contract.js";
import {
  RunStateContractSchema,
  RUN_STATE_STATUSES,
  buildRunState,
  parseRunStateContract,
  safeParseRunStateContract,
} from "../../../src/services/share/run-state-contract.js";

function validContract(): unknown {
  return {
    bee_id: "bee-x",
    status: "running",
    current_step: "loop.preflight",
    started_at: "2026-07-08T00:00:00.000Z",
    updated_at: "2026-07-08T00:05:00.000Z",
    last_evaluator_verdict: null,
    last_user_choice: null,
  };
}

describe("run-state-contract / shape enforcement", () => {
  it("accepts a valid contract", () => {
    const r = RunStateContractSchema.safeParse(validContract());
    expect(r.success).toBe(true);
  });
  it("rejects an unknown status", () => {
    const r = RunStateContractSchema.safeParse({
      ...validContract(),
      status: "flying",
    });
    expect(r.success).toBe(false);
  });
  it("rejects extra keys (strict shape)", () => {
    const r = RunStateContractSchema.safeParse({
      ...validContract(),
      extra_field: "x",
    });
    expect(r.success).toBe(false);
  });
  it("requires bee_id (non-empty)", () => {
    const r = RunStateContractSchema.safeParse({
      ...validContract(),
      bee_id: "",
    });
    expect(r.success).toBe(false);
  });
  it("requires ISO8601 timestamps", () => {
    const r = RunStateContractSchema.safeParse({
      ...validContract(),
      started_at: "not-a-date",
    });
    expect(r.success).toBe(false);
  });
  it("allows NL null for last_evaluator_verdict / last_user_choice", () => {
    const r = RunStateContractSchema.safeParse({
      ...validContract(),
      last_evaluator_verdict: "ok",
      last_user_choice: "A",
    });
    expect(r.success).toBe(true);
  });
});

describe("run-state-contract / RUN_STATE_STATUSES enum", () => {
  it("contains the spec-listed status values", () => {
    expect(new Set(RUN_STATE_STATUSES)).toEqual(
      new Set(["running", "paused", "done", "failed", "blocked"])
    );
  });
});

describe("run-state-contract / parse + safeParse", () => {
  it("parseRunStateContract returns the typed contract on success", () => {
    const c = parseRunStateContract(validContract());
    expect(c.status).toBe("running");
    expect(c.bee_id).toBe("bee-x");
  });
  it("safeParseRunStateContract returns { ok: true, contract } on success", () => {
    const r = safeParseRunStateContract(validContract());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.contract.status).toBe("running");
  });
  it("safeParseRunStateContract returns findings on failure", () => {
    const r = safeParseRunStateContract({ ...validContract(), status: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.findings.length).toBeGreaterThan(0);
  });
});

describe("run-state-contract / buildRunState (server-side writer)", () => {
  it("returns a valid contract for server-side writers", () => {
    const c = buildRunState({
      bee_id: "bee-build",
      status: "running",
      current_step: "loop.eval",
      started_at: "2026-07-08T00:00:00.000Z",
      updated_at: "2026-07-08T00:00:10.000Z",
      last_evaluator_verdict: "ok",
      last_user_choice: "create",
    });
    expect(c.bee_id).toBe("bee-build");
    expect(c.last_evaluator_verdict).toBe("ok");
    expect(c.last_user_choice).toBe("create");
  });
  it("defaults nullable fields to null when omitted", () => {
    const c = buildRunState({
      bee_id: "bee-build-2",
      status: "paused",
      current_step: "wait_for_user",
      started_at: "2026-07-08T00:00:00.000Z",
      updated_at: "2026-07-08T00:00:05.000Z",
    });
    expect(c.last_evaluator_verdict).toBeNull();
    expect(c.last_user_choice).toBeNull();
  });
});

describe("run-state-contract / surface is read-only (no setters)", () => {
  it("module exposes only parse / safeParse / build (no mutation helpers)", () => {
    const exportedNames = Object.keys(contract).sort();
    // The set below intentionally captures the entire public API
    // surface today. If a future slice adds a setter helper it
    // MUST be added here AND it MUST NOT be a mutation on the
    // desktop-client side (spec §7A.3 read-only invariant).
    expect(exportedNames).toEqual(
      [
        "RUN_STATE_STATUSES",
        "RunStateContractSchema",
        "buildRunState",
        "parseRunStateContract",
        "safeParseRunStateContract",
      ].sort()
    );
  });
  it("does not expose Object.assign or similar mutator", () => {
    expect(typeof (contract as unknown as { assign?: unknown }).assign).toBe(
      "undefined"
    );
  });
});

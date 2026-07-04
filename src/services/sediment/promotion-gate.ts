import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveUserBeeDir } from "./pool-paths.js";
import type { BeeManifest } from "./types.js";

export interface GateInputs {
  humanApproved: boolean;
  smokeTestPresent: boolean;
}

export interface GateResult {
  ok: boolean;
  failedSubconditions: string[];
}

interface RunState {
  cycles: number;
  lastOutcome: "success" | "incident" | "unknown";
}

export function evaluateGate(
  { home }: { home: string },
  m: BeeManifest,
  inputs: GateInputs,
): GateResult {
  if (m.source === "system") {
    return { ok: true, failedSubconditions: [] };
  }
  const failed: string[] = [];
  const rsPath = join(resolveUserBeeDir({ home }, m.name), "run-state.json");
  const cycles = existsSync(rsPath)
    ? (JSON.parse(readFileSync(rsPath, "utf-8")) as RunState).cycles
    : 0;
  if (cycles < m.promotion.minCycles) failed.push("minCycles");
  if (inputs.smokeTestPresent !== m.promotion.requiresSmokeTest) failed.push("smokeTest");
  if (m.promotion.requiresHumanApproval && !inputs.humanApproved) failed.push("humanApproval");
  return { ok: failed.length === 0, failedSubconditions: failed };
}

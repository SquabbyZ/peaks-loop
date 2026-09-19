// src/services/capability-audit-service/independent-checker.ts
//
// The live, credential-free audit scorer.
//
// WHY A DETERMINISTIC CHECKER AND NOT AN LLM CALL
// ----------------------------------------------
// `publish.yml` is a secretless OIDC trusted-publishing workflow: `id-token:
// write`, no npm token, and no LLM credential of any kind in the environment.
// An LLM scorer therefore cannot run in the gate that decides whether a
// release happens. Adding a long-lived API secret to a secretless pipeline to
// serve that gate would be a threat-model regression, and an LLM verdict is
// non-deterministic — the same commit could flip between runs. So the live
// scorer must be credential-free.
//
// WHY IT IS STILL "INDEPENDENT"
// -----------------------------
// Independence is a property of the information channel, not of the substrate
// (RL-5 constrains what the scorer READS: `scorer.reads: evaluation_package_only`
// — it never requires a model). The scorer this replaces was handed
// `{baselineJourneyId, guard}` and asked to re-state it; an LLM given that same
// payload would be exactly as much a rubber stamp. The disease was the payload.
//
// This checker answers a question no guard contract can answer, from inputs no
// guard reads:
//   - a guard sees only ITSELF, so it cannot report that the observation set was
//     silently narrowed, or that a frozen row is armed by no contract at all;
//   - this checker sees the whole frozen claim set AND the whole registry.
// It reads only the evaluation package — no author reasoning, no session id, no
// self-praise framing — so RL-5's exclusions hold by construction.
//
// WHAT IT DOES NOT COVER (stated, not hidden)
// -------------------------------------------
// It does not read `forbiddenChanges` prose, and it cannot judge behaviour
// beyond what the 15 guard contracts already exercise. Its claim is narrower
// than "the 15 journeys are intact"; `coverage` in the result discloses exactly
// how narrow, so `consistent` is never read as more than it is.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  P0_JOURNEY_IDS,
  type CapabilityBaselineRow,
  type JourneyId
} from '../capability-baseline/types.js';
import type { GuardContract, GuardRunResult } from '../capability-guard-runner/types.js';
import type {
  AuditCoverage,
  AuditFinding,
  AuditFindingCode,
  IndependentCheckResult
} from './types.js';

export interface IndependentCheckInput {
  readonly projectRoot: string;
  readonly baselineRows: ReadonlyArray<CapabilityBaselineRow>;
  readonly contracts: ReadonlyArray<GuardContract>;
  readonly guardResults: ReadonlyArray<GuardRunResult>;
}

function finding(code: AuditFindingCode, journeyId: JourneyId, detail: string): AuditFinding {
  return { code, journeyId, detail };
}

/**
 * The observed journey set must be exactly the frozen P0 set. `runAllGuards`
 * aggregates whatever contracts it was handed, so a registry that lost a
 * journey reports a clean `pass: 14 / fail: 0` — a narrower check that looks
 * exactly like a green one. Nothing in the guard results can say so; only the
 * frozen set can.
 */
function checkObservationSet(
  frozen: ReadonlyArray<JourneyId>,
  observed: ReadonlyArray<JourneyId>
): ReadonlyArray<AuditFinding> {
  const out: AuditFinding[] = [];
  const counts = new Map<JourneyId, number>();
  for (const j of observed) counts.set(j, (counts.get(j) ?? 0) + 1);

  for (const j of frozen) {
    const n = counts.get(j) ?? 0;
    if (n === 0)
      out.push(
        finding(
          'OBSERVATION_INCOMPLETE',
          j,
          `${j} is in the frozen baseline but no guard result was observed for it`
        )
      );
    else if (n > 1)
      out.push(
        finding(
          'OBSERVATION_INCOMPLETE',
          j,
          `${j} produced ${String(n)} guard results; the frozen baseline declares it once`
        )
      );
  }
  for (const j of counts.keys()) {
    if (!frozen.includes(j))
      out.push(
        finding('OBSERVATION_INCOMPLETE', j, `${j} was observed but is not a frozen P0 journey`)
      );
  }
  return out;
}

/** The frozen claim set itself must be the P0 set, with no duplicate rows. */
function checkFrozenRows(rows: ReadonlyArray<CapabilityBaselineRow>): ReadonlyArray<AuditFinding> {
  const out: AuditFinding[] = [];
  const seen = new Map<JourneyId, number>();
  for (const r of rows) seen.set(r.journeyId, (seen.get(r.journeyId) ?? 0) + 1);
  for (const j of P0_JOURNEY_IDS) {
    const n = seen.get(j) ?? 0;
    if (n === 0)
      out.push(finding('BASELINE_ROW_SET_INVALID', j, `frozen baseline has no row for ${j}`));
    else if (n > 1)
      out.push(
        finding('BASELINE_ROW_SET_INVALID', j, `frozen baseline declares ${j} ${String(n)} times`)
      );
  }
  for (const j of seen.keys()) {
    if (!P0_JOURNEY_IDS.includes(j))
      out.push(
        finding(
          'BASELINE_ROW_SET_INVALID',
          j,
          `frozen baseline declares ${j}, which is not a P0 journey`
        )
      );
  }
  return out;
}

/**
 * Every `sourceFiles` entry of every frozen row must still exist. The guard
 * contracts check this too, but only through their own contract — so a
 * contract rewritten to drop that probe takes the check with it. Reading the
 * frozen text directly means the binding survives such a rewrite.
 */
function checkSourceBindings(
  projectRoot: string,
  rows: ReadonlyArray<CapabilityBaselineRow>
): ReadonlyArray<AuditFinding> {
  const out: AuditFinding[] = [];
  for (const row of rows) {
    for (const f of row.sourceFiles) {
      if (!existsSync(join(projectRoot, f))) {
        out.push(
          finding(
            'SOURCE_FILE_MISSING',
            row.journeyId,
            `frozen sourceFiles entry "${f}" is not on disk`
          )
        );
      }
    }
  }
  return out;
}

function countArmed(
  rows: ReadonlyArray<CapabilityBaselineRow>,
  contracts: ReadonlyArray<GuardContract>
): number {
  let armed = 0;
  for (const row of rows) {
    for (const inv of row.invariants) {
      if (
        contracts.some((c) => c.source.baselineRow === row.journeyId && c.source.invariant === inv)
      )
        armed += 1;
    }
  }
  return armed;
}

/**
 * Run the credential-free independent evaluation. The verdict is `drifted`
 * whenever a concrete deviation is observed — this function has no path that
 * returns `consistent` without having checked.
 */
export function runIndependentCheck(input: IndependentCheckInput): IndependentCheckResult {
  const observed = input.guardResults.map((r) => r.journeyId);
  const findings: AuditFinding[] = [
    ...checkFrozenRows(input.baselineRows),
    ...checkObservationSet(
      input.baselineRows.map((r) => r.journeyId),
      observed
    ),
    ...checkSourceBindings(input.projectRoot, input.baselineRows)
  ];

  const coverage: AuditCoverage = {
    observations: observed.length,
    observationsExpected: P0_JOURNEY_IDS.length,
    invariantsFrozen: input.baselineRows.reduce((n, r) => n + r.invariants.length, 0),
    invariantsArmed: countArmed(input.baselineRows, input.contracts),
    // Disclosed, not checked: free-text prohibitions cannot be judged
    // deterministically without turning a keyword scan into a fake verdict.
    forbiddenChangesUnverified: input.baselineRows.reduce(
      (n, r) => n + r.forbiddenChanges.length,
      0
    )
  };

  return {
    verdict: findings.length === 0 ? 'consistent' : 'drifted',
    findings,
    coverage
  };
}

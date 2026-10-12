// src/services/race/gate2-evaluator.ts
//
// PURE. This module imports no `node:fs` and never writes: the evaluator judges,
// the store (`pilot-gate-store.ts`) is the only I/O module, and the CLI verb
// `race pilot-gate record` is the only writer. `peaks race pilot-status` is
// read-only and proven so by a test that diffs the evidence file's bytes.
//
// The verdict semantics are the PRD's §3.3 verbatim:
//
//   any hard zero above its max         -> fail          (this branch wins)
//   else all four floors met            -> pass
//   else                                -> insufficient-evidence
//
// `insufficient-evidence` is not a failure. It is "keep running the pilot".

/** Hard-blocked path families — imported from the hook constant, never restated (PRD U-D). */
import { HARD_BLOCKED_PATH_FAMILIES } from '../hooks/pre-tool-code-gate.js';
import type { RaceGate2Policy } from './gate2-policy.js';

export type LaneChosenBy = 'user-named' | 'user-picked';
export type TaskOutcome = 'landed' | 'escalated' | 'stopped';
export type RiskSurfaceHandling = 'refused' | 'escalated' | 'user-override-recorded' | 'none';
export type PilotGateVerdict = 'pass' | 'fail' | 'insufficient-evidence';

export type PilotTaskRow = {
  readonly rid: string;
  readonly sessionId: string;
  readonly date: string;
  readonly laneChosenBy: LaneChosenBy;
  readonly outcome: TaskOutcome;
  readonly filesChanged: readonly string[];
  readonly riskSurfacesHit: readonly number[];
  readonly riskSurfaceHandling: RiskSurfaceHandling;
  readonly rolledBack: boolean;
  readonly ciRed: boolean;
  readonly missedRiskSurface: boolean;
};

export type PilotGateCounts = {
  readonly taskCount: number;
  readonly coreCapabilityTaskCount: number;
  readonly sessionCount: number;
  readonly safetyArmExercisedCount: number;
  readonly rollbackCount: number;
  readonly ciRedCount: number;
  readonly missedRiskSurfaceCount: number;
};

export type PilotGateReason = {
  readonly code: string;
  readonly message: string;
  readonly observed: number;
  readonly threshold: number;
};

export type PilotGateEvaluation = {
  readonly verdict: PilotGateVerdict;
  readonly counts: PilotGateCounts;
  readonly reasons: readonly PilotGateReason[];
};

/**
 * The safety arm fired and left a disposition. A hit with `'none'` is a MISSING
 * record, not a clean row — so `'none'` does not count (PRD §3.2(b)).
 *
 * Counting basis is deliberately different from `taskCount`'s: this predicate is
 * applied over ALL records, `escalated` and `stopped` included. An escalation is
 * the safety arm firing correctly, and a landed-only reading would exclude the
 * one sample where it did (PRD §3.1, the exception paragraph).
 */
export function safetyArmExercised(row: PilotTaskRow): boolean {
  return row.riskSurfacesHit.length > 0 && row.riskSurfaceHandling !== 'none';
}

/**
 * The coverage condition, DERIVED — never a `coreCapability: true` the author
 * wrote (PRD §3.2). A row qualifies by reaching a hard-blocked family, or by
 * exercising the safety arm.
 *
 * It does NOT test `outcome`: the caller applies this over landed rows only
 * (§3.1), which is a property of the counting set, not of the predicate.
 */
export function taskExercisesCoreCapability(row: PilotTaskRow): boolean {
  return row.filesChanged.some(isInHardBlockedFamily) || safetyArmExercised(row);
}

function isInHardBlockedFamily(file: string): boolean {
  const normalized = file.replace(/\\/g, '/');
  return HARD_BLOCKED_PATH_FAMILIES.some((family) => normalized.startsWith(family));
}

function belowMin(
  code: string,
  quantity: string,
  observed: number,
  threshold: number
): PilotGateReason | null {
  if (observed >= threshold) return null;
  return {
    code,
    message: `${quantity} is ${observed}, below the minimum of ${threshold}`,
    observed,
    threshold
  };
}

function aboveMax(
  code: string,
  quantity: string,
  observed: number,
  threshold: number
): PilotGateReason | null {
  if (observed <= threshold) return null;
  return {
    code,
    message: `${quantity} is ${observed}, above the maximum of ${threshold}`,
    observed,
    threshold
  };
}

function isReason(reason: PilotGateReason | null): reason is PilotGateReason {
  return reason !== null;
}

/** The four floors are counted over landed rows; the three hard zeros over every record. */
function countPilotTasks(tasks: readonly PilotTaskRow[]): PilotGateCounts {
  const landed = tasks.filter((row) => row.outcome === 'landed');
  return {
    taskCount: landed.length,
    coreCapabilityTaskCount: landed.filter(taskExercisesCoreCapability).length,
    sessionCount: new Set(landed.map((row) => row.sessionId)).size,
    safetyArmExercisedCount: tasks.filter(safetyArmExercised).length,
    rollbackCount: tasks.filter((row) => row.rolledBack).length,
    ciRedCount: tasks.filter((row) => row.ciRed).length,
    missedRiskSurfaceCount: tasks.filter((row) => row.missedRiskSurface).length
  };
}

/**
 * Hard zeros are safety quantities, read over ALL rows — an escalated task that
 * was rolled back is still a rollback — and one non-zero is `fail` before any
 * "is the sample big enough?" discussion starts (§3).
 */
function hardZeroReasonsFor(counts: PilotGateCounts, policy: RaceGate2Policy): PilotGateReason[] {
  return [
    aboveMax('rollback-above-max', 'rollbackCount', counts.rollbackCount, policy.rollbackCountMax),
    aboveMax('ci-red-above-max', 'ciRedCount', counts.ciRedCount, policy.ciRedCountMax),
    aboveMax(
      'missed-risk-surface-above-max',
      'missedRiskSurfaceCount',
      counts.missedRiskSurfaceCount,
      policy.missedRiskSurfaceCountMax
    )
  ].filter(isReason);
}

function floorReasonsFor(counts: PilotGateCounts, policy: RaceGate2Policy): PilotGateReason[] {
  return [
    belowMin('task-count-below-min', 'taskCount', counts.taskCount, policy.taskCountMin),
    belowMin(
      'core-capability-below-min',
      'coreCapabilityTaskCount',
      counts.coreCapabilityTaskCount,
      policy.coreCapabilityTaskCountMin
    ),
    belowMin(
      'session-count-below-min',
      'sessionCount',
      counts.sessionCount,
      policy.sessionCountMin
    ),
    belowMin(
      'safety-arm-below-min',
      'safetyArmExercisedCount',
      counts.safetyArmExercisedCount,
      policy.safetyArmExercisedMin
    )
  ].filter(isReason);
}

export function evaluatePilotGate(
  tasks: readonly PilotTaskRow[],
  policy: RaceGate2Policy
): PilotGateEvaluation {
  const counts = countPilotTasks(tasks);

  const hardZeroReasons = hardZeroReasonsFor(counts, policy);
  if (hardZeroReasons.length > 0) {
    return { verdict: 'fail', counts, reasons: hardZeroReasons };
  }

  const floorReasons = floorReasonsFor(counts, policy);
  if (floorReasons.length === 0) {
    return { verdict: 'pass', counts, reasons: [] };
  }
  return { verdict: 'insufficient-evidence', counts, reasons: floorReasons };
}

/**
 * `src/services/observability/aggregation-types.ts`
 *
 * The result shapes of the read-side aggregations over observability events
 * (`aggregation.ts`), plus the data they are built from: the slice lifecycle
 * terminal states, the RD/QA repair-loop cap, and the zeroed fan-out row.
 * Extracted verbatim (wave 3, file-size cap campaign) so the aggregation
 * module stays under the 300 raw-line cap — no aggregation logic lives here.
 * `aggregation.ts` imports and re-exports every PUBLIC name below, so
 * importers keep resolving them from `aggregation.js` unchanged; the
 * module-private constants are imported for use and stay unexported there.
 */

import type { ObservabilitySubagentRole } from './observability-service.js';

export type StatusAggregate = {
  totalEvents: number;
  totalSlices: number;
  successCount: number;
  failCount: number;
  repairCyclePeak: number;
  fanoutCostTotal: number;
};

export type SliceRollup = {
  sliceRid: string;
  transitions: number;
  firstTs: string | null;
  lastTs: string | null;
  durationMs: number | null;
  finalState: string | null;
  fanoutCount: number;
  repairCycleCount: number;
  success: boolean;
};

export type FanoutBreakdown = {
  total: number;
  perRole: Record<ObservabilitySubagentRole, number>;
};

export type RepairCycleReport = {
  totalCycles: number;
  cap: number;
  capHit: boolean;
  capHitCount: number;
  perSlice: Array<{ sliceRid: string; cycleCount: number }>;
};

// Slice lifecycle terminal states. Anything not listed is in-flight
// (draft / spec-locked / implemented / qa-handoff / running).
export const TERMINAL_HAPPY_STATES: ReadonlySet<string> = new Set([
  'handed-off',
  'verdict-issued',
  'impact-recorded',
  'boundary-recorded'
]);
export const TERMINAL_FAIL_STATES: ReadonlySet<string> = new Set(['blocked']);

/** RD/QA repair-loop cap (matches the peaks-code repair-loop contract). */
export const REPAIR_CYCLE_CAP = 3;

// v2.12.0 fan-out collapse: see OBSERVABILITY_SUBAGENT_ROLES for the
// rationale on why `security-reviewer` was dropped and `peaks-security-audit`
// + `peaks-perf-audit` were added.
export const ZERO_FANOUT: Record<ObservabilitySubagentRole, number> = {
  rd: 0,
  qa: 0,
  'code-reviewer': 0,
  'karpathy-reviewer': 0,
  'peaks-security-audit': 0,
  'peaks-perf-audit': 0
};

export type Period = 'day' | 'week' | 'month';

/**
 * Cumulative 5-metric surface for the `peaks dashboard summary` CLI.
 * All values are derived from raw observability events (per-event
 * counting), not from state files — semantics differ from
 * `peaks dashboard long-run`, which derives indicators from
 * `.peaks/_runtime/<sid>/24h-state.json`.
 */
export type DashboardMetrics = {
  readonly cycleCount: number;
  readonly tokenCount: number;
  readonly dispatchCount: number;
  readonly compactCount: number;
  readonly monotonicTriggerCount: number;
};

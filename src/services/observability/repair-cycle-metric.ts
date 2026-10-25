/**
 * `src/services/observability/repair-cycle-metric.ts`
 *
 * WHY THIS MODULE EXISTS — the measured defect that forced the metric to
 * change.
 *
 * The repair-cycle counter that used to live in `aggregation-helpers.ts`
 * counted every slice-transition event whose `detail.artifactRole === 'qa'`.
 * That is not a repair-cycle count: it counts QA's OWN internal state
 * transitions, and it counts every transition TWICE because
 * `peaks request transition` emits one event without `detail.from` and a
 * second one with it. Measured over this repo's own recorded history
 * (10 session dirs, 108 slices, 1102 slice-transition events) the old
 * counter put 82 of the 108 slices at or over the cap of 3, while exactly
 * ONE slice ever really reworked — and it reworked FIVE times.
 * The other 81 alarms were a measurement artifact, not rework.
 *
 * So the metric is VERSIONED. Version 1 is the qa-event count — it is kept,
 * under the name `legacyQaEventCount`, so the old number and the new number
 * can be read side by side instead of being compared by accident. Version 2
 * is the repair-cycle count computed here.
 *
 * THE v2 DEFINITION. A repair cycle = the slice's artifact RETURNS to an RD
 * work state (`draft` | `spec-locked` | `implemented`) after it had entered a
 * QA phase (`running` | `verdict-issued`). The state vocabulary is the one
 * `ALLOWED_STATES_PER_ROLE` declares in
 * `src/services/artifacts/request-artifact-state-helpers.ts`: `qa-handoff`
 * is an RD state, so the normal closing hops `verdict-issued → qa-handoff` and
 * `qa-handoff → handed-off` are the happy path, not rework.
 *
 * This is NOT the same measurement as
 * `src/services/artifacts/repair-cycle-service.ts`, which counts the
 * `QA return-to-rd cycle N` notes inside a request artifact. That one is the
 * artifact contract's own record; this one is reconstructed from the
 * observability event stream. The two are reported separately and are never
 * merged.
 */

import { artifactRole, isSliceTransition, transitionTo } from './aggregation-helpers.js';
import {
  REPAIR_CYCLE_CAP,
  type LegacyQaEventCount,
  type QaRoundSummary,
  type RepairCycleReport
} from './aggregation-types.js';
import type { ObservabilityEvent } from './observability-service.js';

/**
 * Version 1 was never versioned — it silently counted qa-role events.
 * Version 2 is the repair-cycle count. A consumer that reads
 * `metricVersion` can therefore tell which convention produced the numbers
 * printed next to it.
 */
export const REPAIR_CYCLE_METRIC_VERSION = 2;

/** What the v2 number counts, in one sentence, for every consumer that prints it. */
export const REPAIR_CYCLE_METRIC_DEFINITION =
  'A repair cycle = the slice returns to an RD work state (draft | spec-locked | implemented) ' +
  'after it had entered a QA phase (running | verdict-issued). One rework excursion counts once.';

/** What the v1 number counts, and why it must never be read as a repair-cycle count. */
export const LEGACY_QA_EVENT_COUNT_NOTE =
  'Counts slice-transition events whose detail.artifactRole === "qa" — QA\'s own internal state ' +
  'transitions, NOT repair loops. Kept so the v1 and v2 numbers can be compared side by side.';

/**
 * RD work states. A return to one of these after a QA phase is rework; a
 * return to `qa-handoff` / `handed-off` is a forward or terminal hop.
 */
const RD_WORK_STATES: ReadonlySet<string> = new Set(['draft', 'spec-locked', 'implemented']);

/**
 * QA work states — the `qa` role's `ALLOWED_STATES_PER_ROLE` entries minus
 * `draft` (the initial state) and `blocked` (a terminal failure). Entering
 * one of them opens a QA phase.
 */
const QA_WORK_STATES: ReadonlySet<string> = new Set(['running', 'verdict-issued']);

/** One de-duplicated transition: the target state and the artifact role that moved. */
type Step = { to: string; role: string };

/** The three numbers one slice carries. */
export type SliceRepairMetrics = {
  /** v2: how many times the slice came back to an RD work state after a QA phase. */
  repairCycles: number;
  /** v2: how many QA phases the slice entered. */
  qaRounds: number;
  /** v1: how many qa-role slice-transition events the slice emitted. */
  legacyQaEventCount: number;
};

function eventTs(event: ObservabilityEvent): string {
  return typeof event.ts === 'string' ? event.ts : '';
}

/**
 * The de-duplicated transition sequence of every slice.
 *
 * `detail.from` is never read: it is present on only 55% of the recorded
 * events and contradicts the event order on 395 of those, so a metric that
 * trusts it reads a field that does not mean what its name says. The
 * sequence is rebuilt from `detail.to` + `detail.artifactRole` only.
 */
function sliceSteps(events: readonly ObservabilityEvent[]): Map<string, Step[]> {
  const bySlice = new Map<string, ObservabilityEvent[]>();
  for (const event of events) {
    if (!isSliceTransition(event)) continue;
    const bucket = bySlice.get(event.sliceRid);
    if (bucket === undefined) bySlice.set(event.sliceRid, [event]);
    else bucket.push(event);
  }
  const steps = new Map<string, Step[]>();
  for (const [rid, bucket] of bySlice) {
    const ordered = [...bucket].sort((a, b) => eventTs(a).localeCompare(eventTs(b)));
    const collapsed: Step[] = [];
    for (const event of ordered) {
      const to = transitionTo(event);
      if (to === null) continue;
      const role = artifactRole(event);
      const last = collapsed[collapsed.length - 1];
      // The same transition is emitted twice — once without `detail.from` and
      // once with it. Both carry the same `to` and the same role, so the
      // second one is dropped and the pair counts once.
      if (last !== undefined && last.to === to && last.role === role) continue;
      collapsed.push({ to, role });
    }
    steps.set(rid, collapsed);
  }
  return steps;
}

/**
 * Score one de-duplicated sequence.
 *
 * `qaPhaseOpen` is the "a rework is pending" latch: it is set when the slice
 * enters QA work and cleared when the slice returns to an RD work state (one
 * cycle, counted once) or leaves for a forward / terminal hop. `qaExcursionOpen`
 * separates "a new QA phase" from "the same phase seen twice".
 */
function scoreSteps(steps: readonly Step[]): { repairCycles: number; qaRounds: number } {
  let repairCycles = 0;
  let qaRounds = 0;
  let qaPhaseOpen = false;
  let qaExcursionOpen = false;
  for (const step of steps) {
    const isQaWork = QA_WORK_STATES.has(step.to) && step.role === 'qa';
    const isRdWork = RD_WORK_STATES.has(step.to) && step.role === 'rd';
    if (isQaWork) {
      if (!qaExcursionOpen) {
        qaRounds += 1;
        qaExcursionOpen = true;
      }
      qaPhaseOpen = true;
      continue;
    }
    qaExcursionOpen = false;
    if (isRdWork) {
      if (qaPhaseOpen) {
        repairCycles += 1;
        qaPhaseOpen = false;
      }
      continue;
    }
    // A forward / terminal hop (`qa-handoff`, `handed-off`, `blocked`, ...):
    // the QA phase is over and no rework is pending.
    qaPhaseOpen = false;
  }
  return { repairCycles, qaRounds };
}

/** The v1 count: every qa-role slice-transition event, duplicates included. */
function legacyQaEventCounts(events: readonly ObservabilityEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (!isSliceTransition(event)) continue;
    if (artifactRole(event) !== 'qa') continue;
    counts.set(event.sliceRid, (counts.get(event.sliceRid) ?? 0) + 1);
  }
  return counts;
}

/** The three numbers, per slice, over the whole event stream. */
export function computeSliceRepairMetrics(
  events: readonly ObservabilityEvent[]
): Map<string, SliceRepairMetrics> {
  const steps = sliceSteps(events);
  const legacy = legacyQaEventCounts(events);
  const metrics = new Map<string, SliceRepairMetrics>();
  for (const [rid, slice] of steps) {
    const scored = scoreSteps(slice);
    metrics.set(rid, {
      repairCycles: scored.repairCycles,
      qaRounds: scored.qaRounds,
      legacyQaEventCount: legacy.get(rid) ?? 0
    });
  }
  return metrics;
}

/**
 * The repair-cycle report. `capHitCount` is computed from the v2 metric; the
 * v1 count rides along under its own name so the two conventions can be
 * compared rather than confused.
 */
export function buildRepairCycleReport(events: readonly ObservabilityEvent[]): RepairCycleReport {
  const metrics = computeSliceRepairMetrics(events);
  const rids = Array.from(metrics.keys()).sort((a, b) => a.localeCompare(b));
  const perSlice = rids.map((rid) => ({
    sliceRid: rid,
    cycleCount: metrics.get(rid)?.repairCycles ?? 0
  }));
  const legacyPerSlice = rids.map((rid) => ({
    sliceRid: rid,
    eventCount: metrics.get(rid)?.legacyQaEventCount ?? 0
  }));
  const qaRoundPerSlice = rids.map((rid) => ({
    sliceRid: rid,
    roundCount: metrics.get(rid)?.qaRounds ?? 0
  }));
  const totalCycles = perSlice.reduce((sum, row) => sum + row.cycleCount, 0);
  const capHitCount = perSlice.filter((row) => row.cycleCount >= REPAIR_CYCLE_CAP).length;
  const legacyTotal = legacyPerSlice.reduce((sum, row) => sum + row.eventCount, 0);
  const legacyCapHitCount = legacyPerSlice.filter(
    (row) => row.eventCount >= REPAIR_CYCLE_CAP
  ).length;
  const qaRounds: QaRoundSummary = {
    metric: 'qa-rounds',
    total: qaRoundPerSlice.reduce((sum, row) => sum + row.roundCount, 0),
    peak: qaRoundPerSlice.reduce((peak, row) => Math.max(peak, row.roundCount), 0),
    perSlice: qaRoundPerSlice
  };
  const legacyQaEventCount: LegacyQaEventCount = {
    metric: 'qa-role-transition-event-count',
    metricVersion: 1,
    note: LEGACY_QA_EVENT_COUNT_NOTE,
    total: legacyTotal,
    peak: legacyPerSlice.reduce((peak, row) => Math.max(peak, row.eventCount), 0),
    capHitCount: legacyCapHitCount,
    perSlice: legacyPerSlice
  };
  return {
    metric: 'repair-cycles',
    metricVersion: REPAIR_CYCLE_METRIC_VERSION,
    definition: REPAIR_CYCLE_METRIC_DEFINITION,
    totalCycles,
    cap: REPAIR_CYCLE_CAP,
    capHit: capHitCount > 0,
    capHitCount,
    perSlice,
    qaRounds,
    legacyQaEventCount
  };
}

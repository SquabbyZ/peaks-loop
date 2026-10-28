/**
 * Read-only aggregations over observability events.
 *
 * Slice B of v2.11.1. Pure functions over `readonly ObservabilityEvent[]`
 * — the CLI layer reads events via `readObservabilityEvents` (or
 * `listSessionDirsWithMetrics` for cross-session rollups) and passes
 * them in. Tests pass synthetic events directly.
 *
 * Aggregations:
 *
 * The dispatch / mode-gate / context / post-compact categories land
 * in Slice C (more hooks); for Slice B only `slice-transition` events
 * are emitted from the `peaks request transition` hook. Slice B
 * builds the read-side surface so Slice C is purely additive.
 */

import {
  readObservabilityEvents,
  type ObservabilityEvent,
  type ObservabilitySubagentRole
} from './observability-service.js';
import {
  TERMINAL_FAIL_STATES,
  TERMINAL_HAPPY_STATES,
  ZERO_FANOUT,
  type DashboardMetrics,
  type FanoutBreakdown,
  type Period,
  type RepairCycleReport,
  type SliceOutcome,
  type SliceRollup,
  type StatusAggregate
} from './aggregation-types.js';
import { durationMsBetween, isSliceTransition, transitionTo } from './aggregation-helpers.js';
import { buildRepairCycleReport, computeSliceRepairMetrics } from './repair-cycle-metric.js';
import { sliceIdentity } from '../../shared/incrementing-number.js';

// The result shapes and their data (terminal states, repair-loop cap, zeroed
// fan-out row) live in `aggregation-types.ts`; the event-detail readers and
// the event-source helpers live in `aggregation-helpers.ts` (wave-3 file-size
// cap split; declarations moved verbatim). The repair-cycle METRIC lives in
// `repair-cycle-metric.ts` — version 2 of it, with the version-1 count kept
// beside it under its own name. Every PUBLIC name is re-exported below so
// importers keep resolving it from `aggregation.js` unchanged; the
// module-private readers are imported for use here and not re-exported.
export { REPAIR_CYCLE_CAP } from './aggregation-types.js';
export { REPAIR_CYCLE_METRIC_VERSION } from './repair-cycle-metric.js';
export { readAllSessionEvents, readSessionEvents } from './aggregation-helpers.js';
export type {
  DashboardMetrics,
  FanoutBreakdown,
  LegacyQaEventCount,
  Period,
  QaRoundSummary,
  RepairCycleReport,
  SliceOutcome,
  SliceRollup,
  StatusAggregate
} from './aggregation-types.js';

// ----- per-slice rollup (shared by status + slices queries) -----

function rollupSlices(events: readonly ObservabilityEvent[]): Map<string, SliceRollup> {
  const bySlice = new Map<string, SliceRollup>();
  for (const event of events) {
    if (!isSliceTransition(event)) continue;
    const rid = sliceIdentity(event.sliceRid).logical;
    let rollup = bySlice.get(rid);
    if (rollup === undefined) {
      rollup = {
        sliceRid: rid,
        transitions: 0,
        firstTs: null,
        lastTs: null,
        durationMs: null,
        finalState: null,
        fanoutCount: 0,
        repairCycleCount: 0,
        success: false
      };
      bySlice.set(rid, rollup);
    }
    rollup.transitions += 1;
    if (rollup.firstTs === null || event.ts < rollup.firstTs) rollup.firstTs = event.ts;
    if (rollup.lastTs === null || event.ts > rollup.lastTs) rollup.lastTs = event.ts;
    const to = transitionTo(event);
    if (to !== null) rollup.finalState = to;
  }
  for (const rollup of bySlice.values()) {
    if (rollup.finalState !== null && TERMINAL_HAPPY_STATES.has(rollup.finalState)) {
      rollup.success = true;
    }
    if (rollup.firstTs !== null && rollup.lastTs !== null) {
      rollup.durationMs = durationMsBetween(rollup.firstTs, rollup.lastTs);
    }
  }
  return bySlice;
}

// ----- public aggregations -----

/**
 * How one slice ended, from its rollup.
 *
 * ONE spelling of the three outcomes, shared by the status counts and by the
 * report's slice table: a slice that reached a terminal success state, a slice
 * that reached a terminal failure state, and a slice that reached NEITHER — it
 * advanced partway and stopped (at `qa-handoff`, typically). The last is not a
 * failure, so it is not counted as one and is not drawn as one.
 */
export function sliceOutcome(rollup: SliceRollup): SliceOutcome {
  if (rollup.success) return 'success';
  if (rollup.finalState !== null && TERMINAL_FAIL_STATES.has(rollup.finalState)) return 'failed';
  return 'stalled';
}

export function aggregateStatus(events: readonly ObservabilityEvent[]): StatusAggregate {
  const bySlice = rollupSlices(events);
  const metrics = computeSliceRepairMetrics(events);
  let repairCyclePeak = 0;
  for (const rollup of bySlice.values()) {
    const cycles = metrics.get(rollup.sliceRid)?.repairCycles ?? 0;
    rollup.repairCycleCount = cycles;
    if (cycles > repairCyclePeak) repairCyclePeak = cycles;
  }
  // The three outcome buckets come from the ONE outcome spelling above, so
  // they partition the slice set: every slice lands in exactly one bucket and
  // `successCount + failCount + stalledCount === totalSlices` holds for every
  // event set. Before the third bucket existed, a slice stuck at `qa-handoff`
  // was in NEITHER the success nor the fail count and the summary reported
  // fewer outcomes than the slice table showed rows.
  const successCount = Array.from(bySlice.values()).filter(
    (r) => sliceOutcome(r) === 'success'
  ).length;
  const failCount = Array.from(bySlice.values()).filter((r) => sliceOutcome(r) === 'failed').length;
  const stalledCount = Array.from(bySlice.values()).filter(
    (r) => sliceOutcome(r) === 'stalled'
  ).length;
  const fanoutCostTotal = events.filter((e) => e.category === 'dispatch').length;

  return {
    totalEvents: events.length,
    totalSlices: bySlice.size,
    successCount,
    failCount,
    stalledCount,
    repairCyclePeak,
    fanoutCostTotal
  };
}

export function aggregateSlices(events: readonly ObservabilityEvent[]): SliceRollup[] {
  const bySlice = rollupSlices(events);
  const metrics = computeSliceRepairMetrics(events);
  for (const rollup of bySlice.values()) {
    rollup.repairCycleCount = metrics.get(rollup.sliceRid)?.repairCycles ?? 0;
  }
  return Array.from(bySlice.values()).sort((a, b) => a.sliceRid.localeCompare(b.sliceRid));
}

export function aggregateFanout(events: readonly ObservabilityEvent[]): FanoutBreakdown {
  const perRole: Record<ObservabilitySubagentRole, number> = { ...ZERO_FANOUT };
  let total = 0;
  for (const event of events) {
    if (event.category !== 'dispatch') continue;
    if (event.role !== undefined && event.role in perRole) {
      perRole[event.role] += 1;
      total += 1;
    }
  }
  return { total, perRole };
}

export function aggregateRepairCycles(events: readonly ObservabilityEvent[]): RepairCycleReport {
  return buildRepairCycleReport(events);
}

export function periodStartIso(period: Period, now: () => Date = () => new Date()): string {
  const d = now();
  if (period === 'day') {
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (period === 'week') {
    d.setUTCHours(0, 0, 0, 0);
    const day = d.getUTCDay();
    const diff = (day + 6) % 7; // Monday = 0
    d.setUTCDate(d.getUTCDate() - diff);
    return d.toISOString();
  }
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function filterByPeriod(
  events: readonly ObservabilityEvent[],
  period: Period,
  now?: () => Date
): ObservabilityEvent[] {
  const start = periodStartIso(period, now);
  return events.filter((e) => e.ts >= start);
}

/**
 * Aggregate the 5 dashboard metric classes for a single session, filtered
 * to events with `ts >= since`. Events with unparseable timestamps are
 * counted (best-effort, mirrors `readObservabilityEvents` behavior). The
 * `token-usage` total is summed from `detail.totalTokens` (falling back to
 * `inputTokens + outputTokens` when the aggregate field is missing).
 */
export function aggregateDashboardMetrics(
  projectRoot: string,
  sessionId: string,
  since: Date
): DashboardMetrics {
  const events = readObservabilityEvents(projectRoot, sessionId);
  const cutoff = since.getTime();
  let cycleCount = 0;
  let tokenCount = 0;
  let dispatchCount = 0;
  let compactCount = 0;
  let monotonicTriggerCount = 0;
  for (const event of events) {
    const ts = Date.parse(event.ts);
    if (Number.isFinite(cutoff) && Number.isFinite(ts) && ts < cutoff) continue;
    if (event.category === 'cycle') cycleCount += 1;
    else if (event.category === 'token-usage') {
      const detail = event.detail as {
        totalTokens?: unknown;
        inputTokens?: unknown;
        outputTokens?: unknown;
      };
      const t =
        typeof detail.totalTokens === 'number'
          ? detail.totalTokens
          : (typeof detail.inputTokens === 'number' ? detail.inputTokens : 0) +
            (typeof detail.outputTokens === 'number' ? detail.outputTokens : 0);
      tokenCount += t;
    } else if (event.category === 'dispatch') dispatchCount += 1;
    else if (event.category === 'post-compact') compactCount += 1;
    else if (event.category === 'monotonic-trigger') monotonicTriggerCount += 1;
  }
  return { cycleCount, tokenCount, dispatchCount, compactCount, monotonicTriggerCount };
}

/**
 * Pure-function variant used by tests: counts across an already-loaded
 * event list. `since` may be null to count everything.
 */
export function aggregateDashboardMetricsFromEvents(
  events: readonly ObservabilityEvent[],
  since: Date | null = null
): DashboardMetrics {
  const cutoff = since?.getTime() ?? null;
  let cycleCount = 0;
  let tokenCount = 0;
  let dispatchCount = 0;
  let compactCount = 0;
  let monotonicTriggerCount = 0;
  for (const event of events) {
    const ts = Date.parse(event.ts);
    if (cutoff !== null && Number.isFinite(ts) && ts < cutoff) continue;
    if (event.category === 'cycle') cycleCount += 1;
    else if (event.category === 'token-usage') {
      const detail = event.detail as {
        totalTokens?: unknown;
        inputTokens?: unknown;
        outputTokens?: unknown;
      };
      const t =
        typeof detail.totalTokens === 'number'
          ? detail.totalTokens
          : (typeof detail.inputTokens === 'number' ? detail.inputTokens : 0) +
            (typeof detail.outputTokens === 'number' ? detail.outputTokens : 0);
      tokenCount += t;
    } else if (event.category === 'dispatch') dispatchCount += 1;
    else if (event.category === 'post-compact') compactCount += 1;
    else if (event.category === 'monotonic-trigger') monotonicTriggerCount += 1;
  }
  return { cycleCount, tokenCount, dispatchCount, compactCount, monotonicTriggerCount };
}

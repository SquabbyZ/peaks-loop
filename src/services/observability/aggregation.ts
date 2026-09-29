/**
 * Read-only aggregations over observability events.
 *
 * Slice B of v2.11.1. Pure functions over `readonly ObservabilityEvent[]`
 * — the CLI layer reads events via `readObservabilityEvents` (or
 * `listSessionDirsWithMetrics` for cross-session rollups) and passes
 * them in. Tests pass synthetic events directly.
 *
 * Aggregations:
 *   - `aggregateStatus(events)`        → AC-1
 *   - `aggregateSlices(events)`        → AC-2
 *   - `aggregateFanout(events)`        → AC-3
 *   - `aggregateRepairCycles(events)`  → AC-4
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
  REPAIR_CYCLE_CAP,
  TERMINAL_FAIL_STATES,
  TERMINAL_HAPPY_STATES,
  ZERO_FANOUT,
  type DashboardMetrics,
  type FanoutBreakdown,
  type Period,
  type RepairCycleReport,
  type SliceRollup,
  type StatusAggregate
} from './aggregation-types.js';
import {
  computeRepairCyclesBySlice,
  durationMsBetween,
  isSliceTransition,
  transitionTo
} from './aggregation-helpers.js';

// The result shapes and their data (terminal states, repair-loop cap, zeroed
// fan-out row) live in `aggregation-types.ts`; the event-detail readers, the
// per-slice cycle count and the event-source helpers live in
// `aggregation-helpers.ts` (wave-3 file-size cap split; declarations moved
// verbatim). Every PUBLIC name is re-exported below so importers keep
// resolving it from `aggregation.js` unchanged; the module-private readers are
// imported for use here and not re-exported.
export { REPAIR_CYCLE_CAP } from './aggregation-types.js';
export { readAllSessionEvents, readSessionEvents } from './aggregation-helpers.js';
export type {
  DashboardMetrics,
  FanoutBreakdown,
  Period,
  RepairCycleReport,
  SliceRollup,
  StatusAggregate
} from './aggregation-types.js';

// ----- per-slice rollup (shared by status + slices queries) -----

function rollupSlices(events: readonly ObservabilityEvent[]): Map<string, SliceRollup> {
  const bySlice = new Map<string, SliceRollup>();
  for (const event of events) {
    if (!isSliceTransition(event)) continue;
    const rid = event.sliceRid;
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

export function aggregateStatus(events: readonly ObservabilityEvent[]): StatusAggregate {
  const bySlice = rollupSlices(events);
  const cyclesBySlice = computeRepairCyclesBySlice(events);
  let repairCyclePeak = 0;
  for (const rollup of bySlice.values()) {
    const cycles = cyclesBySlice.get(rollup.sliceRid) ?? 0;
    rollup.repairCycleCount = cycles;
    if (cycles > repairCyclePeak) repairCyclePeak = cycles;
  }
  const successCount = Array.from(bySlice.values()).filter((r) => r.success).length;
  const failCount = Array.from(bySlice.values()).filter(
    (r) => r.finalState !== null && TERMINAL_FAIL_STATES.has(r.finalState)
  ).length;
  const fanoutCostTotal = events.filter((e) => e.category === 'dispatch').length;

  return {
    totalEvents: events.length,
    totalSlices: bySlice.size,
    successCount,
    failCount,
    repairCyclePeak,
    fanoutCostTotal
  };
}

export function aggregateSlices(events: readonly ObservabilityEvent[]): SliceRollup[] {
  const bySlice = rollupSlices(events);
  const cyclesBySlice = computeRepairCyclesBySlice(events);
  for (const rollup of bySlice.values()) {
    rollup.repairCycleCount = cyclesBySlice.get(rollup.sliceRid) ?? 0;
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
  const cyclesBySlice = computeRepairCyclesBySlice(events);
  const perSlice = Array.from(cyclesBySlice.entries())
    .map(([sliceRid, cycleCount]) => ({ sliceRid, cycleCount }))
    .sort((a, b) => a.sliceRid.localeCompare(b.sliceRid));
  const totalCycles = perSlice.reduce((sum, row) => sum + row.cycleCount, 0);
  const capHitCount = perSlice.filter((row) => row.cycleCount >= REPAIR_CYCLE_CAP).length;
  return {
    totalCycles,
    cap: REPAIR_CYCLE_CAP,
    capHit: capHitCount > 0,
    capHitCount,
    perSlice
  };
}

// ----- period rollup (AC-5 — Slice D, but helpers live here) -----

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

// ----- rid-030 F-direction: 5-metric dashboard summary -----

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

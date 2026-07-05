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

import { readObservabilityEvents, type ObservabilityEvent, type ObservabilitySubagentRole } from './observability-service.js';
import { listSessionDirsWithMetrics } from './jsonl-store.js';

// ----- types -----

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
const TERMINAL_HAPPY_STATES: ReadonlySet<string> = new Set([
  'handed-off',
  'verdict-issued',
  'impact-recorded',
  'boundary-recorded'
]);
const TERMINAL_FAIL_STATES: ReadonlySet<string> = new Set(['blocked']);

/** RD/QA repair-loop cap (matches the peaks-code repair-loop contract). */
export const REPAIR_CYCLE_CAP = 3;

// v2.12.0 fan-out collapse: see OBSERVABILITY_SUBAGENT_ROLES for the
// rationale on why `security-reviewer` was dropped and `peaks-security-audit`
// + `peaks-perf-audit` were added.
const ZERO_FANOUT: Record<ObservabilitySubagentRole, number> = {
  'rd': 0,
  'qa': 0,
  'code-reviewer': 0,
  'karpathy-reviewer': 0,
  'peaks-security-audit': 0,
  'peaks-perf-audit': 0
};

// ----- internal helpers -----

function isSliceTransition(event: ObservabilityEvent): event is ObservabilityEvent & { sliceRid: string } {
  return event.category === 'slice-transition' && typeof event.sliceRid === 'string';
}

function artifactRole(event: ObservabilityEvent): string {
  const detail = event.detail as { artifactRole?: unknown };
  return typeof detail.artifactRole === 'string' ? detail.artifactRole : '';
}

function transitionTo(event: ObservabilityEvent): string | null {
  const detail = event.detail as { to?: unknown };
  return typeof detail.to === 'string' ? detail.to : null;
}

function durationMsBetween(firstTs: string, lastTs: string): number {
  const a = new Date(firstTs).getTime();
  const b = new Date(lastTs).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return 0;
  }
  return Math.max(0, b - a);
}

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

function computeRepairCyclesBySlice(events: readonly ObservabilityEvent[]): Map<string, number> {
  // Repair cycle = each rd → qa transition within one slice (proxy for the
  // RD→QA→RD loop). For each slice we count qa transitions that follow an
  // rd transition. Multiple qa transitions on the same slice are capped by
  // REPAIR_CYCLE_CAP at the report level — the per-slice count here is the
  // raw observation count.
  const cyclesBySlice = new Map<string, number>();
  for (const event of events) {
    if (!isSliceTransition(event)) continue;
    const rid = event.sliceRid;
    const role = artifactRole(event);
    if (role === 'qa') {
      cyclesBySlice.set(rid, (cyclesBySlice.get(rid) ?? 0) + 1);
    }
  }
  return cyclesBySlice;
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

export type Period = 'day' | 'week' | 'month';

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

export function filterByPeriod(events: readonly ObservabilityEvent[], period: Period, now?: () => Date): ObservabilityEvent[] {
  const start = periodStartIso(period, now);
  return events.filter((e) => e.ts >= start);
}

// ----- event-source helpers (CLI calls these; tests use pure functions) -----

export function readAllSessionEvents(projectRoot: string): ObservabilityEvent[] {
  const sessions = listSessionDirsWithMetrics(projectRoot);
  const all: ObservabilityEvent[] = [];
  for (const { sessionId } of sessions) {
    for (const event of readObservabilityEvents(projectRoot, sessionId)) {
      all.push(event);
    }
  }
  all.sort((a, b) => a.ts.localeCompare(b.ts));
  return all;
}

export function readSessionEvents(projectRoot: string, sessionId: string): ObservabilityEvent[] {
  return readObservabilityEvents(projectRoot, sessionId);
}
/**
 * `src/services/observability/aggregation-helpers.ts`
 *
 * The event-detail readers the aggregations in `aggregation.ts` are built on
 * (category test, `detail` field extraction, timestamp difference), the
 * per-slice repair-cycle count, and the two event-source helpers the CLI
 * calls. Moved verbatim (wave 3, file-size cap campaign) so the aggregation
 * module stays under the 300 raw-line cap. The first four were module-private
 * before the move and are NOT re-exported from `aggregation.ts`; the two
 * event-source helpers were public and are re-exported there, so that
 * module's public surface is unchanged.
 */

import { readObservabilityEvents, type ObservabilityEvent } from './observability-service.js';
import { listSessionDirsWithMetrics } from './jsonl-store.js';

export function isSliceTransition(
  event: ObservabilityEvent
): event is ObservabilityEvent & { sliceRid: string } {
  return event.category === 'slice-transition' && typeof event.sliceRid === 'string';
}

export function artifactRole(event: ObservabilityEvent): string {
  const detail = event.detail as { artifactRole?: unknown };
  return typeof detail.artifactRole === 'string' ? detail.artifactRole : '';
}

export function transitionTo(event: ObservabilityEvent): string | null {
  const detail = event.detail as { to?: unknown };
  return typeof detail.to === 'string' ? detail.to : null;
}

export function durationMsBetween(firstTs: string, lastTs: string): number {
  const a = new Date(firstTs).getTime();
  const b = new Date(lastTs).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return 0;
  }
  return Math.max(0, b - a);
}

export function computeRepairCyclesBySlice(
  events: readonly ObservabilityEvent[]
): Map<string, number> {
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

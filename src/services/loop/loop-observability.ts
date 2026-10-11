/**
 * The loop runtime's two observability emissions: the monotonic guard's verdict
 * for a cycle, and that cycle's own outcome.
 *
 * WHY BOTH MAPPINGS LIVE HERE. The two producers cannot emit for themselves:
 * `checkMonotonicImprovement` is pure (no project root, no session id —
 * `monotonic-guard.ts:83`), and the cycle bookkeeping in `runLoopLocked` has no
 * emitter. So the emit happens in the callers, and the callers are two files.
 * The mapping from loop state to event vocabulary is decided ONCE, here, rather
 * than re-derived at each call site.
 *
 * Fire-and-forget by contract: whatever `emitObservabilityEvent` returns
 * (`written: false` on every error path) is dropped, and neither helper throws.
 */

import {
  emitCycleEvent,
  emitMonotonicTriggerEvent
} from '../observability/observability-service.js';
import type { MonotonicReport } from './monotonic-guard.js';

/**
 * `monotonic-trigger` — once per computed report, from each caller of
 * `checkMonotonicImprovement`, which is pure and cannot emit for itself.
 *
 * `pass` → `report: 'pass'`; `block` → `report: 'block'`; `action` is the
 * report's own `code`, a vocabulary the guard already produces
 * (`MONOTONIC_OK` / `MONOTONIC_VIOLATION` / `MONOTONIC_NO_PREVIOUS` /
 * `MONOTONIC_INCOMPARABLE_EVALUATORS`). **`skip` emits NOTHING**: nothing was
 * guarded, so counting it would make the counter track "how often the guard ran"
 * instead of "how often a monotonic condition fired". `'warn'` stays unused —
 * the guard cannot return it, and it is not repurposed here.
 */
export function emitMonotonicReport(
  projectRoot: string,
  sid: string,
  report: MonotonicReport
): void {
  if (report.status === 'skip') return;
  emitMonotonicTriggerEvent({
    projectRoot,
    sessionId: sid,
    report: report.status,
    action: report.code
  });
}

/**
 * `cycle` — exactly ONE event per cycle, at the end of the iteration.
 *
 * One, not two: `aggregateDashboardMetrics` counts events, not distinct cycle
 * ids (`aggregation.ts:212`), so emitting `'started'` alongside this one would
 * double `cycleCount`. `'started'` therefore stays unused. `status` is
 * `'failed'` for the cycle whose report carries the violation — the same
 * condition `runLoopLocked` aborts on — and `'completed'` otherwise, so
 * `cycleCount` equals the number of cycles the driver actually ran.
 */
export function emitCycleOutcome(
  projectRoot: string,
  sid: string,
  cycle: number,
  report: MonotonicReport
): void {
  emitCycleEvent({
    projectRoot,
    sessionId: sid,
    cycle,
    status: report.monotonicityViolation ? 'failed' : 'completed'
  });
}

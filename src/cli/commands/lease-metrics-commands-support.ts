/**
 * Slice `b1-filesplit-campaign` (wave 3B) — verbatim extraction of the
 * `peaks lease-metrics` option/kind type layer and the multi-session event
 * reader out of `./lease-metrics-commands.ts` (344 raw lines > the 300 cap) so
 * that module clears the cap. No field, no default, no message string and no
 * filter changed: `lease-metrics-commands.ts` imports the names it still uses,
 * re-exports the two public ones from its own path, and
 * `./lease-stats-commands.ts` therefore needed no edit.
 *
 * `aggregateLeaseEvents` and `recomputeRate` stayed behind on purpose — each
 * carries findings, and a NEW module in this campaign must be clean outright.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  readObservabilityEvents,
  type ObservabilityEvent
} from '../../services/observability/observability-service.js';

export type LeaseMetricsOptions = {
  session?: string;
  project?: string;
  rate?: boolean;
  allSessions?: boolean;
  json?: boolean;
};

export type KindCounts = {
  spawn: number;
  renew: number;
  release: number;
  gc: number;
  autoRelease: number;
  'autoRelease-failed': number;
  'autoRelease-skipped': number;
};

export const EMPTY_COUNTS: KindCounts = {
  spawn: 0,
  renew: 0,
  release: 0,
  gc: 0,
  autoRelease: 0,
  'autoRelease-failed': 0,
  'autoRelease-skipped': 0
};

/**
 * Part 5: leak-rate + lifetime statistics.
 *
 * Leaks are leases that were spawned but neither released (manual)
 * nor auto-released nor gc'd. A naive count is
 * `spawn - release - gc - autoRelease`; the result is the number
 * of currently-alive leases in the absence of in-flight work
 * (the on-disk lease files in `.peaks/_runtime/<sid>/worktree-leases/`
 * are the canonical "alive" set; this aggregation is an estimate
 * for sessions whose files have been pruned but the metrics
 * stream survived).
 *
 * Lifetime: pair each spawn event with its first terminal event
 * (release / gc / autoRelease / autoRelease-failed) for the same
 * leaseId; the duration is the difference in milliseconds. The
 * result is an avg / p99 across the completed leases. p99 is the
 * 99th percentile; with 0-1 completed leases the field is null.
 */
export type RateStats = {
  readonly totalSpawn: number;
  readonly totalTerminal: number;
  /** spawn - terminal — leases still "alive" per the metrics stream alone. */
  readonly estimatedActive: number;
  /** Estimated leaked = active - autoRelease-failed. Positive = worktrees
   *  the user / CLI will need to gc manually. */
  readonly estimatedLeaked: number;
  readonly completedLifetimes: number;
  readonly avgLifetimeMs: number | null;
  readonly p99LifetimeMs: number | null;
};

/**
 * Part 5: enumerate every session under `.peaks/_runtime/` for a
 * project root and aggregate their lease events. Sessions without
 * a `metrics/slices.jsonl` are skipped silently (a clean project
 * has no lease events to report; that's not an error).
 */
export function readAllSessionLeaseEvents(projectRoot: string): {
  sessions: ReadonlyArray<{ sessionId: string; events: ReadonlyArray<ObservabilityEvent> }>;
  missingSessions: number;
} {
  const runtimeDir = join(projectRoot, '.peaks', '_runtime');
  if (!existsSync(runtimeDir)) return { sessions: [], missingSessions: 0 };
  let entries: ReadonlyArray<string>;
  try {
    entries = readdirSync(runtimeDir);
  } catch {
    return { sessions: [], missingSessions: 0 };
  }
  const sessions: Array<{ sessionId: string; events: ReadonlyArray<ObservabilityEvent> }> = [];
  let missing = 0;
  for (const sid of entries) {
    const sessionDir = join(runtimeDir, sid);
    try {
      if (!statSync(sessionDir).isDirectory()) continue;
    } catch {
      continue;
    }
    try {
      const all = readObservabilityEvents(projectRoot, sid);
      const leaseEvents = all.filter((e) => e.category === 'lease');
      if (leaseEvents.length === 0) {
        missing++;
        continue;
      }
      sessions.push({ sessionId: sid, events: leaseEvents });
    } catch {
      missing++;
    }
  }
  return { sessions, missingSessions: missing };
}

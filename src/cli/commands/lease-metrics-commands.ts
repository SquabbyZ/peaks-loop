/**
 * `peaks lease-metrics` — slice 2026-07-29-worktree-l2-extended Part 4.A + Part 5.
 *
 * Part 4.A: aggregate lease-kind observability events for one session,
 * render per-kind counts + a 5-event chronological tail.
 *
 * Part 5 adds:
 *   - `--rate`         : leak-rate computation (spawn - release - gc)
 *                        plus lifetime stats (avg / p99) per lease id.
 *   - `--all-sessions` : aggregate across every session under
 *                        `.peaks/_runtime/<sid>/metrics/slices.jsonl`
 *                        for the given project root. Useful for
 *                        cross-session dashboards.
 *
 * Aggregation is pure (operates on already-read ObservabilityEvent[]);
 * the IO layer is the JSONL read at the call site. The reader filters
 * on `category === 'lease'`; the schema is the same as every other
 * observability event (Part 4.A reused the existing schema v1).
 */

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import {
  readObservabilityEvents,
  type ObservabilityEvent
} from '../../services/observability/observability-service.js';

// Slice `b1-filesplit-campaign` (wave 3B): the options/kind/rate type layer,
// the EMPTY_COUNTS seed and the multi-session reader
// (`readAllSessionLeaseEvents`) moved VERBATIM to
// `./lease-metrics-commands-support.ts` so this file clears the 300 raw-line
// cap. `aggregateLeaseEvents` / `recomputeRate` stayed (they carry findings, and
// a new module must be clean outright). The two public names are re-exported
// from this path, so `./lease-stats-commands.ts` imports unchanged.
import {
  EMPTY_COUNTS,
  readAllSessionLeaseEvents,
  type KindCounts,
  type LeaseMetricsOptions,
  type RateStats
} from './lease-metrics-commands-support.js';

export { readAllSessionLeaseEvents, type RateStats };

/** Compute per-kind counts + chronological tail from a list of events. */
function aggregateLeaseEvents(leaseEvents: ReadonlyArray<ObservabilityEvent>): {
  counts: KindCounts;
  tail: ReadonlyArray<{
    ts: string;
    kind: string;
    leaseId: string;
    rid: string | null;
    reason: string | null;
  }>;
} {
  const counts: Record<string, number> = { ...EMPTY_COUNTS };
  const recent: Array<{
    ts: string;
    kind: string;
    leaseId: string;
    rid: string | null;
    reason: string | null;
  }> = [];
  for (const ev of leaseEvents) {
    const detail = ev.detail ?? {};
    const kind = typeof detail['kind'] === 'string' ? detail['kind'] : 'unknown';
    const leaseId = typeof detail['leaseId'] === 'string' ? detail['leaseId'] : '';
    const rid = typeof detail['rid'] === 'string' ? detail['rid'] : null;
    const reason = typeof detail['reason'] === 'string' ? detail['reason'] : null;
    if (kind in counts) {
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    recent.push({ ts: ev.ts, kind, leaseId, rid, reason });
  }
  recent.sort((a, b) => b.ts.localeCompare(a.ts));
  return { counts: counts as KindCounts, tail: recent.slice(0, 5) };
}

export function recomputeRate(leaseEvents: ReadonlyArray<ObservabilityEvent>): RateStats {
  // Count per-kind in one pass.
  const counts: Record<string, number> = { ...EMPTY_COUNTS };
  for (const ev of leaseEvents) {
    const detail = ev.detail ?? {};
    const kind = typeof detail['kind'] === 'string' ? detail['kind'] : 'unknown';
    if (kind in counts) {
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  }
  const totalSpawn = counts['spawn'] ?? 0;
  const totalRelease =
    (counts['release'] ?? 0) + (counts['gc'] ?? 0) + (counts['autoRelease'] ?? 0);
  const estimatedActive = Math.max(0, totalSpawn - totalRelease);
  const estimatedLeaked = Math.max(0, estimatedActive - (counts['autoRelease-failed'] ?? 0));

  // Pair each lease id: first spawn → first terminal.
  const firstSpawn = new Map<string, number>();
  const firstTerminal = new Map<string, number>();
  const tsOf = (ev: ObservabilityEvent): number => Date.parse(ev.ts);
  const leaseIdOf = (ev: ObservabilityEvent): string => {
    const d = ev.detail ?? {};
    return typeof d['leaseId'] === 'string' ? d['leaseId'] : '';
  };
  const kindOf = (ev: ObservabilityEvent): string => {
    const d = ev.detail ?? {};
    return typeof d['kind'] === 'string' ? d['kind'] : 'unknown';
  };
  for (const ev of leaseEvents) {
    const id = leaseIdOf(ev);
    if (id === '') continue;
    const t = tsOf(ev);
    const k = kindOf(ev);
    if (k === 'spawn' && !firstSpawn.has(id)) {
      firstSpawn.set(id, t);
    } else if (k === 'release' || k === 'gc' || k === 'autoRelease' || k === 'autoRelease-failed') {
      if (!firstTerminal.has(id)) firstTerminal.set(id, t);
    }
  }
  const lifetimes: number[] = [];
  for (const [id, start] of firstSpawn) {
    const end = firstTerminal.get(id);
    if (end === undefined) continue;
    const dt = end - start;
    if (dt >= 0) lifetimes.push(dt);
  }
  lifetimes.sort((a, b) => a - b);
  const avg =
    lifetimes.length === 0
      ? null
      : Math.round(lifetimes.reduce((s, v) => s + v, 0) / lifetimes.length);
  const p99 =
    lifetimes.length === 0
      ? null
      : (lifetimes[Math.min(lifetimes.length - 1, Math.floor(lifetimes.length * 0.99))] ?? null);
  return {
    totalSpawn,
    totalTerminal: totalRelease,
    estimatedActive,
    estimatedLeaked,
    completedLifetimes: lifetimes.length,
    avgLifetimeMs: avg,
    p99LifetimeMs: p99
  };
}

export function registerLeaseMetricsCommand(parent: Command, io: ProgramIO): void {
  addJsonOption(
    parent
      .command('lease-metrics')
      .description(
        'Aggregate lease-kind observability events. Default: per-kind counts + 5-event tail for the current session. --rate: leak rate + lifetime stats. --all-sessions: aggregate across every session under .peaks/_runtime/.'
      )
      .option('--session <sid>', 'override session id (default: read .peaks/_runtime/session.json)')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
      .option('--rate', 'compute leak rate (spawn - terminal) + lifetime stats (avg / p99)')
      .option(
        '--all-sessions',
        'aggregate across every session under .peaks/_runtime/ (ignores --session)'
      )
  ).action((options: LeaseMetricsOptions) => {
    try {
      const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
      const allSessions = options.allSessions === true;
      const showRate = options.rate === true;

      if (allSessions) {
        // Aggregate across every session.
        const { sessions, missingSessions } = readAllSessionLeaseEvents(projectRoot);
        const allEvents: ObservabilityEvent[] = sessions.flatMap((s) => s.events);
        const { counts, tail } = aggregateLeaseEvents(allEvents);
        const rate = showRate ? recomputeRate(allEvents) : null;
        const envelope: Record<string, unknown> = {
          mode: 'all-sessions',
          projectRoot,
          sessionCount: sessions.length,
          missingSessions,
          sessions: sessions.map((s) => ({ sessionId: s.sessionId, leaseEvents: s.events.length })),
          totalEvents: allEvents.length,
          counts,
          tail
        };
        if (rate !== null) envelope['rate'] = rate;
        printResult(
          io,
          ok(
            'lease.metrics',
            envelope,
            [],
            [
              `${sessions.length} session(s) reported lease events; ${missingSessions} session(s) had no events.`,
              showRate && rate !== null
                ? `${rate.estimatedActive} estimated active, ${rate.estimatedLeaked} estimated leaked across sessions.`
                : 'Pass --rate to see leak-rate + lifetime stats.'
            ]
          ),
          options.json
        );
        return;
      }

      // Single-session path (the Part 4.A default).
      const sessionId =
        options.session ??
        process.env.PEAKS_SESSION_ID ??
        getCurrentSessionId(projectRoot) ??
        'unknown-sid';
      const allEvents = readObservabilityEvents(projectRoot, sessionId);
      const leaseEvents = allEvents.filter((e) => e.category === 'lease');
      const { counts, tail } = aggregateLeaseEvents(leaseEvents);
      const rate = showRate ? recomputeRate(leaseEvents) : null;
      const envelope: Record<string, unknown> = {
        mode: 'single-session',
        sessionId,
        projectRoot,
        totalEvents: allEvents.length,
        leaseEvents: leaseEvents.length,
        counts,
        tail
      };
      if (rate !== null) envelope['rate'] = rate;
      printResult(
        io,
        ok(
          'lease.metrics',
          envelope,
          [],
          [
            `${leaseEvents.length} lease-kind events recorded for session ${sessionId}.`,
            showRate && rate !== null
              ? `${rate.estimatedActive} estimated active, ${rate.estimatedLeaked} estimated leaked.`
              : 'Run `peaks audit metrics --project .` for the full observability dashboard, or pass --rate / --all-sessions.'
          ]
        ),
        options.json
      );
    } catch (err) {
      printResult(
        io,
        fail(
          'lease.metrics',
          'METRICS_READ_FAILED',
          err instanceof Error ? err.message : String(err),
          { sessionId: options.session },
          [
            'Verify the project root + session id are correct.',
            'For the full observability stream, run `peaks audit metrics --project .`.'
          ]
        ),
        options.json
      );
      process.exitCode = 1;
    }
  });
}

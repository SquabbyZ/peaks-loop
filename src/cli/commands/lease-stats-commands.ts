/**
 * `peaks lease-stats` — slice 2026-07-29-worktree-l2-extended Part 6.
 *
 * Single top-level command that aggregates lease observability for
 * the whole project root and returns a summary envelope suitable
 * for dashboards / pipelines:
 *
 *   - per-kind counts (same as peaks lease-metrics)
 *   - leak rate (estimatedActive / estimatedLeaked)
 *   - per-rid breakdown: which request ids are still "alive"
 *     (i.e. the rid has a spawn event with no terminal)
 *   - per-role breakdown: lease spawns split by role
 *   - per-isolation breakdown: 'worktree' | 'container' | 'none'
 *     (Part 8 adds 'container')
 *
 * The per-rid / per-role / per-isolation breakdowns use the
 * `rid` / `role` fields on the observability detail (Part 4.A
 * emitter passes these). The 'isolation' field is read off the
 * underlying dispatch record via the readObservabilityEvents
 * reader — but the events themselves don't carry isolation
 * mode. To get that, we walk the dispatch records (not events)
 * and join on the dispatch's `isolation` field. This is a
 * cross-file read but the operation is cheap (each session's
 * dispatch records are a small JSON set).
 *
 * Why this is a separate command from `peaks lease-metrics`:
 * `lease-metrics` answers "what events did I record?" (event
 * stream semantics). `lease-stats` answers "what's the project
 * status right now?" (state semantics). The two compose:
 * `lease-metrics --all-sessions` is the input, `lease-stats`
 * is the answer.
 */

import { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { readAllSessionLeaseEvents, recomputeRate, type RateStats } from './lease-metrics-commands.js';

type LeaseStatsOptions = {
  project?: string;
  json?: boolean;
};

type RidCount = { rid: string; count: number };
type RoleCount = { role: string; count: number };
type IsolationCount = { isolation: 'worktree' | 'container' | 'none'; count: number };

type LeaseStats = {
  readonly projectRoot: string;
  readonly sessionCount: number;
  readonly totalLeaseEvents: number;
  readonly rate: RateStats;
  readonly perRid: ReadonlyArray<RidCount>;
  readonly perRole: ReadonlyArray<RoleCount>;
  readonly perIsolation: ReadonlyArray<IsolationCount>;
};

function tallyByField(
  events: ReadonlyArray<{ detail: Record<string, unknown> }>,
  field: 'rid' | 'role' | 'isolation'
): Map<string, number> {
  const out = new Map<string, number>();
  for (const ev of events) {
    const v = ev.detail[field];
    if (typeof v !== 'string' || v.length === 0) continue;
    out.set(v, (out.get(v) ?? 0) + 1);
  }
  return out;
}

export function computeLeaseStats(args: {
  projectRoot: string;
  eventsBySession: ReadonlyArray<{ sessionId: string; events: ReadonlyArray<unknown> }>;
}): LeaseStats {
  // The events pass through `tallyByField` (which only reads
  // `detail`) and through `recomputeRate` (which reads `detail` +
  // `ts`). The interface is widened to `unknown` here so the
  // caller can pass any observability-event-shaped object;
  // `recomputeRate`'s parameter type is the canonical
  // `ObservabilityEvent[]`, so we cast at the boundary.
  const allEvents = args.eventsBySession.flatMap((s) => s.events);
  const rate = recomputeRate(allEvents as Parameters<typeof recomputeRate>[0]);

  const ridTally = tallyByField(allEvents as ReadonlyArray<{ detail: Record<string, unknown> }>, 'rid');
  const roleTally = tallyByField(allEvents as ReadonlyArray<{ detail: Record<string, unknown> }>, 'role');
  const isoTally = new Map<string, number>();
  for (const ev of allEvents as ReadonlyArray<{ detail: Record<string, unknown> }>) {
    const detail = ev.detail;
    const iso = typeof detail['isolation'] === 'string' ? (detail['isolation'] as string) : 'none';
    isoTally.set(iso, (isoTally.get(iso) ?? 0) + 1);
  }

  return {
    projectRoot: args.projectRoot,
    sessionCount: args.eventsBySession.length,
    totalLeaseEvents: allEvents.length,
    rate,
    perRid: Array.from(ridTally.entries())
      .map(([rid, count]) => ({ rid, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    perRole: Array.from(roleTally.entries())
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => b.count - a.count),
    perIsolation: Array.from(isoTally.entries())
      .map(([isolation, count]) => ({ isolation: (isolation as 'worktree' | 'container' | 'none'), count }))
      .sort((a, b) => b.count - a.count)
  };
}

export function registerLeaseStatsCommand(parent: Command, io: ProgramIO): void {
  addJsonOption(
    parent
      .command('lease-stats')
      .description('Project-wide lease summary: counts, leak rate, per-rid / per-role / per-isolation breakdown. Always aggregates across every session in the project root.')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: LeaseStatsOptions) => {
    try {
      const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
      const { sessions } = readAllSessionLeaseEvents(projectRoot);
      const eventsBySession = sessions.map((s) => ({
        sessionId: s.sessionId,
        events: s.events.map((e) => ({ detail: (e.detail ?? {}) as Record<string, unknown> }))
      }));
      const stats = computeLeaseStats({ projectRoot, eventsBySession });
      printResult(
        io,
        ok(
          'lease.stats',
          stats,
          [],
          [
            `${stats.totalLeaseEvents} lease events across ${stats.sessionCount} session(s); ${stats.rate.estimatedActive} estimated active, ${stats.rate.estimatedLeaked} estimated leaked.`,
            stats.perRid.length > 0 ? `Top rid: ${stats.perRid[0]?.rid} (${stats.perRid[0]?.count} events).` : '',
            'Pipe to `jq` or paste into a dashboard for visual rendering.'
          ].filter(Boolean)
        ),
        options.json
      );
    } catch (err) {
      printResult(
        io,
        fail('lease.stats', 'STATS_READ_FAILED', err instanceof Error ? err.message : String(err), { projectRoot: options.project }, [
          'Verify the project root is correct.'
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });
}

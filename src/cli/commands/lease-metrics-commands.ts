/**
 * `peaks lease metrics` — slice 2026-07-29-worktree-l2-extended Part 4.A.
 *
 * Reads the per-session metrics JSONL stream (`.peaks/_runtime/<sid>/
 * metrics/slices.jsonl` is the path the observability service writes;
 * the file is shared with the slice/dispatch/etc events — the lease
 * kind is filtered on read), aggregates the lease-kind events into
 * counts, and emits a single summary envelope.
 *
 * Why a CLI (not a dashboard sub-call): the LLM-side runner can call
 * this after a long session to confirm "how many leases auto-released
 * vs leaked" without booting the full observability dashboard. The
 * envelope is the same shape as the rest of peaks' `peaks <cmd> --json`
 * primitives, so it's composable.
 *
 * Aggregation:
 *   - Total events read, malformed-line count (for audit)
 *   - Per-kind count: spawn / renew / release / gc / autoRelease /
 *     autoRelease-failed / autoRelease-skipped
 *   - Top 5 most-recent events (chronological tail) for spot-check
 */

import { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import { readObservabilityEvents } from '../../services/observability/observability-service.js';

type LeaseMetricsOptions = {
  session?: string;
  project?: string;
  json?: boolean;
};

type KindCounts = {
  spawn: number;
  renew: number;
  release: number;
  gc: number;
  autoRelease: number;
  'autoRelease-failed': number;
  'autoRelease-skipped': number;
};

export function registerLeaseMetricsCommand(parent: Command, io: ProgramIO): void {
  // Single subcommand at top level (`peaks lease-metrics`) so we
  // don't have to manage a `peaks lease` parent + subcommand split.
  // The semantically-related commands under `peaks worktree` (Part 1/2)
  // own the lifecycle verbs (spawn/release/renew/list/gc); this
  // command is the observability reader.
  addJsonOption(
    parent
      .command('lease-metrics')
      .description('Aggregate lease-kind observability events for the current session (or --session). Returns per-kind counts + recent tail.')
      .option('--session <sid>', 'override session id (default: read .peaks/_runtime/session.json)')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: LeaseMetricsOptions) => {
    try {
      const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
      const sessionId = options.session ?? process.env.PEAKS_SESSION_ID ?? getCurrentSessionId(projectRoot) ?? 'unknown-sid';
      const allEvents = readObservabilityEvents(projectRoot, sessionId);
      const leaseEvents = allEvents.filter((e) => e.category === 'lease');

      const counts: KindCounts = {
        spawn: 0,
        renew: 0,
        release: 0,
        gc: 0,
        autoRelease: 0,
        'autoRelease-failed': 0,
        'autoRelease-skipped': 0
      };
      const recent: Array<{ ts: string; kind: string; leaseId: string; rid: string | null; reason: string | null }> = [];
      for (const ev of leaseEvents) {
        const detail = (ev.detail ?? {}) as Record<string, unknown>;
        const kind = typeof detail['kind'] === 'string' ? detail['kind'] : 'unknown';
        const leaseId = typeof detail['leaseId'] === 'string' ? detail['leaseId'] : '';
        const rid = typeof detail['rid'] === 'string' ? detail['rid'] : null;
        const reason = typeof detail['reason'] === 'string' ? detail['reason'] : null;
        if (kind in counts) {
          (counts as Record<string, number>)[kind] = ((counts as Record<string, number>)[kind] ?? 0) + 1;
        }
        recent.push({ ts: ev.ts, kind, leaseId, rid, reason });
      }
      // Sort tail by ts desc and trim to 5.
      recent.sort((a, b) => b.ts.localeCompare(a.ts));
      const tail = recent.slice(0, 5);

      printResult(
        io,
        ok(
          'lease.metrics',
          {
            sessionId,
            projectRoot,
            totalEvents: allEvents.length,
            leaseEvents: leaseEvents.length,
            counts,
            tail
          },
          [],
          [
            `${leaseEvents.length} lease-kind events recorded for session ${sessionId}.`,
            'Run `peaks audit metrics --project .` for the full observability dashboard.'
          ]
        ),
        options.json
      );
    } catch (err) {
      printResult(
        io,
        fail('lease.metrics', 'METRICS_READ_FAILED', err instanceof Error ? err.message : String(err), { sessionId: options.session }, [
          'Verify the project root + session id are correct.',
          'For the full observability stream, run `peaks audit metrics --project .`.'
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });
}

/**
 * rid-030 F-direction: `peaks dashboard summary --since <duration>`.
 *
 * Read-only 5-metric surface derived from raw observability events
 * (cycle / token / dispatch / compact / monotonic-trigger). Distinct
 * from `peaks dashboard long-run` (which reads 24h-state indicators);
 * the two commands answer different questions and intentionally
 * coexist.
 */
import type { Command } from 'commander';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { aggregateDashboardMetrics } from '../../services/observability/aggregation.js';
import { getErrorMessage, type ProgramIO } from '../cli-helpers.js';
import { __test__ as longRunTest } from './dashboard-long-run.js';

const { parseSince } = longRunTest;

export function registerDashboardSummaryCommand(dashboard: Command, io: ProgramIO): void {
  dashboard
    .command('summary')
    .description('Read-only 24h dashboard summary (5 metric classes from observability events)')
    .option('--since <duration>', 'time window (e.g. 24h, 8h, 30m); defaults to 24h', '24h')
    .option('--project <path>', 'project root (defaults to current directory)')
    .option('--session-id <sessionId>', 'explicit session id (defaults to canonical binding)')
    .option('--json', 'emit machine-readable JSON', false)
    .action(async (options: { since?: string; project?: string; sessionId?: string; json?: boolean }) => {
      const projectRoot = resolveCanonicalProjectRoot(options.project ?? process.cwd());
      const parsed = parseSince(options.since ?? '24h');
      if (!parsed.ok) {
        io.stdout((options.json === true
          ? JSON.stringify({ ok: false, code: 'INVALID_SINCE', message: parsed.error })
          : `${parsed.error}\n`) + '\n');
        process.exitCode = 1;
        return;
      }
      const since = new Date(Date.now() - parsed.ms);
      let sid: string | null = options.sessionId ?? null;
      if (!sid) {
        const { getSessionIdCanonical } = await import('../../services/session/session-manager.js');
        sid = await getSessionIdCanonical(projectRoot);
      }
      if (!sid) {
        io.stdout((options.json === true
          ? JSON.stringify({ ok: false, code: 'NO_ACTIVE_SESSION', message: 'no --session-id and no canonical binding' })
          : 'NO_ACTIVE_SESSION: no --session-id and no canonical binding\n'));
        process.exitCode = 1;
        return;
      }
      try {
        const metrics = aggregateDashboardMetrics(projectRoot, sid, since);
        const payload = {
          ok: true,
          data: {
            sessionId: sid,
            since: options.since ?? '24h',
            sinceMs: parsed.ms,
            windowStart: since.toISOString(),
            metrics
          }
        };
        io.stdout((options.json === true ? JSON.stringify(payload) : JSON.stringify(payload.data, null, 2)) + '\n');
      } catch (error) {
        io.stdout((options.json === true
          ? JSON.stringify({ ok: false, code: 'SUMMARY_READ_FAILED', message: getErrorMessage(error) })
          : `SUMMARY_READ_FAILED: ${getErrorMessage(error)}\n`) + '\n');
        process.exitCode = 1;
      }
    });
}
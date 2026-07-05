/**
 * `peaks observability <subcommand>` — Slice B/C of v2.11.1.
 *
 * Slice B ships 4 read-only subcommands (AC-1 to AC-4):
 *   - `peaks observability status`         (AC-1)
 *   - `peaks observability slices`         (AC-2)
 *   - `peaks observability fanout`         (AC-3)
 *   - `peaks observability repair-cycles`  (AC-4)
 *
 * `peaks observability report` (AC-5) lands in Slice D when the
 * markdown report formatter is implemented.
 *
 * Read-only — never writes. Reads the JSONL metrics files emitted
 * by the `peaks request transition` hook (Slice A) plus the future
 * Slice C hook sites (dispatch / checkpoint / mode-gate / context
 * / post-compact). The aggregations tolerate zero events gracefully
 * so each subcommand returns a meaningful empty result on a fresh
 * tree.
 */

import { Command } from 'commander';

import { findProjectRoot } from '../../services/config/config-safety.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { fail, ok } from '../../shared/result.js';
import { getSessionIdCanonical } from '../../services/session/session-manager.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

import {
  aggregateFanout,
  aggregateRepairCycles,
  aggregateSlices,
  aggregateStatus,
  filterByPeriod,
  periodStartIso,
  readAllSessionEvents,
  readSessionEvents,
  type Period
} from '../../services/observability/aggregation.js';
import { renderObservabilityReport } from '../../services/observability/report-formatter.js';

function resolveProjectRoot(optionProject: string | undefined): string {
  return optionProject !== undefined
    ? resolveCanonicalProjectRoot(optionProject)
    : (findProjectRoot(process.cwd()) ?? process.cwd());
}

function resolveSessionId(optionSession: string | undefined, projectRoot: string): string | undefined {
  if (optionSession !== undefined) return optionSession;
  return getSessionIdCanonical(projectRoot) ?? undefined;
}

function runStatus(io: ProgramIO, options: { project?: string; session?: string; json?: boolean }): void {
  const projectRoot = resolveProjectRoot(options.project);
  const sessionId = resolveSessionId(options.session, projectRoot);
  try {
    const events = sessionId !== undefined
      ? readSessionEvents(projectRoot, sessionId)
      : readAllSessionEvents(projectRoot);
    const status = aggregateStatus(events);
    const warnings: string[] = sessionId === undefined && status.totalEvents === 0
      ? ['No observability events found in any session — emit a slice transition via `peaks request transition` to populate.']
      : [];
    printResult(
      io,
      ok('observability.status', {
        scope: sessionId !== undefined ? { sessionId } : { allSessions: true },
        status
      }, warnings),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail('observability.status', 'OBSERVABILITY_STATUS_FAILED', getErrorMessage(error), { projectRoot }, ['Run `peaks observability slices` for per-slice detail']),
      options.json
    );
    process.exitCode = 1;
  }
}

function runSlices(io: ProgramIO, options: { project?: string; session?: string; json?: boolean }): void {
  const projectRoot = resolveProjectRoot(options.project);
  const sessionId = resolveSessionId(options.session, projectRoot);
  try {
    const events = sessionId !== undefined
      ? readSessionEvents(projectRoot, sessionId)
      : readAllSessionEvents(projectRoot);
    const slices = aggregateSlices(events);
    printResult(
      io,
      ok('observability.slices', {
        scope: sessionId !== undefined ? { sessionId } : { allSessions: true },
        total: slices.length,
        slices
      }, []),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail('observability.slices', 'OBSERVABILITY_SLICES_FAILED', getErrorMessage(error), { projectRoot }, []),
      options.json
    );
    process.exitCode = 1;
  }
}

function runFanout(io: ProgramIO, options: { project?: string; session?: string; json?: boolean }): void {
  const projectRoot = resolveProjectRoot(options.project);
  const sessionId = resolveSessionId(options.session, projectRoot);
  try {
    const events = sessionId !== undefined
      ? readSessionEvents(projectRoot, sessionId)
      : readAllSessionEvents(projectRoot);
    const fanout = aggregateFanout(events);
    const warnings: string[] = fanout.total === 0
      ? ['No dispatch events recorded yet — Slice C will wire `peaks sub-agent dispatch`; until then fanout is empty.']
      : [];
    printResult(
      io,
      ok('observability.fanout', {
        scope: sessionId !== undefined ? { sessionId } : { allSessions: true },
        fanout
      }, warnings),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail('observability.fanout', 'OBSERVABILITY_FANOUT_FAILED', getErrorMessage(error), { projectRoot }, []),
      options.json
    );
    process.exitCode = 1;
  }
}

function runRepairCycles(io: ProgramIO, options: { project?: string; session?: string; json?: boolean }): void {
  const projectRoot = resolveProjectRoot(options.project);
  const sessionId = resolveSessionId(options.session, projectRoot);
  try {
    const events = sessionId !== undefined
      ? readSessionEvents(projectRoot, sessionId)
      : readAllSessionEvents(projectRoot);
    const cycles = aggregateRepairCycles(events);
    printResult(
      io,
      ok('observability.repair-cycles', {
        scope: sessionId !== undefined ? { sessionId } : { allSessions: true },
        cycles
      }, []),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail('observability.repair-cycles', 'OBSERVABILITY_REPAIR_CYCLES_FAILED', getErrorMessage(error), { projectRoot }, []),
      options.json
    );
    process.exitCode = 1;
  }
}

const VALID_PERIODS: ReadonlyArray<Period> = ['day', 'week', 'month'];

function runReport(io: ProgramIO, options: { project?: string; session?: string; period?: string; json?: boolean }): void {
  const projectRoot = resolveProjectRoot(options.project);
  const sessionId = resolveSessionId(options.session, projectRoot);
  const period: Period = options.period !== undefined && (VALID_PERIODS as readonly string[]).includes(options.period)
    ? (options.period as Period)
    : 'day';
  try {
    const allEvents = sessionId !== undefined
      ? readSessionEvents(projectRoot, sessionId)
      : readAllSessionEvents(projectRoot);
    const periodStart = periodStartIso(period);
    const events = filterByPeriod(allEvents, period);
    const markdown = renderObservabilityReport({
      scope: sessionId !== undefined ? 'session' : 'all-sessions',
      scopeId: sessionId ?? 'all',
      period,
      generatedAt: new Date().toISOString(),
      status: aggregateStatus(events),
      slices: aggregateSlices(events),
      fanout: aggregateFanout(events),
      repairCycles: aggregateRepairCycles(events)
    });
    if (options.json === true) {
      // --json on report: emit a metadata envelope so callers can
      // machine-parse the markdown body without losing the envelope
      // contract.
      printResult(
        io,
        ok('observability.report', {
          scope: sessionId !== undefined ? { sessionId } : { allSessions: true },
          period,
          periodStart,
          totalEventsScanned: allEvents.length,
          totalEventsInPeriod: events.length,
          markdown
        }, []),
        true
      );
      return;
    }
    io.stdout(markdown);
  } catch (error) {
    printResult(
      io,
      fail('observability.report', 'OBSERVABILITY_REPORT_FAILED', getErrorMessage(error), { projectRoot }, []),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerObservabilityCommands(program: Command, io: ProgramIO): void {
  const observability = program
    .command('observability')
    .description('Read-only slice topology observability queries (v2.11.1). Reads JSONL metrics from .peaks/_runtime/<sessionId>/metrics/slices.jsonl.');

  addJsonOption(
    observability
      .command('status')
      .description('Aggregate metrics for the active session (or all sessions with --project + omitted --session). Includes totalEvents / totalSlices / successCount / failCount / repairCyclePeak / fanoutCostTotal.')
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option('--session <sessionId>', 'scope to one session (defaults to the canonical session binding)')
  ).action((options: { project?: string; session?: string; json?: boolean }) => {
    runStatus(io, options);
  });

  addJsonOption(
    observability
      .command('slices')
      .description('List all slices for the scope. Per slice: rid, transition count, first/last ts, durationMs, finalState, fanoutCount, repairCycleCount, success.')
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option('--session <sessionId>', 'scope to one session (defaults to the canonical session binding)')
  ).action((options: { project?: string; session?: string; json?: boolean }) => {
    runSlices(io, options);
  });

  addJsonOption(
    observability
      .command('fanout')
      .description('Fanout cost breakdown by sub-agent role (rd / qa / code-reviewer / karpathy-reviewer / peaks-security-audit / peaks-perf-audit; v2.12.0 collapse — `security-reviewer` removed from the role enum). Returns 0 per role until Slice C wires the `peaks sub-agent dispatch` hook.')
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option('--session <sessionId>', 'scope to one session (defaults to the canonical session binding)')
  ).action((options: { project?: string; session?: string; json?: boolean }) => {
    runFanout(io, options);
  });

  addJsonOption(
    observability
      .command('repair-cycles')
      .description('RD → QA repair-cycle count per slice. Cap = 3 (peaks-code repair-loop contract); capHit flag is set when any slice hits the cap.')
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option('--session <sessionId>', 'scope to one session (defaults to the canonical session binding)')
  ).action((options: { project?: string; session?: string; json?: boolean }) => {
    runRepairCycles(io, options);
  });

  observability
    .command('report')
    .description('Render a markdown summary suitable for paste into PR descriptions or .peaks/PROJECT.md timeline entries. Default period = day; --json emits an envelope wrapping the markdown body. Output sections: header + status summary + slice table + fanout table + repair-cycle table + top-N slowest slices.')
    .option('--project <path>', 'target project root (defaults to git root or cwd)')
    .option('--session <sessionId>', 'scope to one session (defaults to the canonical session binding)')
    .option('--period <period>', 'one of: day | week | month (defaults to day)', 'day')
    .action((options: { project?: string; session?: string; period?: string; json?: boolean }) => {
      runReport(io, options);
    });
}
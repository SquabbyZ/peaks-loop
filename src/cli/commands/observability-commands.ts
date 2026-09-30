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

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

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

// Slice `b1-filesplit-campaign` (wave 3B): the four read-only query runners
// (`runStatus` / `runSlices` / `runFanout` / `runRepairCycles`) plus the two
// scope resolvers they share moved VERBATIM to `./observability-commands-queries.ts`
// so this file clears the 300 raw-line cap. What they do is unchanged;
// `runReport` — the one function here carrying a finding — stayed behind, so no
// finding moved into the new module.
import {
  resolveProjectRoot,
  resolveSessionId,
  runFanout,
  runRepairCycles,
  runSlices,
  runStatus
} from './observability-commands-queries.js';

const VALID_PERIODS: ReadonlyArray<Period> = ['day', 'week', 'month'];

function runReport(
  io: ProgramIO,
  options: { project?: string; session?: string; period?: string; json?: boolean }
): void {
  const projectRoot = resolveProjectRoot(options.project);
  const sessionId = resolveSessionId(options.session, projectRoot);
  const period: Period =
    options.period !== undefined && (VALID_PERIODS as readonly string[]).includes(options.period)
      ? (options.period as Period)
      : 'day';
  try {
    const allEvents =
      sessionId !== undefined
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
        ok(
          'observability.report',
          {
            scope: sessionId !== undefined ? { sessionId } : { allSessions: true },
            period,
            periodStart,
            totalEventsScanned: allEvents.length,
            totalEventsInPeriod: events.length,
            markdown
          },
          []
        ),
        true
      );
      return;
    }
    io.stdout(markdown);
  } catch (error) {
    printResult(
      io,
      fail(
        'observability.report',
        'OBSERVABILITY_REPORT_FAILED',
        getErrorMessage(error),
        { projectRoot },
        []
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerObservabilityCommands(program: Command, io: ProgramIO): void {
  const observability = program
    .command('observability')
    .description(
      'Read-only slice topology observability queries (v2.11.1). Reads JSONL metrics from .peaks/_runtime/<sessionId>/metrics/slices.jsonl.'
    );

  addJsonOption(
    observability
      .command('status')
      .description(
        'Aggregate metrics for the active session (or all sessions with --project + omitted --session). Includes totalEvents / totalSlices / successCount / failCount / repairCyclePeak / fanoutCostTotal.'
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option(
        '--session <sessionId>',
        'scope to one session (defaults to the canonical session binding)'
      )
  ).action((options: { project?: string; session?: string; json?: boolean }) => {
    runStatus(io, options);
  });

  addJsonOption(
    observability
      .command('slices')
      .description(
        'List all slices for the scope. Per slice: rid, transition count, first/last ts, durationMs, finalState, fanoutCount, repairCycleCount, success.'
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option(
        '--session <sessionId>',
        'scope to one session (defaults to the canonical session binding)'
      )
  ).action((options: { project?: string; session?: string; json?: boolean }) => {
    runSlices(io, options);
  });

  addJsonOption(
    observability
      .command('fanout')
      .description(
        'Fanout cost breakdown by sub-agent role (rd / qa / code-reviewer / karpathy-reviewer / peaks-security-audit / peaks-perf-audit; v2.12.0 collapse — `security-reviewer` removed from the role enum). Returns 0 per role until Slice C wires the `peaks sub-agent dispatch` hook.'
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option(
        '--session <sessionId>',
        'scope to one session (defaults to the canonical session binding)'
      )
  ).action((options: { project?: string; session?: string; json?: boolean }) => {
    runFanout(io, options);
  });

  addJsonOption(
    observability
      .command('repair-cycles')
      .description(
        'RD → QA repair-cycle count per slice. Cap = 3 (peaks-code repair-loop contract); capHit flag is set when any slice hits the cap.'
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option(
        '--session <sessionId>',
        'scope to one session (defaults to the canonical session binding)'
      )
  ).action((options: { project?: string; session?: string; json?: boolean }) => {
    runRepairCycles(io, options);
  });

  observability
    .command('report')
    .description(
      'Render a markdown summary suitable for paste into PR descriptions or .peaks/PROJECT.md timeline entries. Default period = day; --json emits an envelope wrapping the markdown body. Output sections: header + status summary + slice table + fanout table + repair-cycle table + top-N slowest slices.'
    )
    .option('--project <path>', 'target project root (defaults to git root or cwd)')
    .option(
      '--session <sessionId>',
      'scope to one session (defaults to the canonical session binding)'
    )
    .option('--period <period>', 'one of: day | week | month (defaults to day)', 'day')
    .action((options: { project?: string; session?: string; period?: string; json?: boolean }) => {
      runReport(io, options);
    });
}

/**
 * `peaks observability <subcommand>` — Slice B/C of v2.11.1.
 *
 *
 * markdown report formatter is implemented.
 *
 * Read-only over the JSONL metrics files emitted
 * by the `peaks request transition` hook (Slice A) plus the future
 * Slice C hook sites (dispatch / checkpoint / mode-gate / context
 * / post-compact). The aggregations tolerate zero events gracefully
 * so each subcommand returns a meaningful empty result on a fresh
 * tree.
 *
 * ONE EXCEPTION TO THE READ-ONLY RULE: `peaks observability baseline
 * --write` regenerates the tracked results-layer baseline at
 * `.peaks/observability/results-baseline.json`. It is the only command
 * here that writes, and it exists because the results layer needs a
 * baseline that can be regenerated and compared on demand.
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
  type Period
} from '../../services/observability/aggregation.js';
import { renderObservabilityReport } from '../../services/observability/report-formatter.js';
import { computeNearMiss } from '../../services/observability/near-miss.js';
import { aggregateHotspots } from '../../services/observability/hotspots.js';
import type { ObservabilityEvent } from '../../services/observability/observability-service.js';

// Slice `b1-filesplit-campaign` (wave 3B): the four read-only query runners
// (`runStatus` / `runSlices` / `runFanout` / `runRepairCycles`) plus the two
// scope resolvers they share moved VERBATIM to `./observability-commands-queries.ts`
// so this file clears the 300 raw-line cap. What they do is unchanged;
// `runReport` — the one function here carrying a finding — stayed behind, so no
// finding moved into the new module.
import {
  readScopedEvents,
  resolveProjectRoot,
  runFanout,
  runRepairCycles,
  runSlices,
  runStatus,
  scopeOf,
  scopeWarnings,
  type ObservabilityQueryOptions
} from './observability-commands-queries.js';
import { runBaseline } from './observability-commands-baseline.js';
import { registerNearMissCommand } from './observability-commands-near-miss.js';
import { hotspotRequestTypes, registerHotspotsCommand } from './observability-commands-hotspots.js';

const VALID_PERIODS: ReadonlyArray<Period> = ['day', 'week', 'month'];

/** The `--all-sessions` help text, ONE string for every command that carries it. */
const ALL_SESSIONS_DESCRIPTION =
  'measure the whole recorded history of the project instead of the canonical session binding';

/**
 * The warning a report carries when its PERIOD emptied the result.
 *
 * The scope and the period are two different axes: `--all-sessions` widens
 * WHICH sessions are read, `--period` narrows WHICH DAYS of them count. A
 * reader who scoped correctly and still saw an empty table was narrowed by
 * the period, so the warning says the scope holds events and names the
 * period window that reaches the most of them.
 */
function periodWarnings(
  scopedEvents: readonly ObservabilityEvent[],
  period: Period,
  now: () => Date
): string[] {
  if (scopedEvents.length === 0) return [];
  if (filterByPeriod(scopedEvents, period, now).length > 0) return [];
  let reaching: Period | undefined;
  let reachingCount = 0;
  for (const candidate of VALID_PERIODS) {
    const count = filterByPeriod(scopedEvents, candidate, now).length;
    if (count > 0 && count >= reachingCount) {
      reaching = candidate;
      reachingCount = count;
    }
  }
  if (reaching === undefined) {
    return [
      `No observability events fall inside the \`${period}\` period, and the scope's ` +
        `${scopedEvents.length} event(s) are older than every period window — ` +
        'no `--period` value reaches them.'
    ];
  }
  return [
    `No observability events fall inside the \`${period}\` period, though the scope holds ` +
      `${scopedEvents.length} event(s) — use \`--period ${reaching}\` to read them.`
  ];
}

function runReport(io: ProgramIO, options: ObservabilityQueryOptions & { period?: string }): void {
  const projectRoot = resolveProjectRoot(options.project);
  const period: Period =
    options.period !== undefined && (VALID_PERIODS as readonly string[]).includes(options.period)
      ? (options.period as Period)
      : 'day';
  try {
    const { sessionId, events: allEvents } = readScopedEvents(projectRoot, options);
    // ONE clock for the whole report: the window the events are filtered by
    // and the window the warning names must be the same one.
    const at = new Date();
    const now = (): Date => new Date(at);
    const periodStart = periodStartIso(period, now);
    const events = filterByPeriod(allEvents, period, now);
    // The two measurements the report leads with. The request types are
    // resolved through the hotspots command's own lookup, so the ranking in
    // the report and the ranking the `hotspots` command prints cannot drift.
    const { requestTypes } = hotspotRequestTypes(projectRoot, events);
    const warnings = [
      ...scopeWarnings(projectRoot, sessionId, allEvents.length),
      ...periodWarnings(allEvents, period, now)
    ];
    const markdown = renderObservabilityReport({
      scope: sessionId !== undefined ? 'session' : 'all-sessions',
      scopeId: sessionId ?? 'all',
      period,
      generatedAt: at.toISOString(),
      status: aggregateStatus(events),
      slices: aggregateSlices(events),
      fanout: aggregateFanout(events),
      repairCycles: aggregateRepairCycles(events),
      nearMiss: computeNearMiss(events, requestTypes),
      hotspots: aggregateHotspots(events, requestTypes),
      warnings
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
            scope: scopeOf(sessionId),
            period,
            periodStart,
            totalEventsScanned: allEvents.length,
            totalEventsInPeriod: events.length,
            markdown
          },
          warnings
        ),
        true
      );
      return;
    }
    // The warnings are IN the markdown header: the body is what gets pasted.
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
        'Aggregate metrics for the active session (or all sessions with --project + omitted --session). Includes totalEvents / totalSlices / successCount / failCount / stalledCount / repairCyclePeak / fanoutCostTotal.'
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option(
        '--session <sessionId>',
        'scope to one session (defaults to the canonical session binding)'
      )
      .option('--all-sessions', ALL_SESSIONS_DESCRIPTION)
  ).action((options: ObservabilityQueryOptions) => {
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
      .option('--all-sessions', ALL_SESSIONS_DESCRIPTION)
  ).action((options: ObservabilityQueryOptions) => {
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
      .option('--all-sessions', ALL_SESSIONS_DESCRIPTION)
  ).action((options: ObservabilityQueryOptions) => {
    runFanout(io, options);
  });

  addJsonOption(
    observability
      .command('repair-cycles')
      .description(
        'RD → QA repair-cycle count per slice (metric version 2: a repair cycle is a return to an RD work state after a QA phase). Cap = 3 (peaks-code repair-loop contract); capHit flag is set when any slice hits the cap. The version-1 qa-role event count is reported beside it as legacyQaEventCount — it is NOT a repair-cycle count.'
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option(
        '--session <sessionId>',
        'scope to one session (defaults to the canonical session binding)'
      )
      .option('--all-sessions', ALL_SESSIONS_DESCRIPTION)
  ).action((options: ObservabilityQueryOptions) => {
    runRepairCycles(io, options);
  });

  addJsonOption(
    observability
      .command('baseline')
      .description(
        'Results-layer baseline over the whole recorded history. Prints the computed baseline; --write regenerates the tracked artifact at .peaks/observability/results-baseline.json; --check compares the computed baseline with the tracked one and reports drift. The tracked artifact is NOT CI-enforceable: its source data is gitignored session state.'
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option('--write', 'regenerate the tracked results baseline artifact')
      .option(
        '--check',
        'compare the computed baseline against the tracked artifact and report drift'
      )
  ).action((options: { project?: string; json?: boolean; write?: boolean; check?: boolean }) => {
    runBaseline(io, options);
  });

  addJsonOption(
    observability
      .command('report')
      .description(
        'Render a markdown summary suitable for paste into PR descriptions or .peaks/PROJECT.md timeline entries. Default period = day; --json emits an envelope wrapping the markdown body. Output sections: header + status summary + near-miss section (rate, denominator, per-class coverage, unobserved classes) + slice table + hotspot tables + fanout table + repair-cycle table + top-N slowest slices.'
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option(
        '--session <sessionId>',
        'scope to one session (defaults to the canonical session binding)'
      )
      .option('--period <period>', 'one of: day | week | month (defaults to day)', 'day')
      .option('--all-sessions', ALL_SESSIONS_DESCRIPTION)
  ).action((options: ObservabilityQueryOptions & { period?: string }) => {
    runReport(io, options);
  });

  registerNearMissCommand(observability, io);
  registerHotspotsCommand(observability, io);
}

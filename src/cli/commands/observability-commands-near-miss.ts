/**
 * `src/cli/commands/observability-commands-near-miss.ts`
 *
 * `peaks observability near-miss` — the headline number of the whole
 * programme: of the slices that passed, how many passed anyway after a gate
 * that was live never got evaluated?
 *
 * WHY THE REGISTRATION LIVES HERE AND NOT IN `observability-commands.ts`.
 * That file is at its file-size cap and a later task needs room in it too,
 * so each subcommand's registration lives in its own module and the parent
 * gains one import and one call. The precedent is the sibling split of
 * `observability-commands-queries.ts` and `observability-commands-baseline.ts`.
 *
 * WHY THE SCOPE BEHAVES LIKE THE OTHER QUERIES. The scope resolution, the
 * `--all-sessions` escape and the empty-scope warning are the shared ones in
 * `observability-commands-queries.ts`, so this command measures the same
 * population its siblings report and says so the same way when it is empty.
 */

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import {
  computeNearMiss,
  type NearMissClassCoverage
} from '../../services/observability/near-miss.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  readScopedEvents,
  resolveProjectRoot,
  scopeOf,
  scopeWarnings,
  type ObservabilityQueryOptions
} from './observability-commands-queries.js';

/**
 * The warning that says a reason class had no events to observe.
 *
 * A class with no events cannot produce a finding, so its share of the rate
 * is an ABSENCE OF DATA. Saying nothing would let a reader take the rate for
 * "no near-misses" when the truth is "this class was never looked at" — the
 * exact misreading the metric exists to prevent.
 */
function coverageWarnings(coverage: readonly NearMissClassCoverage[]): string[] {
  return coverage
    .filter((item) => !item.observable)
    .map(
      (item) =>
        `The \`${item.reason}\` class had NO events to observe in this scope ` +
        `(${item.scopeEventCount} event(s)), so its share of the near-miss rate is an ` +
        'absence of data, not a result — the rate does not measure that class.'
    );
}

/**
 * `peaks observability near-miss` — print the near-miss rate and the list of
 * slices it came from.
 */
export function runNearMiss(io: ProgramIO, options: ObservabilityQueryOptions): void {
  const projectRoot = resolveProjectRoot(options.project);
  try {
    const { sessionId, events } = readScopedEvents(projectRoot, options);
    const report = computeNearMiss(events);
    const warnings = [
      ...scopeWarnings(projectRoot, sessionId, events.length),
      ...coverageWarnings(report.coverage)
    ];
    printResult(
      io,
      ok('observability.near-miss', { scope: scopeOf(sessionId), ...report }, warnings),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail(
        'observability.near-miss',
        'OBSERVABILITY_NEAR_MISS_FAILED',
        getErrorMessage(error),
        { projectRoot },
        []
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

/** Register `peaks observability near-miss` under the observability command. */
export function registerNearMissCommand(observability: Command, io: ProgramIO): void {
  addJsonOption(
    observability
      .command('near-miss')
      .description(
        'Near-miss rate: of the slices that reached a QA verdict, how many passed anyway after a live gate never got evaluated (a `bypass`, or no verdict at all). Also reports the prerequisite failures that were NEVER satisfied on the way to the verdict, and the gates whose liveness the event stream did not decide. The `coverage` field says, per reason class, whether that class had any events to observe: a class with none was not measured, so its share of the rate is an absence of data rather than a result.'
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option(
        '--session <sessionId>',
        'scope to one session (defaults to the canonical session binding)'
      )
      .option(
        '--all-sessions',
        'measure the whole recorded history of the project instead of the canonical session binding'
      )
  ).action((options: ObservabilityQueryOptions) => {
    runNearMiss(io, options);
  });
}

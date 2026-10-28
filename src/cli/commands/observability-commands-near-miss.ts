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
  type NearMissClassCoverage,
  type NearMissDenominator,
  type NearMissUnmeasured
} from '../../services/observability/near-miss.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { hotspotRequestTypes } from './observability-commands-hotspots.js';
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
 * The warning that says the denominator differs from the status summary's.
 *
 * "Passed" has two definitions in this repository and they do not count the
 * same slices. A reader who sees one number and assumes it is the other's
 * would be wrong, so the difference is stated rather than smoothed over.
 */
function denominatorWarnings(denominator: NearMissDenominator): string[] {
  if (denominator.difference === null) return [];
  return [denominator.difference.note];
}

/**
 * The warning that says a slice could not be measured at all.
 *
 * A slice whose `verdict-issued` attempt records a prereq verdict this build
 * cannot read is in neither the numerator nor the denominator, so a reader who
 * adds up the slices finds one missing. Saying nothing would let them infer
 * it was never there.
 */
function unmeasuredWarnings(unmeasured: readonly NearMissUnmeasured[]): string[] {
  if (unmeasured.length === 0) return [];
  return [
    `${unmeasured.length} slice(s) recorded a \`verdict-issued\` attempt whose prereq verdict this ` +
      'build cannot read, so whether they passed is unknown — they are in neither the numerator ' +
      `nor the denominator: ${unmeasured.map((item) => `\`${item.sliceRid}\``).join(', ')}`
  ];
}

/**
 * `peaks observability near-miss` — print the near-miss rate and the list of
 * slices it came from.
 */
export function runNearMiss(io: ProgramIO, options: ObservabilityQueryOptions): void {
  const projectRoot = resolveProjectRoot(options.project);
  try {
    const { sessionId, events } = readScopedEvents(projectRoot, options);
    // The request types let the denominator NAME the cause of the gap between
    // the two "passed" definitions: the slices that reached a verdict with no
    // recorded prereq verdict are the ones whose type has no
    // `qa:verdict-issued` prerequisite row at all.
    const { requestTypes } = hotspotRequestTypes(projectRoot, events);
    const report = computeNearMiss(events, requestTypes);
    const warnings = [
      ...scopeWarnings(projectRoot, sessionId, events.length),
      ...coverageWarnings(report.coverage),
      ...denominatorWarnings(report.denominator),
      ...unmeasuredWarnings(report.unmeasured)
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
        'Near-miss rate: of the slices that were DECLARED PASSING (a `verdict-issued` attempt whose prereq check succeeded), how many passed anyway after a required check was still unsatisfied at that moment, or after a live gate never got evaluated? The `denominator` field states the definition and size of the population the rate divides by, and reconciles it with the status summary\'s success count — the two "passed" definitions do not count the same slices, and the difference is reported rather than smoothed over. The `coverage` field says, per reason class, whether that class had any events to observe: a class with none was not measured, so its share of the rate is an absence of data rather than a result.'
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

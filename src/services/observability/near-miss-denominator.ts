/**
 * `src/services/observability/near-miss-denominator.ts`
 *
 * The denominator the near-miss rate divides by, and its reconciliation with
 * the status summary's success count.
 *
 * WHY THIS EXISTS. "Passed" has TWO definitions in this repository, and they
 * do not count the same slices:
 *
 *   - the STATUS SUMMARY counts a slice successful when its FINAL state is one
 *     of the terminal-happy states (`handed-off`, `verdict-issued`, …);
 *   - the NEAR-MISS metric counts a slice passed when it recorded a
 *     SUCCESSFUL `verdict-issued` attempt — the attempt whose prereq check
 *     passed, which is the moment the slice was declared passing.
 *
 * On this repository's recorded history the status summary counts 103
 * successes and the near-miss denominator holds 94 slices. The gap is REAL
 * and it is not noise, so the output states both numbers and says what the
 * gap is made of. Silently aligning one to the other by fiat would hide the
 * very thing the reader needs to see.
 *
 * WHY THE NOTE NAMES A CAUSE RATHER THAN A MISSING TRACE. Seventeen of the
 * gap slices recorded no successful verdict attempt, and seven of those
 * reached a `verdict-issued` event with no prereq verdict beside it. It is
 * tempting to read that as "the check ran and left no record" — but it is
 * not what happened, and saying so would send a reader hunting for an
 * emitter bug that does not exist. The prereq check RETURNS EARLY when the
 * request type's table has no row for the transition being checked, before
 * it emits anything. The `docs` and `chore` types use a minimal table with
 * no `qa:verdict-issued` row, so that transition has NO prerequisite to
 * verify it against and the check has nothing to record. The pass was never
 * gated, rather than gated-and-unrecorded.
 *
 * WHY THE ROLLUPS COME FROM THE AGGREGATION. The comparison is only
 * meaningful if the status side is computed by the SAME code the status
 * summary uses, so the reconciliation cannot drift from the number it
 * reconciles with. `aggregateSlices` is that code.
 *
 * WHY THE RECONCILIATION IS A COUNT AND NOT A STORY. Each side of the gap is
 * counted, so a reader can check the arithmetic: the status count, minus the
 * slices it counts that have no pass moment, plus the slices that have a
 * pass moment it does not count, is the near-miss denominator.
 */

import { aggregateSlices, type SliceRollup } from './aggregation.js';
import { passMomentOf, collectAttempts, VERDICT_STATE } from './near-miss-attempts.js';
import { getPrerequisitesFor, type RequestType } from '../artifacts/artifact-prerequisites.js';
import type { RequestTypeReading } from './hotspot-shared.js';
import type { ObservabilityEvent } from './observability-service.js';

/**
 * The definition of "passed" the near-miss metric divides by, and how it
 * relates to the status summary's success count.
 */
export type NearMissDenominator = {
  /** What "passed" means here, in words a reader can check. */
  readonly definition: string;
  /** How many slices that definition admits — the rate's denominator. */
  readonly sliceCount: number;
  /**
   * The status summary's success count over the same events.
   *
   * It is reported even when it AGREES, so a reader who compares the two
   * numbers is never left guessing whether they were compared at all.
   */
  readonly statusSuccessCount: number;
  /** The reconciliation, or null when the two counts agree. */
  readonly difference: NearMissDenominatorDifference | null;
};

/** What the gap between the two "passed" definitions is made of. */
export type NearMissDenominatorDifference = {
  /**
   * Slices the status summary counts as successful that recorded no
   * successful verdict attempt.
   */
  readonly successWithoutPassMoment: number;
  /**
   * Of those, the ones that reached a `verdict-issued` EVENT whose prereq
   * verdict was never recorded.
   */
  readonly successWithoutPassMomentButReachedVerdict: number;
  /**
   * The request types those slices had.
   *
   * WHY THIS IS THE CAUSE, NOT A SYMPTOM. The prereq event is emitted by the
   * prerequisite check, and the check RETURNS EARLY when the request type's
   * table has no row for the transition being checked — so no event is
   * emitted at all. The `docs` and `chore` types use a minimal table with no
   * `qa:verdict-issued` row, so the verdict transition has NO prerequisite to
   * verify it against and the check has nothing to record.
   *
   * So the pass was not "unverified" — it was never gated, because there was
   * no gate there. Saying "the check left no trace" would send a reader
   * hunting for an emitter bug that does not exist.
   */
  readonly typesWithoutVerdictPrerequisite: readonly RequestType[];
  /**
   * The slices of those types — the concrete referents for the count.
   */
  readonly slicesWithoutVerdictPrerequisite: readonly string[];
  /**
   * Slices that recorded a successful verdict attempt but the status summary
   * does not count as successful — they were sent back for rework after the
   * verdict, so their final state is not a terminal-happy one.
   */
  readonly passMomentWithoutStatusSuccess: number;
  /** The reconciliation, spelled out. */
  readonly note: string;
};

/** The definition, stated once, so the output and the source agree. */
export const PASSED_DEFINITION =
  'a slice that recorded a SUCCESSFUL `verdict-issued` attempt — a `verdict-issued` ' +
  'transition attempt whose prereq check passed, which is the moment the slice was ' +
  'declared passing. A `verdict-issued` attempt whose check FAILED is a refused ' +
  'transition, not a pass.';

/**
 * The count of each way the two "passed" definitions can disagree.
 *
 * The two sides are counted separately so the note can be built from them,
 * and so the note's arithmetic is checkable by a reader.
 */
function countDifferences(
  events: readonly ObservabilityEvent[],
  rollups: readonly SliceRollup[],
  requestTypes: ReadonlyMap<string, RequestTypeReading>
): {
  readonly successWithoutPassMoment: number;
  readonly successWithoutPassMomentButReachedVerdict: number;
  readonly typesWithoutVerdictPrerequisite: readonly RequestType[];
  readonly slicesWithoutVerdictPrerequisite: readonly string[];
  readonly passMomentWithoutStatusSuccess: number;
} {
  let successWithoutPassMoment = 0;
  let successWithoutPassMomentButReachedVerdict = 0;
  let passMomentWithoutStatusSuccess = 0;
  const types = new Set<RequestType>();
  const slices: string[] = [];
  for (const rollup of rollups) {
    const sliceEvents = events.filter(
      (event) => event.category === 'slice-transition' && event.sliceRid === rollup.sliceRid
    );
    const attempts = collectAttempts(sliceEvents);
    const hasPassMoment = passMomentOf(attempts) !== null;
    if (rollup.success && !hasPassMoment) {
      successWithoutPassMoment += 1;
      const reachedVerdict = sliceEvents.some(
        (event) => (event.detail as { to?: unknown }).to === VERDICT_STATE
      );
      if (reachedVerdict) {
        successWithoutPassMomentButReachedVerdict += 1;
        const reading = requestTypes.get(rollup.sliceRid);
        // The cause: the type's prerequisite table has NO row for the
        // `qa -> verdict-issued` transition, so the check had nothing to
        // verify and emitted no event. The pass was never gated, rather
        // than gated-and-unrecorded.
        if (reading !== undefined && !hasVerdictPrerequisite(reading.requestType)) {
          types.add(reading.requestType);
          slices.push(rollup.sliceRid);
        }
      }
    }
    if (!rollup.success && hasPassMoment) passMomentWithoutStatusSuccess += 1;
  }
  return {
    successWithoutPassMoment,
    successWithoutPassMomentButReachedVerdict,
    typesWithoutVerdictPrerequisite: [...types].sort(),
    slicesWithoutVerdictPrerequisite: slices.sort(),
    passMomentWithoutStatusSuccess
  };
}

/**
 * Whether a request type's prerequisite table has a row for the verdict
 * transition.
 *
 * The prereq check RETURNS EARLY when the table has no row for the
 * transition being checked — before it emits anything — so a type with no
 * `qa:verdict-issued` row has no event to record for that transition. The
 * `docs` and `chore` types use a minimal table with no such row.
 */
function hasVerdictPrerequisite(type: RequestType): boolean {
  return getPrerequisitesFor('qa', 'verdict-issued', type).length > 0;
}

/**
 * The denominator, and its reconciliation with the status summary.
 *
 * The status side comes from the aggregation's own rollup, so the number this
 * reconciles with is the number the status summary reports.
 */
export function describeDenominator(
  events: readonly ObservabilityEvent[],
  sliceCount: number,
  requestTypes: ReadonlyMap<string, RequestTypeReading> = new Map()
): NearMissDenominator {
  const rollups = aggregateSlices(events);
  const statusSuccessCount = rollups.filter((rollup) => rollup.success).length;
  if (statusSuccessCount === sliceCount) {
    return {
      definition: PASSED_DEFINITION,
      sliceCount,
      statusSuccessCount,
      difference: null
    };
  }
  const counts = countDifferences(events, rollups, requestTypes);
  return {
    definition: PASSED_DEFINITION,
    sliceCount,
    statusSuccessCount,
    difference: {
      ...counts,
      note: differenceNote(statusSuccessCount, sliceCount, counts)
    }
  };
}

/**
 * The reconciliation, in words.
 *
 * WHY IT NAMES THE CAUSE. The slices that reached a `verdict-issued` event
 * with no recorded prereq verdict were NOT "unverified" — the request types
 * they had have no `qa:verdict-issued` prerequisite row at all, so the
 * transition had no check to verify it against and the check had nothing to
 * record. Saying the check "left no trace" would send a reader hunting for
 * an emitter bug that does not exist.
 */
function differenceNote(
  statusSuccessCount: number,
  sliceCount: number,
  counts: {
    readonly successWithoutPassMoment: number;
    readonly successWithoutPassMomentButReachedVerdict: number;
    readonly typesWithoutVerdictPrerequisite: readonly RequestType[];
    readonly slicesWithoutVerdictPrerequisite: readonly string[];
    readonly passMomentWithoutStatusSuccess: number;
  }
): string {
  const base =
    `The status summary counts ${statusSuccessCount} slices successful (final state is a ` +
    `terminal-happy state); this metric counts ${sliceCount} passed (a successful ` +
    `\`verdict-issued\` attempt). The gap is ${counts.successWithoutPassMoment} slice(s) the ` +
    'status counts successful with no successful verdict attempt';
  const cause =
    counts.typesWithoutVerdictPrerequisite.length === 0
      ? ` — ${counts.successWithoutPassMomentButReachedVerdict} of which reached a ` +
        '`verdict-issued` event whose prereq verdict was never recorded'
      : ` — ${counts.successWithoutPassMomentButReachedVerdict} of which reached a ` +
        '`verdict-issued` event whose prereq verdict was never recorded, because their ' +
        `request type(s) ${counts.typesWithoutVerdictPrerequisite.map((type) => `\`${type}\``).join(', ')} ` +
        'have NO `qa:verdict-issued` prerequisite row: the transition had no check to verify ' +
        'it against, so the check had nothing to record. The pass was never gated, rather than ' +
        'gated-and-unrecorded';
  const rework =
    ` — less ${counts.passMomentWithoutStatusSuccess} slice(s) that did pass but were sent ` +
    'back for rework afterwards, so their final state is not a terminal-happy one.';
  return `${base}${cause}${rework}`;
}

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
 * very thing the reader needs to see: nine slices reached a `verdict-issued`
 * event whose prereq verdict was never recorded, and eight slices that DID
 * pass were sent back for rework afterwards.
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
import { passMomentOf, collectAttempts } from './near-miss-attempts.js';
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
   * verdict was never recorded — the pass happened, but the check that
   * should have run left no trace.
   */
  readonly successWithoutPassMomentButReachedVerdict: number;
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
  rollups: readonly SliceRollup[]
): {
  readonly successWithoutPassMoment: number;
  readonly successWithoutPassMomentButReachedVerdict: number;
  readonly passMomentWithoutStatusSuccess: number;
} {
  let successWithoutPassMoment = 0;
  let successWithoutPassMomentButReachedVerdict = 0;
  let passMomentWithoutStatusSuccess = 0;
  for (const rollup of rollups) {
    const sliceEvents = events.filter(
      (event) => event.category === 'slice-transition' && event.sliceRid === rollup.sliceRid
    );
    const attempts = collectAttempts(sliceEvents);
    const hasPassMoment = passMomentOf(attempts) !== null;
    if (rollup.success && !hasPassMoment) {
      successWithoutPassMoment += 1;
      const reachedVerdict = sliceEvents.some(
        (event) => (event.detail as { to?: unknown }).to === 'verdict-issued'
      );
      if (reachedVerdict) successWithoutPassMomentButReachedVerdict += 1;
    }
    if (!rollup.success && hasPassMoment) passMomentWithoutStatusSuccess += 1;
  }
  return {
    successWithoutPassMoment,
    successWithoutPassMomentButReachedVerdict,
    passMomentWithoutStatusSuccess
  };
}

/**
 * The denominator, and its reconciliation with the status summary.
 *
 * The status side comes from the aggregation's own rollup, so the number this
 * reconciles with is the number the status summary reports.
 */
export function describeDenominator(
  events: readonly ObservabilityEvent[],
  sliceCount: number
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
  const counts = countDifferences(events, rollups);
  return {
    definition: PASSED_DEFINITION,
    sliceCount,
    statusSuccessCount,
    difference: {
      ...counts,
      note:
        `The status summary counts ${statusSuccessCount} slices successful (final state is a ` +
        `terminal-happy state); this metric counts ${sliceCount} passed (a successful ` +
        `\`verdict-issued\` attempt). The gap is ${counts.successWithoutPassMoment} slice(s) the ` +
        `status counts successful with no successful verdict attempt — ${counts.successWithoutPassMomentButReachedVerdict} ` +
        `of which reached a \`verdict-issued\` event whose prereq verdict was never recorded — ` +
        `less ${counts.passMomentWithoutStatusSuccess} slice(s) that did pass but were sent back for ` +
        'rework afterwards, so their final state is not a terminal-happy one.'
    }
  };
}

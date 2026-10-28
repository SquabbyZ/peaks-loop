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
 * WHY THE GAP'S COMPOSITION LIVES NEXT DOOR. Counting what the gap is made
 * of, and naming the cause of each part, is a different question from the one
 * this module answers — and the answer is long enough to need its own file.
 * `near-miss-difference.ts` holds that part.
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

import { aggregateSlices } from './aggregation.js';
import {
  countDifferences,
  differenceNote,
  type NearMissDifferenceCounts
} from './near-miss-difference.js';
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
  /**
   * The slices that are in NEITHER the numerator nor the denominator
   * because their pass verdict could not be read.
   *
   * They are reported so the denominator's composition is visible: a reader
   * who adds up the slices and finds some missing must be able to see WHERE
   * they went rather than infer it.
   */
  readonly unmeasuredSliceCount: number;
  /** The reconciliation, or null when the two counts agree. */
  readonly difference: NearMissDenominatorDifference | null;
};

/** What the gap between the two "passed" definitions is made of. */
export type NearMissDenominatorDifference = NearMissDifferenceCounts & {
  /** The reconciliation, spelled out. */
  readonly note: string;
};

/** The definition, stated once, so the output and the source agree. */
export const PASSED_DEFINITION =
  'a slice that recorded a SUCCESSFUL `verdict-issued` attempt — a `verdict-issued` ' +
  'transition attempt whose prereq check passed, which is the moment the slice was ' +
  'declared passing. A `verdict-issued` attempt whose check FAILED is a refused ' +
  'transition, not a pass. A slice whose `verdict-issued` attempt records a prereq ' +
  'verdict this build CANNOT READ is in NEITHER: whether it passed is unknown, so it ' +
  'is reported as unmeasured rather than counted here.';

/**
 * The denominator, and its reconciliation with the status summary.
 *
 * The status side comes from the aggregation's own rollup, so the number this
 * reconciles with is the number the status summary reports.
 */
export function describeDenominator(
  events: readonly ObservabilityEvent[],
  sliceCount: number,
  requestTypes: ReadonlyMap<string, RequestTypeReading> = new Map(),
  unmeasuredSliceCount = 0
): NearMissDenominator {
  const rollups = aggregateSlices(events);
  const statusSuccessCount = rollups.filter((rollup) => rollup.success).length;
  if (statusSuccessCount === sliceCount) {
    return {
      definition: PASSED_DEFINITION,
      sliceCount,
      statusSuccessCount,
      unmeasuredSliceCount,
      difference: null
    };
  }
  const counts = countDifferences(events, rollups, requestTypes);
  return {
    definition: PASSED_DEFINITION,
    sliceCount,
    statusSuccessCount,
    unmeasuredSliceCount,
    difference: {
      ...counts,
      note: differenceNote(statusSuccessCount, sliceCount, counts)
    }
  };
}

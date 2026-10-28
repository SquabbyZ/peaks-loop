/**
 * `src/services/observability/near-miss-difference.ts`
 *
 * WHAT THE GAP between the two "passed" definitions is made of.
 *
 * WHY THIS IS ITS OWN MODULE. The reconciliation is a COUNTING question —
 * each side of the gap is counted so a reader can check the arithmetic — and
 * it is a different question from the one the denominator answers. Keeping
 * them apart is what lets the denominator stay the short statement of "what
 * this count means" and lets this module be the long statement of "why the
 * two counts differ".
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
 * WHY AN UNREADABLE VERDICT IS COUNTED APART. A `verdict-issued` attempt
 * whose prereq verdict was RECORDED in a shape this build cannot read is a
 * different cause from one that was never recorded: the second was never
 * gated, the first was gated and its verdict is unreadable. Folding them
 * together would attribute an unreadable verdict to a missing prerequisite
 * row, which is a cause the record does not support.
 */

import {
  collectAttempts,
  passMomentOf,
  unreadableVerdictOf,
  VERDICT_STATE
} from './near-miss-attempts.js';
import { getPrerequisitesFor, type RequestType } from '../artifacts/artifact-prerequisites.js';
import type { SliceRollup } from './aggregation.js';
import type { RequestTypeReading } from './hotspot-shared.js';
import type { ObservabilityEvent } from './observability-service.js';
import { sliceIdentity } from '../../shared/incrementing-number.js';

/** The counts that make the gap up, and the note that spells them out. */
export type NearMissDifferenceCounts = {
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
   * Of those, the ones whose `verdict-issued` attempt recorded a prereq
   * verdict that could not be READ.
   */
  readonly successWithoutPassMomentButUnreadableVerdict: number;
  /**
   * The request types whose slices recorded no successful verdict attempt.
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
};

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
 * The counts that make the gap between the two "passed" definitions up.
 *
 * Each side of the gap is counted, so a reader can check the arithmetic: the
 * status count, minus the slices it counts that have no pass moment, plus the
 * slices that have a pass moment it does not count, is the near-miss
 * denominator.
 */
export function countDifferences(
  events: readonly ObservabilityEvent[],
  rollups: readonly SliceRollup[],
  requestTypes: ReadonlyMap<string, RequestTypeReading>
): NearMissDifferenceCounts {
  let successWithoutPassMoment = 0;
  let successWithoutPassMomentButReachedVerdict = 0;
  let successWithoutPassMomentButUnreadableVerdict = 0;
  let passMomentWithoutStatusSuccess = 0;
  const types = new Set<RequestType>();
  const slices: string[] = [];
  for (const rollup of rollups) {
    const sliceEvents = events.filter(
      (event) =>
        event.category === 'slice-transition' &&
        event.sliceRid !== undefined &&
        sliceIdentity(event.sliceRid).logical === rollup.sliceRid
    );
    const attempts = collectAttempts(sliceEvents);
    const hasPassMoment = passMomentOf(attempts) !== null;
    if (rollup.success && !hasPassMoment) {
      successWithoutPassMoment += 1;
      const reachedVerdict = sliceEvents.some(
        (event) => (event.detail as { to?: unknown }).to === VERDICT_STATE
      );
      if (reachedVerdict) {
        // A verdict that was RECORDED but cannot be READ is a different
        // cause from one that was never recorded, so it is counted apart.
        if (unreadableVerdictOf(sliceEvents) !== null) {
          successWithoutPassMomentButUnreadableVerdict += 1;
        } else {
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
    }
    if (!rollup.success && hasPassMoment) passMomentWithoutStatusSuccess += 1;
  }
  return {
    successWithoutPassMoment,
    successWithoutPassMomentButReachedVerdict,
    successWithoutPassMomentButUnreadableVerdict,
    typesWithoutVerdictPrerequisite: [...types].sort(),
    slicesWithoutVerdictPrerequisite: slices.sort(),
    passMomentWithoutStatusSuccess
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
export function differenceNote(
  statusSuccessCount: number,
  sliceCount: number,
  counts: NearMissDifferenceCounts
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
  const unreadable =
    counts.successWithoutPassMomentButUnreadableVerdict === 0
      ? ''
      : ` — and ${counts.successWithoutPassMomentButUnreadableVerdict} of which recorded a ` +
        '`verdict-issued` attempt whose prereq verdict could not be READ, so they are reported ' +
        'as unmeasured rather than as never gated';
  const rework =
    ` — less ${counts.passMomentWithoutStatusSuccess} slice(s) that did pass but were sent ` +
    'back for rework afterwards, so their final state is not a terminal-happy one.';
  return `${base}${cause}${unreadable}${rework}`;
}

/**
 * What a permitted write prints, so a green run is still readable.
 */
import { SEED_FLAG, bullet } from './internal.mjs';

/**
 * The lines a PERMITTED write prints — including the two that make a descending
 * ratchet auditable: which ceilings went down, and which rows are new.
 *
 * Equal-equal prints one summary line and nothing else. A guard that only ever
 * spoke when it refused would leave a green run indistinguishable from a run that
 * never compared anything, and the whole defect this file exists for began as a
 * green nobody could read.
 */
export function describeMonotonicityNotes(decision, seedRun) {
  if (seedRun) {
    // Its own headline, and not the "moved" one: a seed has no previous number at
    // all, so its `added` rows are not a descent and must never read like one.
    return [
      `monotonicity: SEED RUN — ${SEED_FLAG} was passed and HEAD carries no readable ` +
        `baseline, so all ${decision.added.length} row(s) are ceilings this run invented ` +
        'from its own measurement. Review every number before the commit.'
    ];
  }
  const moved = decision.lowered.length + decision.added.length;
  const notes = [
    `monotonicity: ${moved === 0 ? 'every ceiling held' : `${moved} row(s) moved`}` +
      ' — nothing rose and nothing dropped; every ceiling may only go DOWN.'
  ];
  if (decision.lowered.length > 0) {
    notes.push(
      `  CLEARED — ${decision.lowered.length} ceiling(s) went DOWN:` +
        '\n' +
        bullet(decision.lowered.map((row) => `${row.key}: ${row.previous} → ${row.next}`))
    );
  }
  if (decision.added.length > 0) {
    notes.push(
      `  NEWLY SEEDED — ${decision.added.length} row(s) the previous artifact did not carry. They ` +
        'are written, and they are named here: an unremarked new row is the hole through which a ' +
        'raised ceiling escapes as "unrecognized".' +
        '\n' +
        bullet(decision.added.map((row) => `${row.key}: ${row.next}`))
    );
  }
  return notes;
}

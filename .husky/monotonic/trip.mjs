/**
 * The working-copy-vs-HEAD trip and the deferral it hands to the measurement.
 */
import { bullet, displayValue, isCeilingVector } from './internal.mjs';
import { unseedableKeys } from './keys.mjs';
import { compareCeilings } from './compare.mjs';

/**
 * The working-copy-vs-HEAD trip: the artifact on disk, judged against the anchor
 * rather than against itself. Returns `{ refusal, notes, deferredAdded }`.
 *
 *   - `refusal` is the text of the refusal when a number was LIFTED, a row was DROPPED
 *     or a value is not a ceiling — the three shapes of "somebody edited the baseline
 *     before asking the generator to bless it", each an attack no measurement can make
 *     honest. It is produced BEFORE the expensive legs run, so minutes of eslint,
 *     prettier and tsc are never spent deciding a verdict an edit already decided.
 *   - `deferredAdded` is the one difference that is NOT decided by the disk alone: a row
 *     the file carries and the anchor never had. It may be the previous run's own
 *     legitimate write (backlog §2.35), so it is handed to the caller and settled by
 *     `settleDeferredAdded` once this run has measured something to settle it against.
 *     When the disk differs from the anchor ONLY by such rows there is no refusal here;
 *     when it also lifts or drops anything, the refusal names the added rows too,
 *     because the run is stopping anyway.
 *   - `notes` is what a permitted write says out loud about the disk copy, so a green
 *     run is still readable: which rows the file on disk held LOWER than the anchor
 *     (a stricter request, allowed through, and replaced by this run's measurement
 *     because a ceiling is a measurement and not a wish).
 */
export function workingCopyTrip({ headRef, outRel, head, working }) {
  const trip = compareCeilings(head, working);
  const added = unseedableKeys(head, working);
  const attacks = [];
  if (trip.raised.length > 0) {
    attacks.push(
      '  LIFTED — the artifact on disk carries these rows HIGHER than the anchor:\n' +
        bullet(
          trip.raised.map((row) => `${row.key}: ${headRef} ${row.previous} → disk ${row.next}`)
        )
    );
  }
  if (trip.removed.length > 0) {
    attacks.push(
      '  DROPPED — the anchor carries these rows and the artifact on disk does not:\n' +
        bullet(
          trip.removed.map(
            (row) => `${row.key}: ${headRef} held ${row.previous} — disk has no such row`
          )
        )
    );
  }
  if (trip.invalid.length > 0) {
    attacks.push(
      '  INVALID — values that are not finite non-negative integers:\n' +
        bullet(trip.invalid.map((row) => `${row.key} (${row.side}): ${row.value} ${row.why}`))
    );
  }
  if (attacks.length > 0 && added.length > 0) {
    attacks.push(
      '  ADDED — rows the artifact on disk carries that the anchor never had (named with the ' +
        'rest; this run refuses above them, so nothing is deferred):\n' +
        bullet(added.map((row) => `${row.key} (${row.side}): ${row.problem}`))
    );
  }
  const refusal =
    attacks.length === 0
      ? null
      : `THE ARTIFACT ON DISK IS NOT THE ANCHOR. ${outRel} has been moved away from\n` +
        `  ${headRef}, and this generator refuses to judge its own measurement against an\n` +
        '  edited copy of the file it is about to write:\n\n' +
        `${attacks.join('\n\n')}\n\n` +
        `  Restore it instead of arguing with it: git checkout HEAD -- ${outRel}\n` +
        '  A ceiling descends by itself when the measurement does.';
  const notes =
    trip.lowered.length === 0
      ? []
      : [
          `anchor: the artifact on disk held ${trip.lowered.length} row(s) LOWER than ` +
            `${headRef} — a stricter request, not an attack, so this run measures and the\n` +
            '  measurement decides the number that is written:\n' +
            bullet(
              trip.lowered.map((row) => `${row.key}: disk ${row.previous} → ${headRef} ${row.next}`)
            )
        ];
  return { refusal, notes, deferredAdded: attacks.length === 0 ? added : [] };
}

/**
 * The second half of the deferral: an `ADDED` disk row judged against what this run
 * actually measured (backlog §2.35). Returns
 * `{ refusal, notes, handTypedKeys }`.
 *
 * Three verdicts, and the remedy text matches each one:
 *
 *   - measured at the SAME value → permitted, and reported as seeded. The row is already
 *     in `compareCeilings`'s `added` bucket against the anchor, so the existing
 *     `NEWLY SEEDED` note names it; what this function adds is the sentence that the
 *     disk was not the source of the number. A permitted path prints no restore advice:
 *     the disk is right, and `git checkout HEAD -- <artifact>` would delete real debt.
 *   - NOT measured at all → refused. The disk carries a row nobody measures, which is a
 *     row somebody typed, and restoring the anchor IS the right remedy for that.
 *   - measured at a DIFFERENT value → refused, naming both numbers and saying that the
 *     measurement decides. No restore advice: the row itself is real, only its number
 *     is wrong, and telling the operator to delete the file is how a refusal teaches
 *     people to throw ceilings away.
 *
 * `handTypedKeys` names the rows this function refuses so the caller can keep the
 * canonical-key audit from printing the same row a second time.
 */
export function settleDeferredAdded({ headRef, outRel, deferred, measured }) {
  if (!isCeilingVector(measured)) {
    throw new TypeError('settleDeferredAdded: the measured ceilings must be an object');
  }
  const rows = Array.isArray(deferred) ? deferred : [];
  const seeded = [];
  const handTyped = [];
  const disagreed = [];
  for (const row of rows) {
    if (!Object.hasOwn(measured, row.key)) {
      handTyped.push(row);
      continue;
    }
    const value = measured[row.key];
    if (value === row.disk) seeded.push({ key: row.key, value });
    else disagreed.push({ key: row.key, disk: row.disk, measured: value });
  }
  const blocks = [];
  if (handTyped.length > 0) {
    blocks.push(
      '  NOT MEASURED — the artifact on disk carries these rows under a key the anchor never ' +
        'had, and this run measures no such row, so nobody has earned the number:\n' +
        bullet(handTyped.map((row) => `${row.key} (the working copy): ${displayValue(row.disk)}`)) +
        '\n\n' +
        '  That is a hand-typed row, and it is the one shape here the anchor can be restored ' +
        'from:\n' +
        `  git checkout HEAD -- ${outRel}`
    );
  }
  if (disagreed.length > 0) {
    blocks.push(
      '  NOT THE MEASURED NUMBER — the artifact on disk carries these rows under a key the ' +
        'anchor never had, and this run measures the same key at a different value:\n' +
        bullet(
          disagreed.map(
            (row) =>
              `${row.key}: disk ${displayValue(row.disk)} → measured by this run ` +
              displayValue(row.measured)
          )
        ) +
        '\n\n' +
        `  The row is real and ${headRef} does not carry it yet, so the disagreement is about a\n` +
        '  number, not about whether the debt exists: the measurement decides it, and a ceiling\n' +
        '  taken from the disk instead of from this run is not a ceiling. Re-run the generator\n' +
        '  and let it write what it measures.'
    );
  }
  const refusal =
    blocks.length === 0
      ? null
      : `THE ARTIFACT ON DISK ADDED ROWS THIS RUN CANNOT CONFIRM. ${outRel} carries ` +
        `${rows.length} row(s)\n` +
        `  that ${headRef} never had; settling them against this run's measurement:\n\n` +
        `${blocks.join('\n\n')}\n\n` +
        '  Nothing has been deferred past this point: a row enters the ratchet only from a\n' +
        '  number this run measured.';
  const notes =
    seeded.length === 0
      ? []
      : [
          `anchor: the artifact on disk carries ${seeded.length} row(s) ${headRef} never had, ` +
            'and this run measures the same number, so they enter the ratchet as seeded rows:\n' +
            "  the number is this run's measurement, not the file's claim, and they are named\n" +
            '  below as NEWLY SEEDED:\n' +
            bullet(seeded.map((row) => `${row.key}: ${displayValue(row.value)}`))
        ];
  return { refusal, notes, handTypedKeys: handTyped.map((row) => row.key) };
}

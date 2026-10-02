/**
 * `.husky/baseline/decide.mjs` — the monotonicity decision: settle the deferred
 * `ADDED` rows against this run's measurements, audit the canonical key set on
 * all three vectors, compare HEAD's anchor with the fresh numbers, and refuse in
 * ONE message if anything is wrong (rid `2026-10-02-wave9-generator-split`, HEAD
 * lines 664–733 wrapped as `decideWrite({ … })`).
 *
 * The anchor record arrives as `guardAnchor()` returned it, and `anchorNotes` is
 * still the same array: HEAD pushes the settle notes into it and prints the
 * result, both before the write, in that order.
 */
import {
  canonicalKeyProblems,
  compareCeilings,
  describeCanonicalKeyFailure,
  describeMonotonicityFailure,
  describeMonotonicityNotes,
  settleDeferredAdded
} from '../peaks-gate-baseline-monotonic.mjs';

import { HEAD_REF, OUT_REL, refuse } from './paths.mjs';

/** Decide whether this run may write, and say out loud what it decided. */
export function decideWrite({
  anchorCeilings,
  anchorKnown,
  workingCopy,
  anchorNotes,
  deferredAdded,
  ceilings
}) {
  // ---- monotonicity: the anchor was read above; decide, then write ------------
  // RID 2026-10-02-BASELINE-MONOTONICITY (§2.27), repaired by rid
  // 2026-10-02-monotonicity-head-anchor (§2.33). THE DEFECT IS THE SHAPE OF THIS
  // BLOCK: until the first slice existed, the `note` string written below promised
  // that a ceiling may only go DOWN and nothing compared a single key; until the
  // second one, the number it compared against came from the file it was about to
  // overwrite. Measured 2026-10-01: the generator raised `prettierUnformatted` 0 → 7
  // and exited 0, and the only thing that caught it was an operator diffing the
  // artifact by hand. A ratchet whose upper bound is decided by whoever last ran the
  // tool — or last EDITED the tool's input — is not a ratchet.
  //
  // So the write below is refused if any pre-existing ceiling rose against HEAD, if any
  // row vanished, if any of the three vectors disagrees with the canonical key set, or
  // if the working copy had already been moved away from HEAD by the time this run
  // started (refused up in THE ANCHOR block, before a minute of measurement).
  const seedApplied = !anchorKnown;
  const previousCeilings = anchorCeilings ?? {};

  // THE DEFERRED `ADDED` ROWS, SETTLED NOW THAT THE NUMBERS EXIST (§2.35). A row the
  // artifact on disk carries and HEAD never had was allowed past the early trip because
  // only this run's measurement can tell a previous run's legitimate write from a typed
  // number. Same value → seeded, and said out loud; no value at all → hand-typed; a
  // different value → the measurement decides, and the disk does not.
  const settled = settleDeferredAdded({
    headRef: HEAD_REF,
    outRel: OUT_REL,
    deferred: deferredAdded,
    measured: ceilings
  });
  anchorNotes.push(...settled.notes);

  // THE CANONICAL KEY SET, AUDITED ON EVERY VECTOR — RA4's `13 rows, two places`.
  // HEAD and the working copy may each be missing a canonical row, because that is how
  // a new ceiling gets seeded once the key is in the generator AND on the list (and the
  // working copy missing one HEAD carries is the trip's business, refused up in THE
  // ANCHOR block). The measurement may not: a canonical row this run stopped measuring
  // is a hole in the ratchet whatever the artifact says. `skipKeys` keeps the disk audit
  // from naming a row twice — once here as "not canonical", once above as "not measured"
  // — because the two overlapping verdicts send an operator to fix one row twice.
  const keyProblems = [
    ...canonicalKeyProblems('measured by this run', ceilings),
    ...(anchorKnown ? canonicalKeyProblems(HEAD_REF, anchorCeilings, { allowMissing: true }) : []),
    ...(workingCopy.state === 'ceilings'
      ? canonicalKeyProblems('the artifact on disk', workingCopy.ceilings, {
          allowMissing: true,
          skipKeys: settled.handTypedKeys
        })
      : [])
  ];

  const monotonicity = compareCeilings(previousCeilings, ceilings);
  // Every reason this run may not write is named in ONE refusal. They are collected
  // rather than returned one at a time because they overlap — a row nobody sanctioned
  // is both off the canonical list and a row this run no longer measures — and an
  // operator shown only the first of the two fixes the wrong thing.
  const refusals = [];
  if (settled.refusal !== null) refusals.push(settled.refusal);
  const keyFailure = describeCanonicalKeyFailure(keyProblems);
  if (keyFailure !== null) refusals.push(keyFailure);
  const monotonicityFailure = describeMonotonicityFailure(monotonicity);
  if (monotonicityFailure !== null) refusals.push(monotonicityFailure);
  if (refusals.length > 0) {
    refuse(
      `${refusals.join('\n\n')}\n\n  The anchor is ${HEAD_REF}. Nothing above it was rewritten by this run.`
    );
  }
  // The permitted write is the arm a guard most often forgets: a run that says
  // nothing when it agrees looks identical to a run that never compared anything.
  for (const note of anchorNotes) console.error(note);
  for (const note of describeMonotonicityNotes(monotonicity, seedApplied)) console.error(note);
}

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

import {
  RESCOPE_FLAG,
  rescopeUnneededTrip,
  scopeDifference,
  scopeTrip,
  shadowMoveLines
} from './rescope.mjs';

import { describeLegScopeMove, legOfCeilingKey, raiseIsBoundary, scopeGrowthLine } from './leg-scope.mjs';

import { HEAD_REF, OUT_REL, refuse } from './paths.mjs';

/** Decide whether this run may write, and say out loud what it decided. */
export function decideWrite({
  anchorCeilings,
  anchorKnown,
  workingCopy,
  anchorNotes,
  deferredAdded,
  ceilings,
  headScope = null,
  headFileCount = null,
  headShadow = null,
  headFiles = null,
  shadow = null,
  rescope = null
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
  // H1 — THE RESCOPE GUARD (rid `2026-10-03-w10-rescope-a`, backlog §2.42; extended
  // by rid `2026-10-03-silent-warning-scope`, §2.43; directionalised by rid
  // `2026-10-03-scope-growth-vs-shrink`, §2.50).
  // Values may only go down; the POPULATION that produced them may not change in
  // silence. §2.50 says which changes must be STATED: the boundary text (rule, dirs,
  // extensions) moving, or files LEAVING the enforced enumeration — a set difference
  // of HEAD's `files` rows and this run's gated list, both threaded in below. Pure
  // GROWTH proceeds without the flag and prints `scope grew: …`; the monotonicity
  // rule that follows is what still guards a rise, so the ratchet does not care that
  // the ceremony does. A scope difference without the flag refuses, naming everything
  // it would hide; WITH the flag the write goes through, loud, and the out-of-scope
  // totals land in the artifact's shadow block. The flag with nothing to rescope —
  // including over growth — is itself a refusal: required, not cosmetic.
  const scopeDiff =
    rescope === null
      ? null
      : scopeDifference({
          headScope,
          newScope: rescope.newScope,
          headFileCount,
          gatedCount: rescope.gatedCount,
          headFiles,
          runFiles: rescope.runFiles ?? null
        });
  let rescopeApplied = null;
  if (rescope !== null) {
    const boundary = {
      headScope,
      newScope: rescope.newScope,
      headFileCount,
      gatedCount: rescope.gatedCount,
      headFiles,
      runFiles: rescope.runFiles ?? null
    };
    if (rescope.flag) {
      const unneeded = rescopeUnneededTrip(boundary);
      if (unneeded !== null) refusals.push(unneeded);
      else if (headScope !== null) {
        rescopeApplied =
          `RESCOPE applied (${RESCOPE_FLAG}): the boundary moved — scope.dirs go from ` +
          `${JSON.stringify(headScope.dirs)} to ${JSON.stringify(rescope.newScope.dirs)} ` +
          `(${headFileCount} -> ${rescope.gatedCount} measured files` +
          (scopeDiff.left.length > 0 ? `, ${String(scopeDiff.left.length)} left the scope` : '') +
          ')' +
          (scopeDiff.moves.length > 0
            ? `; ${scopeDiff.moves.map((move) => describeLegScopeMove(move)).join('; ')}`
            : '') +
          '. What moved is the population, NOT the debt: the rows that fell are not ' +
          'reductions and the rows that rose are not regressions — the files were always ' +
          'there. The out-of-scope totals are carried forward as shadow rows (reported, ' +
          'never gated), and only the rows of a population that moved may change.';
      }
    } else {
      const trip = scopeTrip({
        ...boundary,
        newScope: rescope.newScope,
        gatedCount: rescope.gatedCount,
        headCeilings: previousCeilings,
        ceilings
      });
      if (trip !== null) refusals.push(trip);
    }
    // §2.50: growth is legal, but it must not be QUIET. Printed even when this run
    // refuses for another reason — the operator of a growth-plus-raise needs to see
    // the crowd move next to the RAISED line that stopped it.
    if (scopeDiff !== null && scopeDiff.grew) {
      console.error(
        scopeGrowthLine({
          headFileCount,
          gatedCount: rescope.gatedCount,
          entered: scopeDiff.entered,
          left: scopeDiff.left
        })
      );
    }
  }
  // A RAISE THE BOUNDARY EXPLAINS (§2.43) — the half of the rescope the narrowing
  // never needed, because narrowing only ever lowered numbers. `--rescope` is NOT a
  // licence to raise a ceiling: it is the statement that a population moved, and a
  // row may change with it only when the population that produced THAT ROW moved —
  // its own leg record, or the gate-wide scope for a row no leg owns. Every other
  // raise is refused with both of its numbers, exactly as it was before this slice,
  // and the permitted ones are printed in the note below rather than hidden in a
  // green. `settleDeferredAdded` and the canonical-key audit are untouched: a row
  // this run does not measure is still a hole in the ratchet however the boundary moved.
  const boundaryLifted = [];
  const unexplainedRaises = [];
  for (const row of monotonicity.raised) {
    const explained =
      rescopeApplied !== null &&
      scopeDiff !== null &&
      raiseIsBoundary({
        key: row.key,
        moves: scopeDiff.moves,
        gatePopulationMoved: scopeDiff.gatePopulationMoved
      });
    if (explained) boundaryLifted.push(row);
    else unexplainedRaises.push(row);
  }
  const decision =
    boundaryLifted.length === 0
      ? monotonicity
      : {
          ...monotonicity,
          raised: unexplainedRaises,
          ok:
            unexplainedRaises.length === 0 &&
            monotonicity.removed.length === 0 &&
            monotonicity.invalid.length === 0
        };
  const monotonicityFailure = describeMonotonicityFailure(decision);
  if (monotonicityFailure !== null) refusals.push(monotonicityFailure);
  if (rescopeApplied !== null && boundaryLifted.length > 0) {
    rescopeApplied +=
      `\n  ${boundaryLifted.length} ceiling row(s) ROSE and this write carries them, attributed one by one:` +
      boundaryLifted
        .map((row) => {
          const leg = legOfCeilingKey(row.key);
          const move = leg === null ? null : scopeDiff.moves.find((m) => m.leg === leg);
          return (
            `\n    - ${row.key}: ${row.previous} -> ${row.next} because ` +
            (move !== null ? describeLegScopeMove(move) : 'the gate-wide scope moved') +
            ' — zero new debt; this is the same debt measured over more files.'
          );
        })
        .join('');
  }
  // W1 — THE SHADOW-MOVE CHECK (rid `2026-10-03-shadow-move-rider`, backlog §2.46).
  // Printed BEFORE the refusal below and OUTSIDE it, because it is a report about the
  // population the ceilings do not gate: it may neither add a key to the artifact nor
  // change this run's exit code, and a run that is already refusing is exactly the run
  // whose operator wants to know the exempt side moved too. Arms:
  // `tests/unit/lint/shadow-move-warning.test.ts`.
  const shadowMoveInput = { headShadow, shadow, rescopeApplied: rescopeApplied !== null };
  for (const line of shadowMoveLines(shadowMoveInput)) console.error(line);
  if (refusals.length > 0) {
    refuse(
      `${refusals.join('\n\n')}\n\n  The anchor is ${HEAD_REF}. Nothing above it was rewritten by this run.`
    );
  }
  // The permitted write is the arm a guard most often forgets: a run that says
  // nothing when it agrees looks identical to a run that never compared anything.
  if (rescopeApplied !== null) anchorNotes.push(rescopeApplied);
  for (const note of anchorNotes) console.error(note);
  for (const note of describeMonotonicityNotes(decision, seedApplied)) console.error(note);
}

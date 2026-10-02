#!/usr/bin/env node
/**
 * The ratchet's monotonicity rule, as a pure function.
 *
 * WHY THIS FILE EXISTS (backlog §2.27, rid `2026-10-02-baseline-monotonicity`).
 * `.husky/peaks-gate-baseline.mjs` writes a `note` into its own artifact that
 * says *"Every ceiling may only go DOWN — if a regeneration raises one, that is a
 * regression to fix, not a number to commit."* Until 2026-10-02 nothing in that
 * file implemented the sentence: it never read `OUT_PATH` back, so it held no
 * previous number to compare against. Measured on 2026-10-01, after C wave 7
 * staged 29 files of which seven were not prettier-formatted, the generator
 * raised `prettierUnformatted` 0 → 7, printed `wrote
 * .peaks/lint/gate-baseline.json` and exited **0**. Only a human diffing the
 * artifact key by key could see it, and the ratchet is precisely the thing a
 * human is not in the loop to check every time.
 *
 * WHY THE COMPARISON IS PURE AND NOT INLINE.
 *   1. The generator costs minutes — eslint over ~1,300 type-aware files, then
 *      prettier, then `tsc`, then the census. A decision table with seven rows
 *      cannot be tested at that price, and an untested guard on a ratchet is a
 *      rumour: this very sentence sat unenforced for six weeks while the code
 *      that printed it was green.
 *   2. Every row of that table is a *shape* (a key absent, a key vanished, a
 *      value that is not an integer) that the real measurement path produces only
 *      by accident, and an accident is not an arm. A pure function takes the two
 *      vectors as arguments, so each shape is handed over directly and the arm
 *      states which row it answers.
 * The subprocess half is not skipped, only bounded:
 * `tests/unit/lint/baseline-monotonicity-generator.test.ts` runs the real
 * generator against an isolated fixture repository, because only that can prove
 * the refusal happens BEFORE the write and that the artifact bytes are untouched
 * afterwards.
 *
 * WHAT "MONOTONIC" MEANS HERE, EXACTLY
 *   - equal or lower on every key the previous artifact carried → write.
 *   - any key HIGHER than the previous artifact's → refuse. The ceiling is a
 *     permission, and this run is asking for more of it.
 *   - a key the previous artifact did NOT carry → write, but say so out loud. That
 *     row is the one that can be abused: "unrecognized key" and "brand-new row"
 *     look identical in an artifact, and `fileSizeExcessLines` was legitimately
 *     seeded this way on 2026-10-01. Silence is what makes the two indistinguishable.
 *   - a key the previous artifact carried and this run does not measure → refuse.
 *     Dropping a ceiling is the loudest possible weakening: it does not raise a
 *     number, it deletes the row that had one.
 *   - no previous artifact, or one that cannot be read or parsed → refuse unless
 *     the caller passes `--seed`. A corrupt ratchet must not become the excuse for
 *     a clean slate; whoever means the clean slate says so on the command line.
 *   - a ceiling that is not a finite non-negative integer → refuse on both sides.
 *     A string "2" and a `NaN` are not numbers the descent can be measured against,
 *     and comparing them would silently produce a verdict nobody earned.
 *
 * WHERE "PREVIOUS" MEANS SINCE REPAIR CYCLE 1 (rid 2026-10-02-monotonicity-head-anchor).
 *   C wave 8 read the previous ceilings out of `OUT_PATH` — the working-tree
 *   artifact, which is the same file the run is about to overwrite and the same file
 *   a weakening edits. An out-of-band review measured three ways past it: delete a
 *   row and the run prints `NEWLY SEEDED` and writes it; inflate a row and the run
 *   prints `CLEARED` and writes the descent; set `"ceilings": {}` and all thirteen
 *   rows re-seed, because an empty object parses. The push leg made it worse, not
 *   better: the remedy its own refusal prints is `Regenerate it: node
 *   .husky/peaks-gate-baseline.mjs`, so an operator following the gate's instruction
 *   performs attack one. So "previous" is now `git show HEAD:` of this file, which
 *   an edit of the working tree cannot move, and the working tree is a SECOND,
 *   INDEPENDENT trip rather than the source of the numbers.
 *
 * THE ORDER THE DECISIONS RUN IN — decided here, because the arms and the code have
 * to agree about which refusal an input gets:
 *   1. Read HEAD's artifact. Unreadable, unparseable, or a `ceilings` block with not
 *      one canonical row in it → there is no baseline. Refuse and tell the operator
 *      about `--seed`; only `--seed` turns that into the documented seed path where
 *      every canonical row is reported as newly seeded. This is also the arm for a
 *      repository with no git at all: the refusal names the git error, it does not
 *      throw it.
 *   2. Compare the artifact on disk with HEAD's BEFORE measuring anything, and refuse
 *      if it LIFTS a number, DROPS a row or carries a value that is not a ceiling.
 *      Those edits are the attack whatever this run goes on to measure, and a generator
 *      that judges its own measurement against them has already lost. `--seed` does not
 *      unlock this refusal: the flag is the statement that a baseline is MISSING, never
 *      permission to write over an edited one. A working copy that is only LOWER than
 *      HEAD is a stricter request, not an attack: it is allowed through, named in the
 *      notes, and the measurement decides the number that is finally written.
 *   2b. A row the disk ADDS and HEAD never carried is the one difference whose verdict
 *      depends on the measurement, so it is DEFERRED rather than refused (backlog
 *      §2.35): refusing it outright made a slice that introduces a ceiling row unable to
 *      regenerate twice before its commit, and the remedy the refusal printed —
 *      `git checkout HEAD -- <artifact>` — would have deleted the row the previous run
 *      legitimately measured. `settleDeferredAdded` decides it once the number exists:
 *      measured at the same value → seeded, and said out loud; not measured at all → a
 *      hand-typed row, refused, and only there does the restore advice belong; measured
 *      at a different value → refused naming both, because the measurement decides.
 *   3. Audit the anchor, the artifact on disk and this run's measurement against
 *      `CEILING_KEYS` by set equality. HEAD may be missing a canonical row — that is
 *      how a new ceiling gets seeded — but only when the artifact on disk is missing
 *      it too, and never in a `--seed` run, where there is no anchor to be missing
 *      from. A disk row §2b has already refused as hand-typed is named ONCE, by §2b:
 *      the reasons are collected so an operator is not shown only the first of two,
 *      which is not a licence to show the same row twice under two headings.
 *   4. Compare HEAD's ceilings with the measurement: equal or lower on every row
 *      writes, any raise refuses, any canonical row this run stopped measuring
 *      refuses.
 *   5. Write, and print which rows moved.
 */

/** The flag that opts a run in to writing a baseline where there was none. */
export const SEED_FLAG = '--seed';

/**
 * THE CANONICAL CEILING KEY LIST — the thirteen rows the ratchet is allowed to
 * carry, each named exactly once.
 *
 * WHY ONE LIST AND NOT TWO. `.husky/peaks-gate-baseline.mjs` assembles the
 * `ceilings` object it writes, and until this slice nothing anywhere constrained
 * which keys that object could hold: `grep -rn "eslintNotLintedFiles|
 * prettierUnparsableFiles" tests/ scripts/ src/` came back with hits in prose only,
 * so a fourteenth row, a renamed row or a deleted row was accepted by construction
 * — and "accepted" is exactly what a ratchet calls a weakening it cannot see. This
 * list is the sanctioned set; the comparison between this list and any vector is
 * SET EQUALITY (`canonicalKeyProblems`), never a count of `>= 13`, because a count
 * lets a junk row and a missing row cancel each other out.
 *
 * `tests/unit/lint/baseline-monotonicity.test.ts` arm C1 pins this list against the
 * published artifact AND against `git show HEAD:…`, and
 * `tests/unit/lint/baseline-monotonicity-head-anchor.test.ts` arm H-RA4 pins it
 * against what a real run writes, so adding a ceiling in one place and not the
 * other is a red test rather than a new number in the baseline.
 *
 * The order is the generator's own assembly order, so a diff of the two reads alike.
 */
export const CEILING_KEYS = Object.freeze([
  'eslintFindings',
  'eslintErrors',
  'eslintPhantomFindings',
  'eslintCoverageGapFiles',
  'eslintSyntaxErrorFiles',
  'eslintNotLintedFiles',
  'prettierUnformatted',
  'prettierUnparsableFiles',
  'tscErrors',
  'silentWarningCatchReturnNull',
  'silentWarningEmptyCatch',
  'fileSizeOverCap',
  'fileSizeExcessLines'
]);

/** How each side of the comparison is named in the text an operator reads. */
const SIDES = { previous: 'previous artifact', measured: 'measured by this run' };

/** `CEILING_KEYS` as membership, because the audit asks `has?` once per row read. */
const CEILING_KEY_SET = new Set(CEILING_KEYS);

const isCeilingVector = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** A ceiling rendered the way a human reads it back off an artifact. */
function displayValue(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === undefined) return 'undefined';
  return String(value);
}

/**
 * Why `value` is not a ceiling, or `null` when it is one.
 *
 * `Number.isInteger` is the whole trip: it answers false for `NaN`, for
 * `±Infinity` and for a fraction, and true for every legal ceiling including 0.
 * `0` is legal — a row at zero is what a fully cleared debt looks like, and it is
 * the number the `prettierUnformatted` ceiling sat at when 2026-10-01 raised it.
 */
export function ceilingProblem(value) {
  if (typeof value !== 'number') {
    return `is ${value === null ? 'null' : typeof value}, not a number`;
  }
  if (!Number.isInteger(value)) return `is not a finite integer (${displayValue(value)})`;
  if (value < 0) return `is negative (${displayValue(value)})`;
  return null;
}

/**
 * The decision table, as data.
 *
 * `previous` is the anchor — the `ceilings` block of HEAD's copy of the artifact, or
 * `{}` for a seed run, which is what makes every row come back as `added` and
 * therefore as *reported*. It is NOT the working-tree file: that file is the thing a
 * weakening edits, and since repair cycle 1 it is audited separately
 * (`workingCopyTrip`). `next` is what this run measured. Returns the six buckets the
 * caller renders; `ok` is `false` exactly when `raised`, `removed` or `invalid` has a
 * row in it.
 *
 * Throws on a vector that is not an object. That is deliberate: `null` reaching here
 * would be an unreadable anchor routed past the `--seed` trip, and a comparison that
 * treated it as "no previous ceilings" would re-baseline a corrupt ratchet with
 * nobody opting in.
 */
export function compareCeilings(previous, next) {
  if (!isCeilingVector(previous)) {
    throw new TypeError(
      'compareCeilings: the previous ceilings must be an object — an absent or unreadable ' +
        'artifact is the --seed row of the decision table, not an empty one'
    );
  }
  if (!isCeilingVector(next)) {
    throw new TypeError('compareCeilings: the measured ceilings must be an object');
  }

  const invalid = [];
  const keepValid = (side, source) => {
    const usable = {};
    for (const [key, value] of Object.entries(source)) {
      const why = ceilingProblem(value);
      if (why === null) usable[key] = value;
      else invalid.push({ key, side: SIDES[side], value: displayValue(value), why });
    }
    return usable;
  };
  const before = keepValid('previous', previous);
  const after = keepValid('measured', next);

  const raised = [];
  const lowered = [];
  const added = [];
  for (const [key, value] of Object.entries(after)) {
    if (!Object.hasOwn(before, key)) {
      added.push({ key, next: value });
      continue;
    }
    const ceiling = before[key];
    if (value > ceiling) raised.push({ key, previous: ceiling, next: value });
    else if (value < ceiling) lowered.push({ key, previous: ceiling, next: value });
  }
  const removed = Object.keys(before)
    .filter((key) => !Object.hasOwn(after, key))
    .map((key) => ({ key, previous: before[key] }));

  return {
    ok: raised.length === 0 && removed.length === 0 && invalid.length === 0,
    raised,
    lowered,
    added,
    removed,
    invalid
  };
}

/**
 * The previous artifact's `ceilings`, or the reason there is none.
 *
 * A file that is empty, unreadable, not JSON, or JSON without a `ceilings` object
 * all come back as `problem` with `ceilings: null` — never as `{}`. Callers must
 * treat `null` as "do not write" and only `--seed` as permission to write anyway.
 */
export function parsePreviousArtifact(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ceilings: null, problem: 'is empty or unreadable' };
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch (err) {
    const first = String(err.message).split('\n')[0];
    return { ceilings: null, problem: `is not parseable JSON (${first})` };
  }
  if (!isCeilingVector(document)) {
    return { ceilings: null, problem: `is ${displayValue(document)}, not a JSON object` };
  }
  if (!isCeilingVector(document.ceilings)) {
    return { ceilings: null, problem: 'has no ceilings object' };
  }
  return { ceilings: document.ceilings, problem: null };
}

/**
 * What `ceilings` gets wrong against `CEILING_KEYS`, as rows the caller renders.
 *
 * `side` names the vector the way an operator reads it (“HEAD artifact”, “the
 * artifact on disk”, “measured by this run”), because the two sides of this audit
 * have different remedies and a message that does not say which one is wrong sends
 * the operator to edit the wrong file.
 *
 * `allowMissing` is the anchor's exemption and nobody else's: HEAD's artifact is
 * allowed not to carry a canonical row yet, because that is how a new ceiling gets
 * seeded (row 4 — `fileSizeExcessLines` on 2026-10-01) once the key is on the list
 * and in the generator. The measurement and the artifact on disk get no such pass:
 * a canonical row either side does not carry is a row going missing from the
 * ratchet, which is the loudest weakening there is.
 *
 * `skipKeys` is NOT an exemption, it is a de-duplicator, and it is only ever passed
 * for the artifact on disk: a deferred row `settleDeferredAdded` has already refused
 * names that key with both sides' numbers and the remedy that fits it, and printing a
 * second verdict for the same row under a second heading is the "two overlapping
 * answers" shape this file's own comment refuses. Every other problem the same vector
 * carries still reports.
 */
export function canonicalKeyProblems(side, ceilings, options = {}) {
  if (!isCeilingVector(ceilings)) {
    throw new TypeError(`canonicalKeyProblems: the ${side} ceilings must be an object`);
  }
  const allowMissing = options.allowMissing === true;
  const skip = options.skipKeys instanceof Set ? options.skipKeys : new Set(options.skipKeys ?? []);
  const problems = [];
  const notCanonical =
    `is not one of the ${CEILING_KEYS.length} canonical ceiling keys, so no slice has ` +
    'sanctioned it — add it to CEILING_KEYS and to the generator in the same change, ' +
    'or remove it';
  for (const [key, value] of Object.entries(ceilings)) {
    if (skip.has(key)) continue;
    if (!CEILING_KEY_SET.has(key)) {
      problems.push({ key, side, problem: notCanonical });
      continue;
    }
    const why = ceilingProblem(value);
    if (why !== null) {
      problems.push({ key, side, problem: `ceiling ${displayValue(value)} ${why}` });
    }
  }
  if (!allowMissing) {
    for (const key of CEILING_KEYS) {
      if (!Object.hasOwn(ceilings, key)) {
        problems.push({
          key,
          side,
          problem:
            'is a canonical ceiling row this vector is missing — every row of the ' +
            'ratchet is measured or the ratchet has a hole in it'
        });
      }
    }
  }
  return problems;
}

/**
 * Rows on the canonical list that `ceilings` does not carry. Exported rather than
 * inlined because the generator needs the same list twice: once to tell an anchor
 * that is short (a row awaiting its first seeding) from an anchor that is empty
 * (an absence, which only `--seed` may write over), and once to refuse a
 * measurement that stopped reporting a sanctioned row.
 */
export function missingCanonicalKeys(ceilings) {
  if (!isCeilingVector(ceilings)) {
    throw new TypeError('missingCanonicalKeys: the ceilings must be an object');
  }
  return CEILING_KEYS.filter((key) => !Object.hasOwn(ceilings, key));
}

/**
 * Rows the working copy carries that HEAD does not — the ones whose verdict the
 * measurement decides. A brand-new ceiling is legitimate exactly once: when the key is
 * on the canonical list, this run measures it, HEAD has never carried it, and the file
 * on disk does not carry it either. What the disk copy says about such a row is not a
 * verdict, it is a claim: `settleDeferredAdded` is where this run's number decides
 * whether it was measured or typed (backlog §2.35).
 *
 * Each row carries the value the disk holds, so the caller can compare it with the one
 * this run measures without reading the artifact a second time.
 *
 * `workingCopy` is `null` when the artifact is absent, unreadable or unparseable —
 * nothing pre-seeded from a file that carries nothing.
 */
export function unseedableKeys(head, workingCopy) {
  if (!isCeilingVector(head)) {
    throw new TypeError('unseedableKeys: the HEAD ceilings must be an object');
  }
  if (workingCopy === null) return [];
  if (!isCeilingVector(workingCopy)) {
    throw new TypeError('unseedableKeys: the working-copy ceilings must be an object or null');
  }
  const rows = [];
  for (const [key, value] of Object.entries(workingCopy)) {
    if (Object.hasOwn(head, key)) continue;
    rows.push({
      key,
      side: 'the working copy',
      disk: value,
      problem:
        `the working copy carries ${displayValue(value)} under a key HEAD does not have, ` +
        'so this run has to measure it before the row means anything'
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// The text. Kept here so the rule and the sentence that explains it cannot
// drift apart, and so the generator's own block stays a call site.
// ---------------------------------------------------------------------------

const RULE = 'every ceiling may only go DOWN, and this run asks to move the ratchet up';

const bullet = (lines) => lines.map((line) => `    - ${line}`).join('\n');

/**
 * The body of the refusal, naming every weakening this run measured. `null` when
 * the decision is clean. The caller wraps it in the generator's existing
 * `REFUSING to write …` idiom, so the operator reads one shape for every reason
 * this generator may not write.
 */
export function describeMonotonicityFailure(decision) {
  if (decision.ok) return null;
  const blocks = [];
  if (decision.raised.length > 0) {
    blocks.push(
      `  RAISED — ${decision.raised.length} ceiling(s) above the number they are the ceiling OF. ` +
        'A raise is a regression to fix, not a number to commit:\n' +
        bullet(decision.raised.map((row) => `${row.key}: ${row.previous} → ${row.next}`))
    );
  }
  if (decision.removed.length > 0) {
    blocks.push(
      `  REMOVED — ${decision.removed.length} ceiling row(s) the previous artifact carried and ` +
        'this run does not measure. Dropping a row is the loudest possible weakening:\n' +
        bullet(decision.removed.map((row) => `${row.key}: it held ${row.previous}`))
    );
  }
  if (decision.invalid.length > 0) {
    blocks.push(
      `  INVALID — ${decision.invalid.length} value(s) that are not finite non-negative integers, ` +
        'so no descent can be measured against them:\n' +
        bullet(decision.invalid.map((row) => `${row.key} (${row.side}): ${row.value} ${row.why}`))
    );
  }
  return (
    `${RULE}.\n\n${blocks.join('\n\n')}\n\n` +
    '  Fix the regression and re-run `node .husky/peaks-gate-baseline.mjs`: a ceiling descends\n' +
    '  by itself when the measurement does. Editing a ceiling to clear this, or deleting its row,\n' +
    '  is the weakening this guard exists to refuse.'
  );
}

/**
 * The canonical-key refusal. `null` when the vector agrees with the list.
 *
 * WHY IT NAMES THE SIDE. The two sides of this audit have different remedies — a row
 * missing from the measurement means a leg stopped being measured, a row missing from
 * HEAD means a ceiling awaiting its first seeding, a row missing from the artifact on
 * disk means somebody deleted it — and a message that says only "unexpected key"
 * sends the operator to edit whichever file happened to be open.
 */
export function describeCanonicalKeyFailure(problems) {
  if (problems.length === 0) return null;
  return (
    `  NOT THE CANONICAL CEILING SET — ${problems.length} disagreement(s) with the ` +
    `${CEILING_KEYS.length} sanctioned rows:\n` +
    bullet(problems.map((row) => `${row.key} (${row.side}): ${row.problem}`)) +
    '\n\n' +
    '  `CEILING_KEYS` here and the `ceilings` object in .husky/peaks-gate-baseline.mjs are\n' +
    '  one list read two ways, compared by SET EQUALITY. A row in one and not the other is\n' +
    '  the `13 rows, two places` defect this refuses; land both halves in the same change.'
  );
}

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

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
 */

/** The flag that opts a run in to writing a baseline where there was none. */
export const SEED_FLAG = '--seed';

/** How each side of the comparison is named in the text an operator reads. */
const SIDES = { previous: 'previous artifact', measured: 'measured by this run' };

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
 * `previous` is the `ceilings` block of the artifact on disk — `{}` for a seed run,
 * which is what makes every row come back as `added` and therefore as *reported*.
 * `next` is what this run measured. Returns the six buckets the caller renders;
 * `ok` is `false` exactly when `raised`, `removed` or `invalid` has a row in it.
 *
 * Throws on a vector that is not an object. That is deliberate: `null` reaching
 * here would be an unreadable artifact routed past the `--seed` trip, and a
 * comparison that treated it as "no previous ceilings" would re-baseline a
 * corrupt ratchet with nobody opting in.
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
      `monotonicity: SEED RUN — there was no previous artifact to compare against and ${SEED_FLAG} ` +
        `was passed, so all ${decision.added.length} row(s) are ceilings this run invented from ` +
        'its own measurement. Review every number before the commit.'
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

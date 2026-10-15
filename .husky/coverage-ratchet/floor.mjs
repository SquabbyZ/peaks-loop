/**
 * `.husky/coverage-ratchet/floor.mjs` — the coverage FLOOR: the artifact's shape, and the
 * decisions taken from it. PURE: it reads no file and spawns nothing, so a unit test can
 * drive the whole decision table without paying for a coverage run.
 *
 * WHY THIS IS A SECOND MECHANISM, AND NOT A ROW IN `ceilings`. `.peaks/lint/gate-baseline.json`
 * holds CEILINGS, and the DIRECTION is inverted: `compareCeilings`
 * (`.husky/monotonic/compare.mjs:87`, `:100`, `:109`) puts `value > ceiling` into `raised`, and any
 * `raised` row makes `ok: false`. Ceilings may only FALL. A coverage floor may only RISE, and a rise
 * is the outcome this gate exists to encourage — the one change that machinery refuses. The two
 * cannot share a decision table, and re-signing one row would be a different tool wearing the same
 * name. Do not move this number into `ceilings`.
 *
 * THE SECOND REASON IS WEAKER AND IS QUALIFIED HERE ON PURPOSE. `ceilingProblem` also requires
 * `Number.isInteger`, so a FRACTIONAL percentage cannot live there — but `Number.isInteger(47.0)` is
 * `true`, and 47.0 is this artifact's own seed. So "a percentage cannot live there at all" is false
 * as written; the direction argument above is the decisive one and stands alone. Recorded because a
 * review caught the overreach in the first draft of this header.
 *
 * INCLUSIVE AT THE BOUNDARY, DELIBERATELY. `measured === floor` HOLDS. A ratchet set exactly at the
 * value it measured must be green on the tree it measured, or `--raise` would emit a red gate the
 * moment it wrote — the red-on-arrival failure this slice exists to avoid. The convention is a
 * choice, so it is stated here and pinned by its own test arm rather than left for a reader to infer.
 *
 * THE POPULATION IS PINNED BY SIZE AS WELL AS BY NAME. `population` says which paths may appear; the
 * `files` row says HOW MANY must. Without the second, a report holding a strict SUBSET of `src/**`
 * reads green at a high percentage, and the gate would go green while measuring almost nothing — the
 * failure class this repository has already paid for once (vitest 4 silently dropped `coverage.all`).
 *
 * THE FLOOR MAY ONLY MOVE BY `--raise`, WHICH WRITES `measured - FLOOR_MARGIN_PP`. Nothing else in
 * this repository writes this file, so the number is measured rather than typed — the discipline
 * `.husky/peaks-gate-baseline.mjs` states in its own header. The one exception is the SEED, which is
 * a hand-written bootstrap by construction; it says so in its own `note`.
 */

/** Where the floor lives, repo-relative. Tracked: the raise must be visible in `git log -p`. */
export const FLOOR_PATH = '.peaks/lint/coverage-floor.json';

/** The counter this ratchet reads. `lines` only — see the RD artifact for why the others are out. */
export const COUNTER = 'lines';

/**
 * The headroom `--raise` leaves between the measured value and the floor it writes.
 *
 * THE LINE COUNT THIS MARGIN IMPLIES DEPENDS ENTIRELY ON THE DENOMINATOR, AND THE TWO DENOMINATORS
 * HERE ARE NOT THE SAME QUANTITY. On the inherited `185,914`-line `src` denominator (the c8 method)
 * 0.5 pp is ~930 lines. On the denominator THIS gate actually measures — **42,397** executable line
 * entries, counted by the vitest path — it is **~212 lines**. Worse, the one observed single-slice
 * movement (0.20 pp on the c8 denominator) transposes to **~0.88 pp** here, which is **1.76x this
 * margin**. So the margin is NOT calibrated against measurement noise on the population it runs on:
 * the noise is currently unbounded. The value is left at 0.5 rather than re-typed, because any
 * replacement would be a number with no measurement behind it — the defect this file's discipline
 * exists to prevent. Recorded as a risk rather than papered over.
 */
export const FLOOR_MARGIN_PP = 0.5;

/** Two decimals: the precision the artifact is recorded at, and the raise is written at. */
export const round2 = (value) => Math.round(value * 100) / 100;

/**
 * A percentage for an operator to read, at up to four decimals with trailing zeros trimmed.
 *
 * Four, not two, because two makes the one line a human reads say nonsense: a measurement of 46.999
 * against a floor of 47 rendered as "lines 47% is BELOW the floor 47% by 0 pp". The direction guard
 * was right and the sentence was not.
 */
export const pct = (value) => Number(value.toFixed(4));

/**
 * Why `document` is not a usable floor artifact, as clause fragments the caller joins into one
 * refusal. `[]` means usable. Fail closed: an unreadable floor is a refusal to compare, never a
 * default.
 *
 * `population` is passed in rather than read from the document, so the artifact cannot SILENTLY name
 * a population the ratchet does not measure — the two spellings are compared on every run, which is
 * what keeps the duplicate from drifting unobserved.
 */
export function floorProblems(document, { population }) {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return [
      `is ${document === null ? 'null' : Array.isArray(document) ? 'an array' : typeof document}, not a JSON object`
    ];
  }
  const problems = [];
  if (document.version !== 1) {
    problems.push(`names version ${JSON.stringify(document.version)}, not 1`);
  }
  if (!Number.isFinite(document.linesPct) || document.linesPct <= 0 || document.linesPct > 100) {
    problems.push(
      `names linesPct ${JSON.stringify(document.linesPct)}, which is not a percentage in (0, 100]`
    );
  }
  if (!Number.isInteger(document.files) || document.files <= 0) {
    problems.push(
      `names files ${JSON.stringify(document.files)}, which is not a positive whole number of ` +
        'report rows — without it the population is pinned by name only, and a subset report reads green'
    );
  }
  if (document.counter !== COUNTER) {
    problems.push(
      `names counter ${JSON.stringify(document.counter)}, but this ratchet measures ${JSON.stringify(COUNTER)}`
    );
  }
  if (document.population !== population) {
    problems.push(
      `names population ${JSON.stringify(document.population)}, but the measuring command measures ${JSON.stringify(population)}`
    );
  }
  if (!Number.isFinite(document.measuredPct)) {
    problems.push(
      `names measuredPct ${JSON.stringify(document.measuredPct)}, which is not a number`
    );
  }
  return problems;
}

/**
 * The decision table, as data. `measured === linesPct` HOLDS (inclusive); `measured` below it
 * BREACHES. Both numbers and the margin are returned so the caller renders them rather than
 * recomputing them — a second subtraction at the print site is a second answer waiting to disagree
 * with this one.
 */
export function compare({ measuredPct, linesPct }) {
  const marginPp = round2(measuredPct - linesPct);
  const ok = measuredPct >= linesPct;
  return {
    ok,
    marginPp,
    line: ok
      ? `HELD — lines ${pct(measuredPct)}% is at or above the floor ${pct(linesPct)}% (margin ${pct(measuredPct - linesPct)} pp).`
      : `BREACHED — lines ${pct(measuredPct)}% is BELOW the floor ${pct(linesPct)}% by ${pct(linesPct - measuredPct)} pp.`
  };
}

/**
 * Why the report does not ACCOUNT FOR the population, or `null` when it does.
 *
 * THE SUBSET HOLE THIS CLOSES, and why it is the one that mattered most. Before this, a report
 * holding a strict SUBSET of `src/**` was accepted, so a one-row report at 97.82 % read `HELD` and
 * exited 0 — a gate that looks green while measuring almost nothing, which is precisely the failure
 * this slice exists to end. Nothing reachable through argv produced such a report, but the mechanism
 * that ADDS the untested files is an option (`coverage.include`) of exactly the kind upstream
 * silently dropped once already, and this repository has been burned by a check that ran nothing.
 * The floor's `files` row is measured, so the population is pinned by SIZE as well as by name.
 *
 * The direction is a floor, like everything else here: a report that accounts for MORE rows than the
 * floor records is fine (a new module joined), and one that accounts for fewer is a refusal.
 */
export function unaccountedProblem({ rows, floorRows, population }) {
  if (rows >= floorRows) return null;
  return (
    `REFUSING — the report accounts for ${rows} file(s) under ${population}, and the floor records ` +
    `${floorRows}. A report that is merely a SUBSET of the population is not a measurement of it, ` +
    'and a percentage over a shrunken population can hold while the gate measures almost nothing. ' +
    'If the population really shrank, say so in a review of the floor artifact.'
  );
}

/** What `--raise` would write for a measured value: the steady state, not the measurement. */
export function raisedFloor(measuredPct) {
  return round2(measuredPct - FLOOR_MARGIN_PP);
}

/**
 * Why `--raise` refuses, or `null` when it may write. It refuses whenever the value it would write is
 * BELOW the floor already on disk, so the tool CANNOT lower the floor — the whole point of a
 * monotonic ratchet. The check is on the value about to be written, not on the raw measurement: that
 * is strictly stronger, because `measured < floor` implies `measured - FLOOR_MARGIN_PP < floor` too,
 * so nothing the weaker rule would refuse gets through, and it also refuses a measurement that rose
 * by LESS than the margin.
 *
 * LOWERING IS THEREFORE A HAND EDIT, AND ONLY A HAND EDIT — one tracked line in a `git diff`,
 * holding a number no tool produced. That is the form a reviewer should interrogate, and it is the
 * residual hole AC4 states rather than hides.
 */
export function raiseRefusal({ measuredPct, linesPct }) {
  const next = raisedFloor(measuredPct);
  if (next >= linesPct) return null;
  return (
    `REFUSING to raise: the measured value ${pct(measuredPct)}% would write a floor of ` +
    `${next}%, which is BELOW the floor already on disk (${pct(linesPct)}%). ` +
    'A raise may only go up. If the tree genuinely lost coverage, that is a finding about the ' +
    'tree, not a reason to lower the bar — and lowering it is a hand edit to ' +
    `${FLOOR_PATH}, so that it is one visible line rather than a number a tool produced.`
  );
}

/**
 * Why the WORKING-COPY floor may not be compared at all, or `null` when it may.
 *
 * A hand edit can lower the floor and, without this, nothing notices: every arm of the test battery
 * derives from the value read off disk, so a floor quietly set to 5.0 passes a 6.2 % report. That was
 * measured against the first draft of this slice, and it is the hole `.husky/baseline/anchor.mjs`
 * already closed for the ceilings artifact by reading the previous value out of git history.
 *
 * `head` is HEAD's parsed floor, or `null` when HEAD has none — the seed landing, which is the one
 * case where there is nothing to compare against and nothing to refuse. `allowLower` is the explicit
 * `--lower-floor` flag: a DELIBERATE lowering is a named, visible act rather than an invisible edit,
 * which is the whole difference this guard buys. The flag is deliberately not silent.
 *
 * REFUSES, it does not merely warn: a lowered floor makes every verdict after it meaningless, so
 * there is nothing useful to print alongside it.
 */
export function loweringRefusal({ head, working, allowLower }) {
  if (head === null || allowLower === true) return null;
  if (!Number.isFinite(head.linesPct) || working.linesPct >= head.linesPct) return null;
  return (
    `REFUSING to compare: the floor on disk is ${pct(working.linesPct)}%, and HEAD records ` +
    `${pct(head.linesPct)}%. A monotonic floor may only rise, so this is either an unintended edit ` +
    'or a deliberate lowering. If it is deliberate, say so explicitly with `--lower-floor` — the ' +
    'point is that lowering is a named act a reviewer can see, not one nobody notices.'
  );
}

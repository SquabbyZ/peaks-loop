// .husky/gate/findings-table.mjs
//
// THE TWO ESLINT ROWS AS A NAMED TABLE, NOT A COUNT (rid
// `rid-count-ceiling-exemption-table`).
//
// THE DEFECT THIS REPLACES. `repo` mode asserted `eslintFindings` — an upper bound
// on a NUMBER of findings — and a bound on a count is a bound no individual finding
// can force action on. Measured: the rule `no-require-imports` (severity ERROR) was
// reporting all 16 sites of the ESM `require()` family while those 16 sat inside a
// total of 1758, i.e. approximately nothing; four `eslint-disable` comments guarding
// those sites named `no-var-requires` while the rule FIRING was the DIFFERENT
// `no-require-imports`, so they suppressed nothing that was reporting — and nothing
// noticed, because the total never moved far enough to be read. (The first version of
// this sentence said `no-var-requires` "does not exist"; it does exist — deprecated,
// `deprecatedSince: 8.0.0`, `replacedBy: ['@typescript-eslint/no-require-imports']` in
// the installed eslint-plugin 8.66.0 — and a deprecated rule still reports. The cause
// is the rule-id MISMATCH, not a missing rule. Those four comments were swept by
// `c3fe88b7`.)
//
// THE ASSERTION IS NOW SET CONTAINMENT PLUS PER-ROW NO-GROWTH, over the table the
// census ALREADY writes. `.peaks/lint/gate-baseline.json` `files` is one row per gated
// file — 1270 of them, `{eslint, eslintErrors, coverageGap, notLinted, prettierClean}`
// — and this module reads the `eslint` / `eslintErrors` numbers as TOLERANCES BY NAME:
//
//     a file the table names may hold at most what its row names;
//     a file the table does not name may hold none.
//
// The precedent is `.husky/format-check-ratchet.mjs`, which argues the same case in
// its own header: under `count <= N`, cleaning one old file and adding one new one
// leaves the count unchanged — still green — so the check says something FALSE in
// exactly the case it exists to catch. Containment fixes both directions: cleaning a
// file SHRINKS what is measured (green, correct), and a new name with findings is
// OUTSIDE the table (red, correct).
//
// THE GRANULARITY IS THE FILE, WHICH IS THE COARSEST HONEST CHOICE. Findings are not
// recorded by identity anywhere — the census counts them per file — so a table of
// INDIVIDUAL findings is not obtainable from what is measured, and this change is
// about what the gate ASSERTS, not about what the census measures. What IS obtainable
// is what this asserts: a file the table does not name is red BY NAME, and a NAMED
// file that gains one is red WITH BOTH NUMBERS.
//
// THREE LIMITS, EACH MEASURED, STATED RATHER THAN LEFT TO BE FOUND.
// A guard that overstates itself is the §2.41 defect, so all three are named here and all
// three are pinned by arms in `tests/unit/lint/findings-table.test.ts`:
//   - SWAPPED FINDINGS ARE NOT AN IDENTITY. A finding REMOVED and another ADDED inside
//     one file, at the same row value, is invisible: this judges counts per file
//     (`judgeLintRow({ file: 'src/a.ts', measured: { findings: 5 }, allowed: { eslint: 5 } })`
//     → 0 failures).
//   - A NAME IS NOT AN IDENTITY EITHER. The table is keyed by PATH, so findings that
//     MOVE onto a name with slack are green at both ends: the old path's row descends
//     (a permitted direction) and the new path's row tolerates what arrived
//     (`judgeLintRow({ file: 'src/moved-here.ts', measured: { findings: 3 }, allowed: { eslint: 5 } })`
//     → 0 failures). Tracking identity across renames is a different slice; the
//     generator's `rows.mjs` states the same limit from the writing side.
//   - THE LOOKUP IS EXACT-STRING, AND THAT IS THE SAFE DIRECTION. The table pass reads
//     `table[file]` with no normalisation, so a variant spelling of a named path
//     (`./src/a.ts`, `src/./a.ts`, `SRC/A.TS`) MISSES — it is refused as a new path
//     rather than tolerated by the row it resembles (measured:
//     `judgeFindingsTable({ measured: [['./src/a.ts', { findings: 1 }]], table: { 'src/a.ts':
//     { eslint: 9 } } })` → 1 failure, `NEW file ./src/a.ts`). No normaliser is added
//     because nothing needs one: both callers take their paths from git (the census scope
//     for `repo`, lint-staged's repo-relative argv for the commit path), and a normaliser
//     here would be a second spelling of "which file is this" that no measurement observes.
//
// THE ROWS MAY ONLY SHRINK. A row is not a permission — it is one file's standing
// debt, cleared a slice at a time by splitting the file. A file measured BELOW its row
// is reported so the table can be re-pointed downwards; a file measured ABOVE its row
// refuses. The count row is kept and printed as EVIDENCE — it is the SUM of the rows —
// and it is NOT what refuses a reshuffle: a sum cannot see one row rising while another
// falls. The per-file rule is applied at BOTH ends instead, which is why the regeneration
// this module's descent note recommends cannot launder what this module refuses:
// `.husky/monotonic/rows.mjs` refuses a row that moves UP against HEAD's own per-file map
// (F-1 of the review measured that hole: before it, a reshuffle raised no total, the
// generator rewrote both rows, and this gate then compared the new row with itself).
//
// ONE RULE, TWO POPULATIONS. `judgeLintRow` is the rule `.husky/gate/ratchet.mjs`
// already applied to the files one commit touches — "a file you touch may not be WORSE
// than it was" — and `repo` mode is the same rule over every file the scope names. The
// message shapes are the ratchet's own, so a reader meets ONE sentence for ONE rule
// whichever mode produced it. `compareErrors` is off on the commit path (which has
// always judged findings only: a push-time rule stricter than the commit-time one is
// how a gate teaches `--no-verify`) and on in `repo` mode, which is the enforcement
// surface and already judges rows the per-file modes never see.

/** The two quantities a row carries: the artifact's key, and the runEslint key. */
const FINDINGS = Object.freeze({ field: 'eslint', measured: 'findings', noun: 'lint finding' });
const ERRORS = Object.freeze({ field: 'eslintErrors', measured: 'errors', noun: 'lint error' });

/** The `First:` clause the ratchet has always printed. Findings only — see below. */
function firstFindingText(measured) {
  const m = measured.firstFinding;
  if (m === undefined || m === null) return null;
  return `${m.ruleId ?? '(fatal)'} at ${m.line}:${m.column} — ${String(m.message).split('\n')[0]}`;
}

/** A row's / a verdict's count, or `null` when it is not a non-negative integer. */
function readCount(source, field) {
  if (source === null || typeof source !== 'object') return null;
  const value = source[field];
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/** How a rejected value is named, without ever rendering `undefined` as a number. */
function namedValue(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  return String(value);
}

/**
 * A file the table does not name, holding something. `first` is the location of the
 * first FINDING, so it is printed for the findings row only: `firstFinding` is the
 * first message of any severity, and pinning an ERROR message to a site that carries
 * a warning would be the message claiming more than the measurement does.
 */
function unNamedFailure(file, quantity, actual, first) {
  return (
    `NEW file ${file} has ${actual} ${quantity.noun}(s) and the table names no row at ` +
    `this path, so nothing tolerates them.` +
    (first === null ? '' : ` First: ${first}`)
  );
}

function grownFailure(file, quantity, named, actual) {
  return (
    `${file} went from ${named} to ${actual} ${quantity.noun}(s) (+${actual - named}). ` +
    `The table names ${named} for this file, and a row may only shrink.`
  );
}

/**
 * ONE FILE, JUDGED AGAINST THE ROW THAT NAMES IT.
 *
 * `measured` is the runEslint verdict for this file (`{findings, errors, firstFinding,
 * …}`); `allowed` is `baseline.files[file]`, or `undefined` when the table names no
 * such path. Returns the failures to report and how many quantities came in BELOW
 * their name — a descent is not a failure, and the caller prints it as the reason to
 * re-point the table.
 *
 * FAIL CLOSED ON A MALFORMED ROW, like every other leg here: a row that exists but
 * carries no integer for a quantity this run measures is an artifact this comparison
 * may not read as "nothing named", which is the reading that would make a breach look
 * like a pass.
 */
export function judgeLintRow({ file, measured, allowed, compareErrors = false }) {
  const quantities = compareErrors ? [FINDINGS, ERRORS] : [FINDINGS];
  const failures = [];
  // THE MEASURED NUMBERS THIS CALL VALIDATED, handed back so a caller SUMS ONLY THOSE
  // (F-5 of the review). `judgeFindingsTable` used to total `verdict.findings ?? 0`
  // independently of this loop: a verdict of `{findings: '3'}` gave the totals a string
  // (`"0" + "3"` → `"03"`) and `{findings: null}` gave `NaN`, and `NaN > ceiling` is
  // FALSE — an evidence row that passes silently. Not reachable today (`eslint.mjs`
  // builds `findings: real.length`), which is why it is closed now: the coercion was one
  // edit away from being reachable and nothing would have said so.
  const counted = {};
  let improved = 0;
  for (const quantity of quantities) {
    const actual = readCount(measured, quantity.measured);
    if (actual === null) {
      failures.push(
        `${file}: this run reported ${namedValue(measured?.[quantity.measured])} for ` +
          `'${quantity.measured}', which is not a non-negative integer. An unreadable ` +
          'measurement is not a clean file, so it is refused rather than compared.'
      );
      continue;
    }
    counted[quantity.measured] = actual;
    if (allowed === undefined) {
      if (actual > 0) {
        failures.push(
          unNamedFailure(
            file,
            quantity,
            actual,
            quantity === FINDINGS ? firstFindingText(measured) : null
          )
        );
      }
      continue;
    }
    // A ROW THAT IS NOT AN OBJECT IS THE SAME SHAPE AS A ROW WITHOUT A NUMBER (F-3 of
    // the review): `null` reached this line as a `TypeError` — fail-closed by crashing,
    // which is not the readable refusal this function promises. `undefined` above is the
    // table naming NO path, which is a different verdict and keeps its own sentence.
    const named = readCount(allowed, quantity.field);
    if (named === null) {
      failures.push(
        `${file}: the table has a row for this file but names no integer at ` +
          `'${quantity.field}', so this run cannot tell what it tolerates. Regenerate the baseline.`
      );
      continue;
    }
    if (actual > named) failures.push(grownFailure(file, quantity, named, actual));
    else if (actual < named) improved++;
  }
  return { failures, improved, counted };
}

/** What `judgeLintRow` cannot answer alone: the totals, which are now DERIVED. */
export function judgeFindingsTable({ measured, table }) {
  const failures = [];
  const totals = { findings: 0, errors: 0 };
  const shrinking = [];
  const judgedFiles = new Set();
  for (const [file, verdict] of measured) {
    const judged = judgeLintRow({
      file,
      measured: verdict,
      allowed: table[file],
      compareErrors: true
    });
    failures.push(...judged.failures);
    // SUMMED FROM WHAT WAS VALIDATED, never from the raw verdict (F-5): a value this
    // comparison refused contributes nothing here, so it cannot reach the totals as a
    // `NaN` the ceiling check reads as `false` and prints as passing.
    totals.findings += judged.counted.findings ?? 0;
    totals.errors += judged.counted.errors ?? 0;
    judgedFiles.add(file);
    if (judged.improved > 0) shrinking.push(file);
  }
  let tolerated = 0;
  let namedAtZero = 0;
  // A ROW FOR A PATH THIS RUN DOES NOT MEASURE IS COUNTED AND NEVER JUDGED — a deleted
  // file's row is the live case. `unmeasured` makes that visible in the number instead of
  // leaving a reader to assume every tolerated name was compared.
  let unmeasured = 0;
  for (const [file, row] of Object.entries(table)) {
    if (!Number.isInteger(row?.eslint)) continue;
    if (row.eslint > 0) {
      tolerated++;
      if (!judgedFiles.has(file)) unmeasured++;
    } else namedAtZero++;
  }
  return { failures, totals, tolerated, namedAtZero, unmeasured, shrinking };
}

/**
 * THE SENTENCES, printed whether or not the comparison refused — a reader of a red run
 * needs the shape of the table that refused it. The two derived totals are printed by
 * the caller through the gate's own row printer; these lines say what they ARE.
 */
export function findingsTableLines(result) {
  const lines = [
    `  the table names ${result.tolerated} file(s) tolerating findings and ${result.namedAtZero} ` +
      `at zero${result.unmeasured > 0 ? ` (${result.unmeasured} of the named rows are for paths this run did not measure, so they were counted and not judged)` : ''} ` +
      '— the NAMES are the assertion and the two totals above are their sum.'
  ];
  if (result.shrinking.length > 0) {
    const first = result.shrinking.slice(0, 3).join(', ');
    lines.push(
      `  ${result.shrinking.length} named file(s) came in BELOW their row (${first}` +
        `${result.shrinking.length > 3 ? ', …' : ''}) — a descent is green. Re-point the table with ` +
        '`node .husky/peaks-gate-baseline.mjs`; it refuses a row that moved UP, so that command ' +
        'is advice for a descent and cannot widen one.'
    );
  }
  return lines;
}

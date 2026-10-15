/**
 * `.husky/coverage-ratchet/report.mjs` — the coverage REPORT: the command that produces it, and the
 * reader that decides whether it may be believed. PURE apart from `readSummary` taking text
 * rather than a path, so a unit test can hand it a fixture without a file or a measurement.
 *
 * ONE SUBJECT, TWO HALVES. The argv below and the reader are the same fact — "what this
 * report is" — kept in one module so the population cannot be spelled twice and drift. The
 * glob is `POPULATION_GLOB`; the floor artifact's own `population` field is VALIDATED against
 * it on every run rather than trusted.
 *
 * WHY VITEST AND NOT THE FROZEN `scripts/coverage-c8.mjs`. That script is the strict 100%
 * instrument, it is not to be modified, and this slice does not weaken it — but its exit is
 * always non-zero, so a caller could not tell "the bar was not met" from "instrumentation
 * never fired"; and its `--src=` sweep is the whole project, so it drags `dist/**` and
 * `.peaks/**` into a denominator that is then thrown away. This ratchet owns its own
 * measurement instead, scoped to `src/**` by the expression below. The c8 path stays
 * available and unblocked for anyone who wants it.
 *
 * THE TWO METHODS PRODUCE DIFFERENT QUANTITIES, AND THE NUMBERS ARE NOT INTERCHANGEABLE. Measured
 * 2026-10-16: the c8 path's `src`-only denominator is 185,914 lines (≈88 % of `src`'s physical
 * lines, because V8 line ranges span the blank and comment lines inside a function); this path's is
 * 42,397 executable line ENTRIES over the same 1,243 files (a multi-line statement is one entry).
 * So a percentage from one is not comparable to a percentage from the other, and this module is the
 * only place that defines which one the floor's number is on.
 *
 * VITEST'S ENTRY IS SPAWNED AS ITS `.mjs`, NOT THROUGH `node_modules/.bin`. The `.bin` shim
 * is a `.cmd` on Windows, which Node >= 20 will not spawn without `shell: true`, and
 * `shell: true` concatenates argv unescaped — the landmine `scripts/coverage-c8.mjs:99-104`
 * documents at length. The JS entry needs no shim and no shell.
 *
 * FAIL CLOSED ON EVERY DEGENERATE REPORT: absent, empty, unparseable, no `total` row, no numeric
 * `total.lines.pct`, a percentage outside [0, 100], no file rows, or ANY file row outside the
 * population. A report that is missing or partial is not a report of zero coverage, and "nothing was
 * measured" may never share an output with "coverage held".
 */

import { relative, resolve } from 'node:path';

/**
 * The population glob, and what guarantees it — stated without overclaiming.
 *
 * It NO LONGER reads "`dist/**` and `.peaks/**` cannot match it": vitest matches this option with
 * picomatch `{ contains: true }` (`vitest/dist/chunks/coverage.DM_a_rWm.js:662-681`), so a path like
 * `dist/src/x.js` WOULD match. The guarantee is not the expression; it is the reader below, which
 * refuses any row whose path is not under `src/`. The expression and the reader are belt and braces,
 * and only the braces hold on their own.
 */
export const POPULATION_GLOB = 'src/**';

/** Where the measuring command writes, and the reader reads. One fact, one spelling. */
const REPORTS_DIR = 'coverage';

/** The report this ratchet reads, repo-relative. */
export const SUMMARY_PATH = `${REPORTS_DIR}/coverage-summary.json`;

/**
 * The measuring command's arguments, after the vitest entry.
 *
 * `--coverage.include` IS THE WHOLE POPULATION EXPRESSION, and it is what puts an UNTESTED
 * file under `src/` in the denominator: vitest 4's v8 provider merges a zero-coverage entry
 * for every file matching `include` that no test touched (provider.js: "Include untested
 * files when all tests were run" — guarded by `options.include != null`). That is the
 * property that makes a new, untested module a MEASURABLE drop. It is the successor to
 * vitest 3's `coverage.all`, which no longer exists in vitest 4.1.10 — asserting
 * `coverage.all` here would assert an option the runner ignores.
 *
 * THERE IS NO `--coverage.exclude`. Vitest 4's `coverageConfigDefaults.exclude` is `[]`, and the
 * population is meant to be a property of the expression rather than a maintained list.
 */
export const MEASURE_ARGS = Object.freeze([
  'run',
  '--coverage',
  `--coverage.include=${POPULATION_GLOB}`,
  '--coverage.reporter=json-summary',
  '--coverage.reporter=text-summary',
  `--coverage.reportsDirectory=${REPORTS_DIR}`
]);

/** A path as `/`-separated, so a Windows-native row and a POSIX one compare the same. */
const posix = (path) => path.split('\\').join('/');

/**
 * Whether one report row is inside the population.
 *
 * `path.relative` rather than a string prefix, so the answer does not depend on how the
 * report spells the root: a forward-slash key, a backslash key, a trailing separator and an
 * already-relative key all normalise to the same relative path. A row whose relative path
 * starts with `..` is outside, and is refused with both paths named so a root mismatch is
 * unmistakable rather than mysterious.
 *
 * The population's directory is derived from the glob here rather than restated: `src/**` -> `src`.
 */
function underPopulation(key, root) {
  const rel = posix(relative(root, resolve(root, key)));
  const dir = POPULATION_GLOB.replace(/\/\*\*$/, '');
  return rel === dir || rel.startsWith(`${dir}/`);
}

/**
 * Read the report. Returns `{ problem, files, linesPct, foreign }`.
 *
 * `files` is ALWAYS a NUMBER — the count of file rows — so a caller can interpolate it into a
 * sentence. It was an array on one early return path, which made the population line print
 * `packages/x.ts file(s)` on exactly the refusal an operator most needs to read; every return path
 * now agrees.
 *
 * `problem` is `null` only when the report is complete, parseable and entirely inside the
 * population; every other shape names what was wrong. `foreign` carries the offending rows so
 * a caller can print them instead of saying "something was wrong somewhere".
 */
export function readSummary(text, { root }) {
  const empty = { problem: null, files: 0, linesPct: null, foreign: [] };
  if (typeof text !== 'string' || text.trim() === '') {
    return { ...empty, problem: 'is empty or unreadable' };
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch (err) {
    const first = String(err.message).split('\n')[0];
    return { ...empty, problem: `is not parseable JSON (${first})` };
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    const what =
      document === null ? 'null' : Array.isArray(document) ? 'an array' : typeof document;
    return { ...empty, problem: `is ${what}, not a JSON object` };
  }
  const rows = Object.keys(document).filter((key) => key !== 'total');
  // Every refusal below carries the ROW COUNT THE REPORT ACTUALLY HAD. Reporting 0 while rows are
  // present would say "nothing was measured" about a report that did measure something, which is the
  // one sentence this file may never print wrongly.
  const withRows = (problem, extra = {}) => ({ ...empty, problem, files: rows.length, ...extra });
  const total = document.total;
  if (total === null || typeof total !== 'object') {
    return withRows('has no `total` row');
  }
  const linesPct = total.lines === undefined || total.lines === null ? null : total.lines.pct;
  if (typeof linesPct !== 'number' || !Number.isFinite(linesPct)) {
    return withRows('has no numeric `total.lines.pct`');
  }
  // Bounded like the floor's own percentage. An unbounded one is asymmetric with `floorProblems`
  // and lets a nonsense report (`pct: 1000`) read HELD against any floor.
  if (linesPct < 0 || linesPct > 100) {
    return withRows(`reports a percentage of ${linesPct}, outside [0, 100]`, { linesPct });
  }
  if (rows.length === 0) {
    return withRows('lists no file rows, so nothing was measured', { linesPct });
  }
  const foreign = rows.filter((key) => !underPopulation(key, root));
  if (foreign.length > 0) {
    return {
      problem:
        `measures ${foreign.length} file(s) OUTSIDE ${POPULATION_GLOB} (of ${rows.length} rows), ` +
        'so its total is not the population this floor is recorded over',
      files: rows.length,
      linesPct,
      foreign
    };
  }
  return { problem: null, files: rows.length, linesPct, foreign: [] };
}

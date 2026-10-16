/**
 * `.husky/coverage-ratchet/report.mjs` — the coverage REPORT: the command that produces it, and the
 * reader that decides whether it may be believed. PURE apart from `readSummary` taking text
 * rather than a path, so a unit test can hand it a fixture without a file or a measurement.
 *
 * ONE SUBJECT, TWO HALVES. The argv below and the reader are the same fact — "what this
 * report is" — kept in one module so the population cannot be spelled twice and drift. The
 * glob is `POPULATION_GLOB`; the floor artifact's own `population` field is VALIDATED against
 * it on every run rather than trusted, and the measuring expression is the same glob ANCHORED
 * at the repository root (`measureArgs`), so the expression and the reader agree by construction
 * rather than by coincidence.
 *
 * WHY THIS MODULE OWNS ITS OWN MEASUREMENT RATHER THAN REUSING THE REMOVED ONE. The
 * repository's strict 100% instrument, `scripts/coverage-c8.mjs`, was removed on 2026-10-17
 * (backlog §13.4 rule 2) and this paragraph is kept, past-tensed, because it is the record of
 * a choice that still governs: this gate was never a weakened copy of that one, and the
 * numbers below are the reason. While it existed, its exit was always non-zero, so a caller
 * could not tell "the bar was not met" from "instrumentation never fired"; and its `--src=`
 * sweep was the whole project, so it dragged `dist/**` and `.peaks/**` into a denominator that
 * was then thrown away. This ratchet owns its own measurement instead, scoped to `src/**` by
 * the expression below.
 *
 * THE TWO METHODS PRODUCE DIFFERENT QUANTITIES, AND THE NUMBERS ARE NOT INTERCHANGEABLE. This is
 * what the removal leaves behind: anyone who remembers a coverage number from the removed path
 * must not read it as this floor's. Measured 2026-10-16: the removed path's `src`-only
 * denominator was 185,914 lines (≈88 % of `src`'s physical lines, because V8 line ranges span the
 * blank and comment lines inside a function); this path's is 42,397 executable line ENTRIES over
 * the same 1,243 files (a multi-line statement is one entry). So a percentage from one is not
 * comparable to a percentage from the other, and this module is the only place that defines which
 * one the floor's number is on.
 *
 * VITEST'S ENTRY IS SPAWNED AS ITS `.mjs`, NOT THROUGH `node_modules/.bin`. The `.bin` shim
 * is a `.cmd` on Windows, which Node >= 20 will not spawn without `shell: true`, and
 * `shell: true` concatenates argv unescaped — the landmine the removed instrument's
 * `--temp-directory=` / `--reports-dir=` / `--src=` arguments documented at length. The JS
 * entry needs no shim and no shell.
 *
 * FAIL CLOSED ON EVERY DEGENERATE REPORT: absent, empty, unparseable, no `total` row, no numeric
 * `total.lines.pct`, a percentage outside [0, 100], no file rows, or ANY file row outside the
 * population. A report that is missing or partial is not a report of zero coverage, and "nothing was
 * measured" may never share an output with "coverage held".
 */

import { isAbsolute, relative, resolve } from 'node:path';
import picomatch from 'picomatch';

/**
 * The population, as a NAME: the `population` field the floor artifact records, and the directory
 * the reader below tests each row against.
 *
 * IT IS NO LONGER THE WHOLE MEASURING EXPRESSION — see `measureArgs`, which anchors it at the
 * repository root. It stays the bare glob because the tracked artifact and the reader's directory
 * derivation are both built from this spelling, so there is still exactly one place the population
 * is written down and no second name to drift away from it.
 */
export const POPULATION_GLOB = 'src/**';

/** Where the measuring command writes, and the reader reads. One fact, one spelling. */
const REPORTS_DIR = 'coverage';

/** The report this ratchet reads, repo-relative. */
export const SUMMARY_PATH = `${REPORTS_DIR}/coverage-summary.json`;

/** A path as `/`-separated, so a Windows-native row and a POSIX one compare the same. */
const posix = (path) => path.split('\\').join('/');

/**
 * Every glob metacharacter picomatch would otherwise read as SYNTAX. A root is text from the host and
 * is not guaranteed to be pattern-safe: `C:/Program Files (x86)/repo` is an ordinary place to clone a
 * repository, and unescaped the `(x86)` parses as a regex group, so the pattern matches nothing at all
 * (measured). Escaping is a no-op for a root carrying none of these, which is every root this
 * repository has been built under.
 */
const GLOB_META = /([*?[\]{}()!+@|\\])/g;

/** The placeholder both halves of the probe below are built from. Named once. */
const PROBE = '__ratchet_probe__';

/**
 * Whether `pattern` tells the population apart from the leak: it must match `<prefix>/src/<file>` and
 * must NOT match `<prefix>/packages/<pkg>/src/<file>`.
 *
 * WHAT IT CAN AND CANNOT SEE, MEASURED RATHER THAN ASSUMED. Both probes are built from the SAME prefix
 * the pattern was composed from, so this asks whether the pattern discriminates RELATIVE TO ITS OWN
 * ROOT — which is trivially true of every absolute root on Windows (41 spellings measured, none
 * rejected). It fires only when the pattern is WIDER than its own prefix text: an empty prefix (POSIX
 * root `/`) or a broken escape. It is therefore a redundant early backstop, NOT the guarantee — what
 * guarantees the population is the reader's `underPopulation` check and the row-count pin, and neither
 * is this function's.
 *
 * `PURE`: two `picomatch` calls, no filesystem, no spawn.
 */
export function discriminates(pattern, prefix) {
  const isMatch = picomatch(pattern, { contains: true });
  return (
    isMatch(`${prefix}/src/${PROBE}.ts`) === true &&
    isMatch(`${prefix}/packages/${PROBE}/src/${PROBE}.ts`) === false
  );
}

/**
 * The measuring command's arguments, after the vitest entry. `root` is the repository root.
 *
 * `--coverage.include` IS THE WHOLE POPULATION EXPRESSION, and it is what puts an UNTESTED
 * file under `src/` in the denominator: vitest 4's v8 provider merges a zero-coverage entry
 * for every file matching `include` that no test touched (provider.js: "Include untested
 * files when all tests were run" — guarded by `options.include != null`). That is the
 * property that makes a new, untested module a MEASURABLE drop. It is the successor to
 * vitest 3's `coverage.all`, which no longer exists in vitest 4.1.10 — asserting
 * `coverage.all` here would assert an option the runner ignores.
 *
 * THE EXPRESSION IS ROOT-ANCHORED, AND THAT IS THE WHOLE OF THE POPULATION FIX. vitest hands this
 * option to picomatch with `{ contains: true }` (`vitest/dist/chunks/coverage.DM_a_rWm.js:662-681`),
 * so the pattern matches ANYWHERE in a path rather than only at its start. A bare `src/**` therefore
 * matched `packages/peaks-loop-internal-runtime/src/x.ts` as well — and rows enter this report by a
 * second path besides the glob: every EXECUTED script is tested with `isIncluded(fileURLToPath(
 * result.url))`, so a test that imports a `packages/<pkg>/src` module directly puts that file's
 * absolute path in the report. Measured on the full unit suite: 19 such rows, 1262 rows in total,
 * while the floor is recorded over 1243. Anchoring the pattern at the repository root is what makes
 * it match `<root>/src/**` and nothing else, so the report's total IS the floor's population.
 *
 * THE ROOT IS TREATED AS A LITERAL, AND THE EXPRESSION IS ROOT-ANCHORED. This function GUARANTEES
 * four properties and nothing else: the include it returns is ABSOLUTE; `resolve`-NORMALISED, so `.`,
 * `..` and a doubled separator cannot survive in it; GLOB-ESCAPED, with the escape applied to the root
 * BEFORE the `/src/**` suffix is appended, which is what keeps that suffix a globstar; and it BEGINS
 * WITH THE REPOSITORY ROOT every time.
 *
 * WHAT ACTUALLY KEEPS THE POPULATION HONEST, SAID HERE BECAUSE THIS IS WHERE A READER LOOKS: **the
 * reader below.** `underPopulation` refuses any row outside `src/`, and `unaccountedProblem` refuses a
 * report accounting for fewer than the recorded rows — on every run, for every report. Everything in
 * this function exists to make those two checks SUFFICIENT; they are what refuses a wrong or a missing
 * population, and they are the part that cannot be talked out of it.
 *
 * THE PROBE BELOW IS A REDUNDANT EARLY BACKSTOP, and it is described that way on purpose. Six spellings
 * of a root were hunted one at a time while this was built — relative, a trailing separator, a native
 * separator, a metacharacter, an unfolded `.`/`..`, and root `/` — each one hidden behind the last fix,
 * which is a good sign that enumerating is the wrong method. The list is deliberately NOT repeated here;
 * those spellings are pinned by arms O2 and O3 beside the guard that handles each, and an unlisted
 * seventh would be caught by the reader rather than by this file. What the probe buys is the one case it
 * can see — an empty prefix, which composes the bare `/src/**`, i.e. the leak — refused LOUDLY at
 * composition time instead of by the reader at measurement time. **Deleting it changes no verdict QA
 * measured; it changes when the refusal prints.**
 *
 * ONE NAMED EXCEPTION, AND WHY IT IS NAMED RATHER THAN CLOSED: A CASE-DIFFERING ROOT. `resolve` does not
 * canonicalise case (`d:/repo` stays `d:/repo`; measured) and picomatch is case-SENSITIVE here, so
 * `d:/repo/src/**` matches nothing. Every pure fix is a guess or a break: uppercasing the drive letter
 * guesses the case the candidate will carry and, guessing wrong, produces the silent-empty population
 * this function exists to prevent; case-folding the root is correct on Windows and WRONG on POSIX, where
 * two directories really can differ only by case; and a `[dD]` drive class would stop the argument from
 * literally beginning with the repository root, which AC1(i) pins. `realpathSync` is filesystem I/O in a
 * module documented as pure. It fails CLOSED like everything else here, and it is latent: the live call
 * site derives the root from `import.meta.url` and the candidates come from the same machinery.
 *
 * THERE IS NO `--coverage.exclude`. Vitest 4's `coverageConfigDefaults.exclude` is `[]`, and the
 * population is meant to be a property of the expression rather than a maintained list. The anchoring
 * above is what makes that true; an exclude list naming `packages/**` would be a second place the
 * population is written down.
 */
export function measureArgs(root) {
  if (!isAbsolute(root)) {
    throw new TypeError(
      `measureArgs needs an absolute root to anchor the population at, and got ${JSON.stringify(root)}. ` +
        'A relative root yields a pattern that matches paths OUTSIDE <root>/src/ — measured: `.` and ' +
        '`` both admit packages/*/src/** — so it is refused rather than used.'
    );
  }
  const prefix = posix(resolve(root)).replace(/\/+$/, '');
  const pattern = `${prefix.replace(GLOB_META, '\\$1')}/${POPULATION_GLOB}`;
  // The redundant backstop described above: only an empty prefix or a broken escape can fail this, and
  // it turns that case into a loud failure here instead of a refusal by the reader later.
  if (!discriminates(pattern, prefix)) {
    throw new TypeError(
      `measureArgs composed an include for root ${JSON.stringify(root)} that does not discriminate: ` +
        `${JSON.stringify(pattern)}. It must match <root>/src/<file> and must NOT match ` +
        '<root>/packages/<pkg>/src/<file>. An expression that fails either half measures a population ' +
        'other than src/** — the defect this module was repaired for — so it is refused rather than used.'
    );
  }
  return Object.freeze([
    'run',
    '--coverage',
    `--coverage.include=${pattern}`,
    '--coverage.reporter=json-summary',
    '--coverage.reporter=text-summary',
    `--coverage.reportsDirectory=${REPORTS_DIR}`
  ]);
}

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

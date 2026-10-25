/**
 * `.husky/test-duration-ratchet/ceiling.mjs` — the unit suite's wall-clock CEILING: the
 * artifact's shape, and the decisions taken from it. PURE: it reads no file and spawns
 * nothing, so a unit test can drive the whole decision table without paying for a
 * fourteen-minute suite run.
 *
 * WHY A CEILING, AND WHY IT IS A THIRD DIRECTION. `.peaks/lint/gate-baseline.json` holds
 * CEILINGS, and `.peaks/lint/coverage-floor.json` holds a FLOOR. This artifact is a ceiling
 * whose good direction is DOWN, so it resembles the first and is the mirror image of the
 * second: a rise in wall clock is a regression and is refused, exactly as a rise in an
 * eslint count is. It is a separate file with a separate reader because a second artifact
 * wearing the same name is a number nobody knows how to move — `.peaks/lint/README.md`
 * carries the table that says which is which.
 *
 * A WALL CLOCK IS ONLY COMPARABLE AT ONE CONCURRENCY, WHICH IS WHY `maxWorkers` IS A
 * FIELD OF THE ARTIFACT. Measured 2026-10-25 on win32 with 16 cores: the same 629 test
 * files cost 1.357 s of wall clock each at 2 workers and 0.776 s each at 4. A 4-worker
 * measurement compared against a 2-worker ceiling does not fail — it PASSES, and the bar
 * quietly stops meaning anything, which is worse than a red gate because a red gate gets
 * looked at. So the artifact records the concurrency it was seeded at, and a fresh
 * measurement taken at a different concurrency is REFUSED rather than compared.
 *
 * `effectiveMaxWorkers` BELOW IS A SECOND COPY OF `vitest.workers.ts`'s `parseOverride`,
 * and it has to be: `.husky/**` is plain `.mjs` and cannot import the repository's
 * TypeScript. A second copy of one decision is exactly what this repository keeps
 * refusing — `vitest.workers.ts` exists because the worker count used to be restated in
 * seven configs. So the copy is not left to drift: a unit test drives BOTH under the same
 * environment values, illegal ones included, and requires them to agree.
 *
 * THE BOUNDARY IS INCLUSIVE, DELIBERATELY. `measured === ceiling` HOLDS. A ratchet set
 * exactly at the value it measured must be green on the tree it measured, or `--tighten`
 * would emit a red gate the moment it wrote. The convention is a choice, so it is stated
 * here and pinned by its own test arm rather than left for a reader to infer.
 */

/** Where the ceiling lives, repo-relative. Tracked: a tightening must be visible in `git log -p`. */
export const CEILING_PATH = '.peaks/lint/test-duration-ceiling.json';

/** The population this gate measures: the unit suite's test files. */
export const POPULATION_GLOB = 'tests/unit/**/*.test.ts';

/**
 * The headroom `--tighten` leaves between the measured wall clock and the ceiling it
 * writes. Five minutes: long enough that a noisy CI runner does not make the next run
 * red, short enough that the ceiling still tracks the suite rather than trailing it.
 */
export const CEILING_MARGIN_SECONDS = 300;

/**
 * The worker count this repository's policy falls back to.
 *
 * A SECOND COPY of `DEFAULT_MAX_WORKERS` in `vitest.workers.ts`, for the same reason
 * `effectiveMaxWorkers` below is a second copy of `parseOverride`. Pinned by a unit test
 * that imports the TypeScript original and requires the two to agree.
 */
export const DEFAULT_MAX_WORKERS = 2;

/** One decimal: the precision the artifact records, and the comparison is rendered at. */
export const round1 = (value) => Math.round(value * 10) / 10;

/**
 * Why `document` is not a usable ceiling artifact, as clause fragments the caller joins
 * into one refusal. `[]` means usable. Fail closed: an unreadable ceiling is a refusal to
 * compare, never a default.
 *
 * `population` is passed in rather than read from the document, so the artifact cannot
 * SILENTLY name a population this ratchet does not measure — the two spellings are
 * compared on every run, which is what keeps the duplicate from drifting unobserved.
 */
export function ceilingProblems(document, { population }) {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return [
      `is ${document === null ? 'null' : Array.isArray(document) ? 'an array' : typeof document}, not a JSON object`
    ];
  }
  const problems = [];
  if (document.version !== 1) {
    problems.push(`names version ${JSON.stringify(document.version)}, not 1`);
  }
  const ceiling = document.ceiling;
  if (ceiling === null || typeof ceiling !== 'object' || Array.isArray(ceiling)) {
    problems.push('has no `ceiling` object');
  } else {
    if (!Number.isFinite(ceiling.wallSeconds) || ceiling.wallSeconds <= 0) {
      problems.push(
        `names ceiling.wallSeconds ${JSON.stringify(ceiling.wallSeconds)}, not a positive number of seconds — there is then no bar to compare against`
      );
    }
    if (!Number.isInteger(ceiling.maxWorkers) || ceiling.maxWorkers <= 0) {
      problems.push(
        `names ceiling.maxWorkers ${JSON.stringify(ceiling.maxWorkers)}, not a positive whole number of workers — the ceiling then cannot say at which concurrency it holds`
      );
    }
  }
  const recorded = document.population;
  if (recorded === null || typeof recorded !== 'object' || Array.isArray(recorded)) {
    problems.push('has no `population` object');
  } else {
    if (recorded.glob !== population) {
      problems.push(
        `names population.glob ${JSON.stringify(recorded.glob)}, but this ratchet measures ` +
          `${JSON.stringify(population)}`
      );
    }
    if (!Number.isInteger(recorded.files) || recorded.files <= 0) {
      problems.push(
        `names population.files ${JSON.stringify(recorded.files)}, not a positive whole number of files — the population is then pinned by name only, and a report holding a subset of it reads green`
      );
    }
  }
  const measured = document.measured;
  if (measured === null || typeof measured !== 'object' || Array.isArray(measured)) {
    problems.push('has no `measured` object');
  } else {
    if (!Number.isFinite(measured.wallSeconds) || measured.wallSeconds <= 0) {
      problems.push(
        `names measured.wallSeconds ${JSON.stringify(measured.wallSeconds)}, not a positive number of seconds`
      );
    }
    if (!Number.isInteger(measured.testFiles) || measured.testFiles <= 0) {
      problems.push(
        `names measured.testFiles ${JSON.stringify(measured.testFiles)}, not a positive whole number of files`
      );
    }
    if (!Number.isInteger(measured.testCases) || measured.testCases <= 0) {
      problems.push(
        `names measured.testCases ${JSON.stringify(measured.testCases)}, not a positive whole number of cases`
      );
    }
  }
  return problems;
}

/**
 * The decision table, as data. `measuredWallSeconds === wallSeconds` HOLDS (inclusive);
 * a measurement above the ceiling BREACHES. Both numbers and the margin are returned so
 * the caller renders them rather than recomputing them — a second subtraction at the
 * print site is a second answer waiting to disagree with this one.
 */
export function compare({ measuredWallSeconds, wallSeconds }) {
  const margin = round1(wallSeconds - measuredWallSeconds);
  const ok = measuredWallSeconds <= wallSeconds;
  return {
    ok,
    marginSeconds: margin,
    line: ok
      ? `HELD — the unit suite took ${measuredWallSeconds} s, at or under the ceiling ${wallSeconds} s (margin ${margin} s).`
      : `BREACHED — the unit suite took ${measuredWallSeconds} s, OVER the ceiling ${wallSeconds} s by ${round1(measuredWallSeconds - wallSeconds)} s.`
  };
}

/** What `--tighten` would write for a measured value: the steady state, not the measurement. */
export function tightenedCeiling(measuredWallSeconds) {
  return Math.ceil(measuredWallSeconds + CEILING_MARGIN_SECONDS);
}

/**
 * The artifact a `--tighten` run writes: the ceiling this measurement earned, and the
 * measurement it was earned from.
 *
 * PURE, so the runner holds no decision about what a tightened artifact looks like — the
 * runner does argv, the measurement and the file I/O, and nothing else. The `measured`
 * block is kept BESIDE the ceiling so that the margin between them is an inspectable fact
 * rather than a claim in prose, which is the reason `coverage-floor.json` records its own
 * `measuredPct` next to its `linesPct`.
 *
 * `maxWorkers` is passed IN rather than read from the environment here: a recorded report
 * carries no concurrency, so the runner decides whether the key is carried over or
 * re-seeded, and this function only writes what it is told.
 *
 * THE POPULATION FLOOR MOVES WITH THE MEASUREMENT, and that is the one thing a spread would
 * have got wrong. `population.files` is the TRUST FLOOR the subset-report guard is built on
 * (`unaccountedProblem`): a report holding fewer files than it is refused rather than read as
 * green. Left at the seed, that floor DEPRECIATES on its own — the suite grows from 629 files
 * to ~1200, and a report covering 700 of them still clears a floor of 629, so the one guard
 * against "a subset of the suite read as the suite" quietly stops guarding. The sibling gate
 * moves its row the same way (`.husky/coverage-ratchet.mjs` writes `files: report.files`), so
 * the floor is rewritten here from the measurement's OWN file count, and `population.glob`
 * and `population.source` are carried over untouched — only the count moved.
 */
export function tightenedArtifact(document, measurement) {
  return {
    ...document,
    ceiling: {
      wallSeconds: tightenedCeiling(measurement.wallSeconds),
      maxWorkers: measurement.maxWorkers
    },
    population: {
      ...document.population,
      files: measurement.testFiles
    },
    measured: {
      ...document.measured,
      wallSeconds: measurement.wallSeconds,
      testFiles: measurement.testFiles,
      testCases: measurement.testCases,
      measuredOn: measurement.measuredOn,
      measuredAt: measurement.measuredAt
    },
    generatedAt: measurement.measuredAt,
    command: measurement.command
  };
}

/**
 * Why `--tighten` refuses, or `null` when it may write. It refuses whenever the value it
 * would write is LOOSER than the ceiling already on disk, so the tool CANNOT relax the
 * bar — the whole point of a ceiling. Relaxing it is a hand edit, and therefore one
 * visible tracked line, which is the form a reviewer should interrogate.
 */
export function tightenRefusal({ measuredWallSeconds, wallSeconds }) {
  const next = tightenedCeiling(measuredWallSeconds);
  if (next <= wallSeconds) return null;
  return (
    `REFUSING to tighten: the measurement would write a ceiling of ${next} s, which is LOOSER ` +
    `than the ceiling already on disk (${wallSeconds} s). A ceiling may only fall, and this ` +
    'tool cannot make it rise. If the suite really did get slower, that is a finding about the ' +
    `suite — split the slow tests, or accept the slower tree by hand-editing ${CEILING_PATH} so ` +
    'that the relaxation is one visible line rather than a number a tool produced.'
  );
}

/**
 * Why the WORKING-COPY ceiling may not be compared at all, or `null` when it may.
 *
 * A hand edit can relax the ceiling and nothing else would notice: every arm of the test
 * battery derives from the value read off disk, so a ceiling quietly set to 7200 s passes
 * a 900 s measurement. `.husky/baseline/anchor.mjs` already solved this for the ceilings
 * artifact by reading the previous value out of git history, and this is the same mechanism
 * for the same reason.
 *
 * `head` is HEAD's parsed ceiling, or `null` when HEAD has none — the seed landing, which
 * is the one case where there is nothing to compare against and nothing to refuse.
 * `allowLoosen` is the explicit `--loosen` flag: a DELIBERATE relaxation is a named,
 * visible act rather than an invisible edit.
 *
 * REFUSES, it does not merely warn: a relaxed ceiling makes every verdict after it
 * meaningless, so there is nothing useful to print alongside one.
 */
export function looseningRefusal({ head, working, allowLoosen }) {
  if (head === null || allowLoosen === true) return null;
  const headWall = head?.ceiling?.wallSeconds;
  const workingWall = working?.ceiling?.wallSeconds;
  if (!Number.isFinite(headWall)) {
    return (
      `REFUSING to compare: HEAD's copy of ${CEILING_PATH} does not record a usable ` +
      'ceiling.wallSeconds, so this run cannot tell whether the working copy was relaxed. ' +
      'Refusing rather than guessing.'
    );
  }
  if (!Number.isFinite(workingWall)) return null;
  if (workingWall <= headWall) return null;
  return (
    `REFUSING to compare: the ceiling on disk is ${workingWall} s and HEAD records ${headWall} s. ` +
    'A ceiling may only fall, so this is either an unintended edit or a deliberate relaxation. ' +
    'If it is deliberate, say so explicitly with `--loosen` — the point is that relaxing is a ' +
    'named act a reviewer can see, not one nobody notices.'
  );
}

/**
 * Why the report does not ACCOUNT FOR the population, or `null` when it does.
 *
 * THE SUBSET HOLE THIS CLOSES. Without it, a report holding a strict SUBSET of the unit
 * suite — one file out of six hundred and twenty-nine — is timed, compared against the
 * ceiling, and read green. The gate would then be enforcing a number about a handful of
 * files while the suite it names went on growing. `population.files` is a TRUST FLOOR, not
 * a cap: a bigger population is fine (new files joined), a smaller one is a refusal.
 */
export function unaccountedProblem({ reportFiles, populationFiles, population }) {
  if (reportFiles >= populationFiles) return null;
  return (
    `REFUSING — the report accounts for ${reportFiles} file(s) under ${population}, and the ` +
    `ceiling records ${populationFiles}. A report holding a strict SUBSET of the population is ` +
    'not a measurement of it, and a wall clock over a shrunken population holds while the gate ' +
    `measures almost nothing. If the population really shrank, say so in a review of ${CEILING_PATH}.`
  );
}

/**
 * The worker count this run would measure at: the same decision `vitest.workers.ts` makes.
 *
 * A SECOND COPY of `parseOverride` there, for the reason in this file's header. The rules
 * are copied exactly, including the two that surprise: `'3.7'` is honoured as `3` (the
 * value is FLOORED, not rounded), and `'0.5'` is refused (the floor is 1 worker).
 *
 * Pinned by `tests/unit/lint/test-duration-ratchet.test.ts`, which imports the TypeScript
 * original and requires both to answer the same way for every environment value it tries.
 */
export function effectiveMaxWorkers(env) {
  const raw = env?.PEAKS_VITEST_MAX_WORKERS;
  if (raw === undefined || String(raw).trim() === '') return DEFAULT_MAX_WORKERS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_WORKERS;
  return Math.floor(parsed);
}

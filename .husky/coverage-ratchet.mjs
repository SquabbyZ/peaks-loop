#!/usr/bin/env node
/**
 * `.husky/coverage-ratchet.mjs` — the coverage FLOOR, enforced: measure `src/**`, compare the
 * measured line percentage against the floor recorded in `.peaks/lint/coverage-floor.json`,
 * and fail when coverage has dropped.
 *
 * THE DEFECT IT CLOSES. CI enforced no coverage floor at all, so coverage could regress
 * silently and nothing noticed. The repository's existing strict instrument,
 * `scripts/coverage-c8.mjs`, holds a 100% bar over the whole project; that bar is unreachable
 * today, so it is called by no workflow and measures nothing. A bar nothing can pass
 * certifies nothing — which is the same no-fake-green instinct that set it, read the other
 * way. This job is the reachable form: a floor that is MEASURED (never chosen), ENFORCED (a
 * blocking job), and MONOTONIC (it may only rise). `coverage-c8.mjs` is untouched and its
 * `--100` rule is not weakened — this gate is additive, and anyone who wants the strict bar
 * still has it.
 *
 * GREEN ON ARRIVAL, AND THAT IS THE POINT. The seeded floor is deliberately loose, because it
 * was measured on Windows while this job enforces on ubuntu and nobody has measured Linux
 * yet. A gate that is red the day it lands is the failure this slice exists to avoid:
 * `.husky/peaks-gate.mjs` says it plainly — "a gate that is dead on arrival is not a strict
 * gate, it is a gate people learn to bypass with `--no-verify`."
 *
 * THE FLOOR IS RAISED BY THIS SCRIPT, NEVER TYPED. `--raise` is the only writer: it takes the
 * measurement it just made, subtracts the margin, and writes both numbers into the artifact,
 * so the number a reviewer sees is one a tool produced. It REFUSES to write a value below the
 * floor already on disk, so the tool cannot lower the bar. Lowering is a hand edit, and
 * therefore one visible tracked line.
 *
 * SPLIT FOR TESTABILITY, IN THE PATTERN `.husky/monotonic/` EXISTS FOR. The decision table
 * (`.husky/coverage-ratchet/floor.mjs`) and the report reader
 * (`.husky/coverage-ratchet/report.mjs`) are pure modules, so a unit test can watch each of
 * them go red without paying for a coverage run. This file is the thin runner: argv, the
 * measurement, the file I/O, and the exit code.
 *
 * WHY THE MODULES ARE NOT UNDER A `.husky/coverage/` DIRECTORY, WHICH IS WHERE THEY STARTED.
 * `.gitignore` line 3 is a bare `coverage/`, and a bare trailing-slash pattern matches a
 * directory OF THAT NAME AT ANY DEPTH — so the two pure modules were silently UNTRACKED and
 * would have been absent on the runner, failing this job with ERR_MODULE_NOT_FOUND while
 * everything local stayed green. It is the same trap `.gitignore`'s own comments record three
 * times for other rules. The directory is anchored to `coverage-ratchet/`, which the rule does
 * not match; `git check-ignore` is the command that proves it.
 *
 * Exit codes: 0 pass, 1 the gate failed or the measurement could not be trusted, 2 usage or an
 * unreadable floor artifact. "0 findings" and "nothing checked" never share an output.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COUNTER,
  FLOOR_MARGIN_PP,
  FLOOR_PATH,
  compare,
  floorProblems,
  loweringRefusal,
  raiseRefusal,
  raisedFloor,
  round2,
  unaccountedProblem
} from './coverage-ratchet/floor.mjs';
import {
  POPULATION_GLOB,
  SUMMARY_PATH,
  measureArgs,
  readSummary
} from './coverage-ratchet/report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VITEST_BIN = resolve(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const USAGE = 'usage: coverage-ratchet.mjs [--report <path>] [--raise] [--lower-floor]';

/** Exit 2: the invocation or the artifact is wrong, so nothing was compared. */
function refuse(message) {
  console.error(`coverage-ratchet: ${message}`);
  process.exit(2);
}

/** Exit 1: the gate failed, or the run could not be measured. */
function fail(message) {
  console.error(`coverage-ratchet: ${message}`);
  process.exit(1);
}

/**
 * `--report <path>` skips the measurement and reads a report already on disk. It exists so the
 * trip can be DEMONSTRATED without a coverage run — against a recorded report, and by the
 * ratchet's own test — and it cannot weaken CI, which invokes this file with **no arguments at
 * all**. That is not a claim: `tests/unit/lint/coverage-ratchet-wiring.test.ts` matches the CI
 * job's `run:` value as a WHOLE, so any argument here is a red wiring test.
 *
 * `--raise` writes the floor. Nothing else does.
 *
 * `--lower-floor` is the one way a DELIBERATE lowering gets past the HEAD anchor, so that lowering
 * is a named act in the command rather than an edit nobody notices.
 */
function parseArgv(argv) {
  const options = { report: null, raise: false, lowerFloor: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--raise') options.raise = true;
    else if (arg === '--lower-floor') options.lowerFloor = true;
    else if (arg === '--report') {
      i += 1;
      if (argv[i] === undefined) refuse(`--report needs a path. ${USAGE}`);
      options.report = argv[i];
    } else refuse(`unknown argument ${JSON.stringify(arg)}. ${USAGE}`);
  }
  return options;
}

/**
 * HEAD's copy of the floor, or `null` when there is nothing to anchor against.
 *
 * A hand edit can lower the floor and nothing else would notice, because every arm of the test
 * battery derives from the value read off disk. `.husky/baseline/anchor.mjs` already solved this for
 * the ceilings artifact by reading the previous value out of git history, and this is the same
 * mechanism for the same reason.
 *
 * `null` has exactly TWO causes, and both are the absence of history rather than a failure to look:
 * no HEAD at all, or a HEAD that predates the floor (the commit that lands the seed). Anything else
 * is a REFUSAL, not a silent skip — including an unparseable HEAD copy, because there is no way to
 * tell a lowered floor from a corrupt one and guessing in that direction is the hole.
 */
function readHeadFloor() {
  const options = { cwd: ROOT, encoding: 'utf8', windowsHide: true };
  const hasHead = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], options);
  if (hasHead.status !== 0) return null;
  const run = spawnSync('git', ['show', `HEAD:${FLOOR_PATH}`], options);
  if (run.status !== 0) return null;
  try {
    return JSON.parse(run.stdout);
  } catch (err) {
    refuse(
      `HEAD's copy of ${FLOOR_PATH} is not parseable JSON (${String(err.message).split('\n')[0]}), ` +
        'so this run cannot tell whether the working copy was lowered. Refusing rather than guessing.'
    );
  }
}

/** The floor artifact, or a refusal: an unreadable floor is never a default. */
function loadFloor() {
  const path = resolve(ROOT, FLOOR_PATH);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    refuse(
      `cannot read the floor artifact ${FLOOR_PATH} (${err.code ?? err.message}). There is ` +
        'nothing to compare against, so this run refuses rather than passing.'
    );
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch (err) {
    refuse(
      `the floor artifact ${FLOOR_PATH} is not parseable JSON (${String(err.message).split('\n')[0]}).`
    );
  }
  const problems = floorProblems(document, { population: POPULATION_GLOB });
  if (problems.length > 0) refuse(`the floor artifact ${FLOOR_PATH} ${problems.join('; ')}.`);
  return { document, path };
}

/** Run the measurement. A run that did not finish has no coverage to compare. */
function measure() {
  if (!existsSync(VITEST_BIN)) {
    refuse(`the vitest entry is missing at ${VITEST_BIN}; run \`pnpm install\` first.`);
  }
  console.log(
    `coverage-ratchet: measuring ${POPULATION_GLOB} — the unit suite under coverage, which takes minutes.`
  );
  const run = spawnSync(process.execPath, [VITEST_BIN, ...measureArgs(ROOT)], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true
  });
  if (run.error !== undefined) refuse(`vitest could not be started: ${run.error.message}`);
  if (run.status !== 0) {
    fail(
      `REFUSING — the measuring command exited ${run.status ?? '?'}. A run that did not finish ` +
        'has no coverage to compare, and a partial report would be read as a drop. Fix the suite, then re-run.'
    );
  }
  return SUMMARY_PATH;
}

/** The report, or a refusal. Printed population first, so "0 measured" can never read as green. */
function loadReport(reportPath) {
  const absolute = resolve(ROOT, reportPath);
  if (!existsSync(absolute)) {
    console.log(
      `coverage-ratchet: population — 0 file(s) under ${POPULATION_GLOB} (counter: ${COUNTER}).`
    );
    fail(
      `REFUSING — there is no coverage report at ${reportPath}. Nothing was measured, so there ` +
        'is no verdict to give; an absent report is not a report of zero coverage.'
    );
  }
  const summary = readSummary(readFileSync(absolute, 'utf8'), { root: ROOT });
  console.log(
    `coverage-ratchet: population — ${summary.files} file(s) under ${POPULATION_GLOB} (counter: ${COUNTER}).`
  );
  if (summary.problem !== null) {
    for (const key of summary.foreign.slice(0, 5))
      console.error(`coverage-ratchet:   outside: ${key}`);
    fail(
      `REFUSING — the report at ${reportPath} ${summary.problem}. Fail-closed: a population ` +
        'that cannot be trusted is not a passing one.'
    );
  }
  return summary;
}

function main() {
  const options = parseArgv(process.argv.slice(2));
  const floor = loadFloor();

  // The anchor runs BEFORE the measurement, because a lowered floor makes every verdict after it
  // meaningless — there is nothing useful to print alongside one.
  const lowered = loweringRefusal({
    head: readHeadFloor(),
    working: floor.document,
    allowLower: options.lowerFloor
  });
  if (lowered !== null) fail(lowered);

  const report = loadReport(options.report ?? measure());

  // The population is pinned by SIZE as well as by name, and the check runs on the raise path too:
  // a subset report must not be able to move the floor either.
  const unaccounted = unaccountedProblem({
    rows: report.files,
    floorRows: floor.document.files,
    population: POPULATION_GLOB
  });
  if (unaccounted !== null) fail(unaccounted);

  if (options.raise) {
    const refusal = raiseRefusal({
      measuredPct: report.linesPct,
      linesPct: floor.document.linesPct
    });
    if (refusal !== null) fail(refusal);
    const now = new Date().toISOString();
    const fromReport = options.report === null;
    const next = {
      ...floor.document,
      linesPct: raisedFloor(report.linesPct),
      // The count has no measurement noise, so it is written exactly rather than with a margin.
      files: report.files,
      measuredPct: round2(report.linesPct),
      measuredOn: process.platform,
      measuredAt: now,
      generatedAt: now,
      // PROVENANCE IS PART OF THE ARTIFACT. A raise taken from a recorded report rather than from
      // this run's own measurement is visible in the tracked diff, so a reviewer reads it there
      // instead of having to trust the console.
      command: fromReport
        ? 'node .husky/coverage-ratchet.mjs'
        : `node .husky/coverage-ratchet.mjs --report ${options.report}`
    };
    writeFileSync(floor.path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    console.log(
      `coverage-ratchet: raised the floor ${floor.document.linesPct}% → ${next.linesPct}% and the ` +
        `row floor ${floor.document.files} → ${next.files} (measured ${round2(report.linesPct)}% on ` +
        `${next.measuredOn}, margin ${FLOOR_MARGIN_PP} pp, ${
          fromReport ? 'measured by this run' : `read from --report ${options.report}`
        }). Commit this diff with the slice that earned it.`
    );
    process.exit(0);
  }

  const verdict = compare({ measuredPct: report.linesPct, linesPct: floor.document.linesPct });
  console.log(`coverage-ratchet: ${verdict.line}`);
  if (verdict.ok) process.exit(0);
  console.error(
    '\nA coverage DROP fails this gate. The floor is monotonic: it may only be raised, by\n' +
      'running `node .husky/coverage-ratchet.mjs --raise` from a slice that added tests.\n' +
      `It is not lowered by this tool — lowering it is a hand edit to ${FLOOR_PATH}, and the\n` +
      'HEAD anchor plus `--lower-floor` are what make that edit a named act rather than a\n' +
      'silent one.\n'
  );
  process.exit(1);
}

main();

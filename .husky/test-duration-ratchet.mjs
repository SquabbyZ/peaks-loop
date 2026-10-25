#!/usr/bin/env node
/**
 * `.husky/test-duration-ratchet.mjs` — the unit suite's wall-clock CEILING, enforced:
 * measure the suite, compare the measured wall clock against the ceiling recorded in
 * `.peaks/lint/test-duration-ceiling.json`, and fail when the suite has got slower.
 *
 * THE DEFECT IT CLOSES. This repository carries fourteen `.husky/` gates — coverage floor,
 * lint baseline, file-size ceiling, format ratchet, silent-warning census — and NOT ONE of
 * them measured how long the unit suite takes or how many test files it has. Measured
 * 2026-10-25 (win32, 16 cores, vitest 4.1.10): the full suite took 854.74 s at 2 workers
 * (629 files, 6831 cases) and 489-534 s at 4; the file count grew ~+9.1 files a day since
 * 2026-08-05; and CI's `test` job carries `timeout-minutes: 60` while never having set
 * `PEAKS_VITEST_MAX_WORKERS`, so CI ran at 2 workers too. The growth was therefore SILENT: the
 * first signal was a job timeout, which reports a symptom with no cause attached.
 *
 * GREEN ON ARRIVAL, AND THAT IS THE POINT. The seeded ceiling is deliberately loose (2700 s),
 * because the seed was measured on Windows while this job enforces on ubuntu and nobody has
 * measured Linux yet. A gate that is red the day it lands is the failure this slice exists to
 * avoid: `.husky/peaks-gate.mjs` says it plainly — "a gate that is dead on arrival is not a
 * strict gate, it is a gate people learn to bypass with `--no-verify`". 45 minutes also sits
 * BELOW the 60-minute CI job ceiling, so this gate sounds first.
 *
 * THE CEILING IS TIGHTENED BY THIS SCRIPT, NEVER TYPED. `--tighten` is the only writer: it
 * takes the measurement it just made, adds the margin, and writes the result into the
 * artifact, so the number a reviewer sees is one a tool produced. It REFUSES to write a value
 * looser than the ceiling already on disk. Relaxing it is a hand edit — one visible line.
 *
 * SPLIT FOR TESTABILITY, IN THE PATTERN `.husky/coverage-ratchet/` EXISTS FOR. The decision
 * table and the report reader under `.husky/test-duration-ratchet/` are pure modules, so a
 * unit test can watch each go red without paying for a fourteen-minute suite run. This file
 * is the thin runner: argv, the measurement, the file I/O, and the exit code.
 *
 * Exit codes: 0 pass, 1 the gate failed or the measurement could not be trusted, 2 usage or an
 * unreadable ceiling artifact. "0 findings" and "nothing checked" never share an output.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CEILING_MARGIN_SECONDS,
  CEILING_PATH,
  POPULATION_GLOB,
  ceilingProblems,
  compare,
  effectiveMaxWorkers,
  looseningRefusal,
  tightenRefusal,
  tightenedArtifact,
  unaccountedProblem
} from './test-duration-ratchet/ceiling.mjs';
import { REPORT_PATH, measureArgs, readReport } from './test-duration-ratchet/report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VITEST_BIN = resolve(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const USAGE = 'usage: test-duration-ratchet.mjs [--report <path>] [--tighten] [--loosen]';

/** Exit 2: the invocation or the artifact is wrong, so nothing was compared. */
function refuse(message) {
  console.error(`test-duration-ratchet: ${message}`);
  process.exit(2);
}

/** Exit 1: the gate failed, or the run could not be measured. */
function fail(message) {
  console.error(`test-duration-ratchet: ${message}`);
  process.exit(1);
}

/**
 * `--report <path>` skips the measurement and reads a report already on disk. It exists so
 * the trip can be DEMONSTRATED without a fourteen-minute suite run, and it cannot weaken CI,
 * which invokes this file with **no arguments at all** — the wiring test matches the CI
 * job's `run:` value as a WHOLE, so any argument here is a red wiring test.
 *
 * `--tighten` writes the ceiling; nothing else does. `--loosen` is the one way a DELIBERATE
 * relaxation gets past the HEAD anchor, so that relaxing is a named act rather than an edit
 * nobody notices.
 */
function parseArgv(argv) {
  const options = { report: null, tighten: false, loosen: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tighten') options.tighten = true;
    else if (arg === '--loosen') options.loosen = true;
    else if (arg === '--report') {
      i += 1;
      if (argv[i] === undefined) refuse(`--report needs a path. ${USAGE}`);
      options.report = argv[i];
    } else refuse(`unknown argument ${JSON.stringify(arg)}. ${USAGE}`);
  }
  return options;
}

/**
 * HEAD's copy of the ceiling, or `null` when there is nothing to anchor against.
 *
 * A hand edit can relax the ceiling and nothing else would notice, because every arm of
 * the test battery derives from the value read off disk. `.husky/baseline/anchor.mjs`
 * already solved this for the ceilings artifact by reading the previous value out of git
 * history, and this is the same mechanism for the same reason.
 *
 * `null` has exactly TWO causes, both the absence of history rather than a failure to look:
 * no HEAD at all, or a HEAD that predates the artifact (the commit that lands the seed).
 * Anything else is a REFUSAL — including an unparseable HEAD copy, because there is no way
 * to tell a relaxed ceiling from a corrupt one and guessing in that direction is the hole.
 */
function readHeadCeiling() {
  const options = { cwd: ROOT, encoding: 'utf8', windowsHide: true };
  const hasHead = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], options);
  if (hasHead.status !== 0) return null;
  const run = spawnSync('git', ['show', `HEAD:${CEILING_PATH}`], options);
  if (run.status !== 0) return null;
  try {
    return JSON.parse(run.stdout);
  } catch (err) {
    refuse(
      `HEAD's copy of ${CEILING_PATH} is not parseable JSON (${String(err.message).split('\n')[0]}), ` +
        'so this run cannot tell whether the working copy was relaxed. Refusing rather than guessing.'
    );
  }
}

/** The ceiling artifact, or a refusal: an unreadable ceiling is never a default. */
function loadCeiling() {
  const path = resolve(ROOT, CEILING_PATH);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    refuse(
      `cannot read the ceiling artifact ${CEILING_PATH} (${err.code ?? err.message}). There is ` +
        'nothing to compare against, so this run refuses rather than passing.'
    );
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch (err) {
    refuse(
      `the ceiling artifact ${CEILING_PATH} is not parseable JSON (${String(err.message).split('\n')[0]}).`
    );
  }
  const problems = ceilingProblems(document, { population: POPULATION_GLOB });
  if (problems.length > 0) refuse(`the ceiling artifact ${CEILING_PATH} ${problems.join('; ')}.`);
  return { document, path };
}

/** Run the measurement. A run that did not finish has no duration to compare. */
function measure() {
  if (!existsSync(VITEST_BIN)) {
    refuse(`the vitest entry is missing at ${VITEST_BIN}; run \`pnpm install\` first.`);
  }
  const outputFile = resolve(ROOT, REPORT_PATH);
  console.log(`test-duration-ratchet: measuring ${POPULATION_GLOB} — the unit suite.`);
  mkdirSync(dirname(outputFile), { recursive: true });
  const run = spawnSync(process.execPath, [VITEST_BIN, ...measureArgs(outputFile)], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true
  });
  if (run.error !== undefined) refuse(`vitest could not be started: ${run.error.message}`);
  if (run.status !== 0) {
    fail(
      `REFUSING — the measuring command exited ${run.status ?? '?'}. A run that did not finish ` +
        'has no duration to compare, and a partial report would be read as a faster suite.'
    );
  }
  return outputFile;
}

/** The report, or a refusal. Printed population first, so "0 measured" can never read as green. */
function loadReport(reportPath) {
  const absolute = resolve(ROOT, reportPath);
  if (!existsSync(absolute)) {
    console.log(`test-duration-ratchet: population — 0 file(s) under ${POPULATION_GLOB}.`);
    fail(
      `REFUSING — there is no vitest JSON report at ${reportPath}. Nothing was measured, so there ` +
        'is no verdict to give; an absent report is not a report of a zero-second suite.'
    );
  }
  const report = readReport(readFileSync(absolute, 'utf8'), { root: ROOT });
  for (const key of report.foreign.slice(0, 5))
    console.error(`test-duration-ratchet:   outside ${POPULATION_GLOB}: ${key}`);
  if (report.problem !== null) {
    fail(
      `REFUSING — the report at ${reportPath} ${report.problem}. Fail-closed: a population that ` +
        'cannot be trusted is not a passing one.'
    );
  }
  return report;
}

function main() {
  const options = parseArgv(process.argv.slice(2));
  const ceiling = loadCeiling();

  // The anchor runs BEFORE the measurement, because a relaxed ceiling makes every verdict
  // after it meaningless — there is nothing useful to print alongside one.
  const loosened = looseningRefusal({
    head: readHeadCeiling(),
    working: ceiling.document,
    allowLoosen: options.loosen
  });
  if (loosened !== null) fail(loosened);

  const fresh = options.report === null;
  const workers = effectiveMaxWorkers(process.env);
  if (fresh) {
    // THE CONCURRENCY KEY. A wall clock is only comparable at one concurrency, so a fresh
    // measurement taken at a different one is refused rather than compared. `--tighten` is
    // the way out: it re-seeds the ceiling AT the concurrency it just measured.
    if (workers !== ceiling.document.ceiling.maxWorkers && !options.tighten) {
      fail(
        `REFUSING — the ceiling on disk was seeded at ${ceiling.document.ceiling.maxWorkers} ` +
          `worker(s) and this run would measure at ${workers}. A wall clock is only comparable at ` +
          'one concurrency: the same 629 files cost 1.357 s each at 2 workers and 0.776 s each at ' +
          '4, so a measurement taken at one concurrency cannot be compared against a ceiling seeded ' +
          'at the other — the bar would still be there, and it would mean nothing. Re-seed it at ' +
          'this concurrency with `--tighten`, or measure at the recorded one.'
      );
    }
  } else {
    console.log(
      'test-duration-ratchet: note — a recorded report carries no concurrency, so this ' +
        'comparison assumes the conditions under which it was recorded.'
    );
  }

  const report = loadReport(options.report ?? measure());
  // The population is pinned by SIZE as well as by name, and the check runs on the tighten
  // path too: a subset report must not be able to move the ceiling either.
  const measuredFiles = report.files - report.foreign.length;
  const unaccounted = unaccountedProblem({
    reportFiles: measuredFiles,
    populationFiles: ceiling.document.population.files,
    population: POPULATION_GLOB
  });
  if (unaccounted !== null) fail(unaccounted);

  const concurrency = fresh ? `${workers} worker(s)` : 'unknown (a recorded report carries none)';
  console.log(
    `test-duration-ratchet: population — ${measuredFiles} file(s) / ${report.testCases} case(s) ` +
      `under ${POPULATION_GLOB}; wall clock ${report.wallSeconds} s; concurrency ${concurrency}; ` +
      `measured on ${process.platform}.`
  );

  if (options.tighten) {
    const refusal = tightenRefusal({
      measuredWallSeconds: report.wallSeconds,
      wallSeconds: ceiling.document.ceiling.wallSeconds
    });
    if (refusal !== null) fail(refusal);
    const now = new Date().toISOString();
    const fromReport = options.report !== null;
    const next = tightenedArtifact(ceiling.document, {
      wallSeconds: report.wallSeconds,
      testFiles: measuredFiles,
      testCases: report.testCases,
      // A recorded report carries no concurrency, so the key is carried over unchanged.
      maxWorkers: fromReport ? ceiling.document.ceiling.maxWorkers : workers,
      measuredOn: process.platform,
      measuredAt: now,
      // PROVENANCE IS PART OF THE ARTIFACT. A tightening taken from a recorded report rather
      // than from this run's own measurement is visible in the tracked diff, so a reviewer
      // reads it there instead of having to trust the console.
      command: fromReport
        ? `node .husky/test-duration-ratchet.mjs --report ${options.report}`
        : 'node .husky/test-duration-ratchet.mjs'
    });
    writeFileSync(ceiling.path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    console.log(
      `test-duration-ratchet: tightened the ceiling ${ceiling.document.ceiling.wallSeconds} s → ` +
        `${next.ceiling.wallSeconds} s (measured ${report.wallSeconds} s, margin ` +
        `${CEILING_MARGIN_SECONDS} s, ${fromReport ? `read from --report ${options.report}` : 'measured by this run'}). ` +
        'Commit this diff with the slice that earned it.'
    );
    process.exit(0);
  }

  const verdict = compare({
    measuredWallSeconds: report.wallSeconds,
    wallSeconds: ceiling.document.ceiling.wallSeconds
  });
  console.log(`test-duration-ratchet: ${verdict.line}`);
  if (verdict.ok) process.exit(0);
  console.error(
    '\nA SLOWER unit suite fails this gate. The ceiling is monotonic: it may only fall, by\n' +
      'running `node .husky/test-duration-ratchet.mjs --tighten` from a slice that earned it.\n' +
      `It is not raised by this tool — raising it is a hand edit to ${CEILING_PATH}, and the HEAD\n` +
      'anchor plus `--loosen` are what make that edit a named act rather than a silent one.\n'
  );
  process.exit(1);
}

main();

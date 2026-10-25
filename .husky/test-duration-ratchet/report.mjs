/**
 * `.husky/test-duration-ratchet/report.mjs` — the vitest JSON REPORT: the command that
 * produces it, and the reader that decides whether it may be believed. PURE apart from
 * `readReport` taking text rather than a path, so a unit test can hand it a fixture
 * without a file or a measurement.
 *
 * THE REPORT IS VITEST 4's, AND ITS SHAPE IS MEASURED, NOT ASSUMED. The JSON reporter
 * writes `numTotalTestSuites`, `numPassedTestSuites`, `numFailedTestSuites`,
 * `numPendingTestSuites`, `numTotalTests`, `numPassedTests`, `numFailedTests`,
 * `numPendingTests`, `numTodoTests`, `snapshot`, `startTime`, `success` and `testResults`;
 * each entry of `testResults` carries `assertionResults`, `startTime`, `endTime`, `status`,
 * `message` and `name`. Read off a real run of this repository's unit suite, 2026-10-25.
 *
 * WHY THE WALL CLOCK IS `max(endTime) - startTime` AND NOT A SUM. The files run in
 * PARALLEL, so their durations overlap and a sum would measure CPU time rather than the
 * thing this gate is about — how long a developer waits. The top-level `startTime` is when
 * the reporter was initialised, and each file's `endTime` is when it finished, so the
 * span between the earliest start and the latest end IS the wall clock the suite cost.
 *
 * THE FILE NAMES ARE ABSOLUTE, AND THAT IS NOT COSMETIC. The reporter writes
 * `file.filepath`, which on this machine is `D:/projects/peaks-loop/tests/unit/...`. The
 * population check therefore has to strip the repository root before comparing, or every
 * path would look foreign on Windows and look native only by accident on a CI runner
 * whose checkout lives somewhere else entirely. Normalisation is by `path.relative`
 * against the root, so a relative name and an absolute one land on the same answer.
 *
 * FAIL CLOSED ON EVERY DEGENERATE REPORT: empty, unparseable, not an object, no
 * `testResults` array, no numeric `startTime`, no file at all, or no numeric test count.
 * A report that is missing or partial is not a report of zero duration, and "nothing was
 * measured" may never share an output with "the suite held".
 */

import { relative, resolve } from 'node:path';
import picomatch from 'picomatch';

import { POPULATION_GLOB } from './ceiling.mjs';

/** Where the measuring command writes its JSON report, repo-relative. */
export const REPORT_PATH = 'coverage/test-duration-report.json';

/** A path as `/`-separated, so a Windows-native row and a POSIX one compare the same. */
const posix = (path) => path.split('\\').join('/');

/**
 * The measuring command's arguments, after the vitest entry.
 *
 * `--outputFile.json=<path>` IS VITEST 4's per-reporter output spelling: the runner
 * resolves it through `getOutputFile(config, 'json')`, which reads `config.outputFile['json']`
 * — verified against this repository's vitest 4.1.10 and against a real run, not read off
 * a document. The root config's `include` is the `tests/unit` test-file glob, so `run` with
 * no path filter measures exactly the population this gate names, and nothing else.
 */
export function measureArgs(outputFile) {
  return ['run', '--reporter=json', `--outputFile.json=${outputFile}`];
}

/**
 * Read the report. Returns `{ problem, files, testCases, wallSeconds, foreign }`.
 *
 * `files` is ALWAYS A NUMBER — the count of file rows — so a caller can interpolate it
 * into a sentence. `wallSeconds` is null only on a refusal, where the count of rows the
 * report actually held is reported alongside the problem, so "nothing was measured" is
 * never said about a report that did measure something.
 *
 * `problem` is `null` only when the report is complete, parseable and timed; every other
 * shape names what was wrong. `foreign` carries the file rows outside the population, so
 * a caller can print them instead of saying "something was wrong somewhere".
 */
export function readReport(text, { root }) {
  const empty = { problem: null, files: 0, testCases: 0, wallSeconds: null, foreign: [] };
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
  const results = document.testResults;
  if (!Array.isArray(results)) {
    return { ...empty, problem: 'has no `testResults` array, so it is not a vitest JSON report' };
  }
  if (!Number.isFinite(document.startTime)) {
    return {
      ...empty,
      files: results.length,
      problem: 'has no numeric `startTime`, so the run it describes cannot be timed'
    };
  }
  if (!Number.isFinite(document.numTotalTests)) {
    return {
      ...empty,
      files: results.length,
      problem: 'has no numeric `numTotalTests`, so the case count it reports cannot be read'
    };
  }
  if (results.length === 0) {
    return { ...empty, problem: 'lists no test file, so nothing was measured' };
  }
  let endTime = null;
  for (const entry of results) {
    const value = entry?.endTime;
    if (!Number.isFinite(value)) continue;
    if (endTime === null || value > endTime) endTime = value;
  }
  if (endTime === null) {
    return {
      ...empty,
      files: results.length,
      problem: 'records no numeric `endTime`, so the run it describes cannot be timed'
    };
  }
  const matches = picomatch(POPULATION_GLOB);
  const foreign = [];
  for (const entry of results) {
    const name = typeof entry?.name === 'string' ? entry.name : '';
    const relativeName = posix(relative(root, resolve(root, name)));
    if (!matches(relativeName)) foreign.push(name);
  }
  return {
    problem: null,
    files: results.length,
    testCases: document.numTotalTests,
    wallSeconds: Math.round(((endTime - document.startTime) / 1000) * 10) / 10,
    foreign
  };
}

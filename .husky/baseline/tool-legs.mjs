/**
 * `.husky/baseline/tool-legs.mjs` — the two repository tools whose numbers the
 * artifact ratchets: tsc and the silent-warning detector (rid
 * `2026-10-02-wave9-generator-split`, HEAD lines 460–473 wrapped as
 * `measureTscErrors()` and 475–539 as the silent-warning block; rid
 * `2026-10-03-silent-warning-scope` replaced that block's spawn with the shared
 * measurement path in `.husky/peaks-gate-silent-warning.mjs`, which the gate's own
 * leg runs too).
 *
 * `measureSilentWarnings` is gone, and so is the second near-copy of it in
 * `.husky/gate/legs.mjs`: the leg that ENFORCES the two rows and the generator that
 * SEEDS them now run one spawn, over one list, with one refusal. Two spellings of
 * "which files was this number counted over" is what let 905 and 943 share a screen
 * without either of them being an error (§2.43).
 */
import { execFileSync } from 'node:child_process';

import { describeSilentWarningRun, runSilentWarningScan } from '../peaks-gate-silent-warning.mjs';
import {
  describeCommentHygieneRun,
  runCommentHygieneScan
} from '../peaks-gate-comment-hygiene.mjs';

import { ROOT, refuse } from './paths.mjs';

/** The count of `error TS…` lines, printed exactly as HEAD printed it. */
export function measureTscErrors() {
  // ---- tsc -------------------------------------------------------------------
  console.error('running tsc...');
  let tscErrors = 0;
  try {
    execFileSync('node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--noEmit'], {
      cwd: ROOT,
      encoding: 'utf8'
    });
  } catch (err) {
    tscErrors = `${err.stdout ?? ''}${err.stderr ?? ''}`
      .split('\n')
      .filter((l) => /error TS\d+/.test(l)).length;
  }
  console.error(`tsc: ${tscErrors} errors`);
  return tscErrors;
}

/**
 * Run the detector over the ENFORCED scope and return its two counts plus the
 * population they were counted over.
 *
 * `scope` here is `measureScope()`'s `gated` list — `git ls-files` filtered by the
 * published rule, the same array `buildFileRecords` writes rows for and the same
 * array the eslint and prettier legs iterate. It used to be the whole measurement
 * universe, and the leg ignored it either way: the detector walked `src/`, reported
 * 905 files, and every other row on the screen came from 943. The 38 files in
 * between were `packages/<name>/src`, and they held 17 swallows nothing counted.
 *
 * FAIL-CLOSED, and the population equality is part of the fail-closed set: a
 * detector that cannot run, that scanned nothing, or that scanned a different
 * number of files than the scope names aborts the run BEFORE anything is written.
 * Writing a zero would seed a ceiling of zero for a number that was never measured;
 * writing a count measured over a smaller population would seed a ceiling that
 * quietly exempts `packages/<name>/src` again. Grace-marked sites (`// TODO(g2):`) are
 * subtracted by the detector itself — that suppression is its behaviour, this leg
 * keeps it, and this slice used neither it nor the marker.
 */
/**
 * Run the comment-hygiene detector over the ENFORCED SCOPE and return its two totals
 * plus the population they were counted over.
 *
 * Same fail-closed posture as the silent-warning leg: a detector that cannot run, or
 * that counted a different number of files than the scope names, aborts the run BEFORE
 * anything is written. A zero would seed a ceiling of zero for a number nobody
 * measured, and a count over a smaller population would seed a ceiling that quietly
 * exempts the rest of `src` again.
 */
export function measureCommentHygieneLeg({ scope }) {
  console.error('running the comment-hygiene detector...');
  const m = runCommentHygieneScan(scope, ROOT);
  if (m.failure !== null) {
    refuse(
      `the comment-hygiene leg ${m.failure} — the two rows would be seeded from a number ` +
        'this run did not measure over the enforced scope'
    );
  }
  console.error(
    describeCommentHygieneRun({
      deadReferences: m.deadReferences,
      narrative: m.narrative,
      scanned: m.scannedFiles
    })
  );
  return m;
}

export function measureSilentWarningLeg({ scope }) {
  console.error('running the silent-warning detector...');
  const m = runSilentWarningScan(scope, ROOT);
  if (m.failure !== null) {
    refuse(
      `the silent-warning leg ${m.failure} — the two rows would be seeded from a number ` +
        'this run did not measure over the enforced scope'
    );
  }
  console.error(
    describeSilentWarningRun({
      returnNull: m.counts['catch-return-null'],
      emptyCatch: m.counts['empty-catch'],
      scanned: m.scannedFiles
    })
  );
  return {
    scannedFiles: m.scannedFiles,
    askedFiles: m.askedFiles,
    catchReturnNull: m.counts['catch-return-null'],
    emptyCatch: m.counts['empty-catch']
  };
}

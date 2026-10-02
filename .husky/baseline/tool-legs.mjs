/**
 * `.husky/baseline/tool-legs.mjs` — the two repository tools whose numbers the
 * artifact ratchets: tsc and the silent-warning detector (rid
 * `2026-10-02-wave9-generator-split`, HEAD lines 460–473 wrapped as
 * `measureTscErrors()`, 475–525 verbatim, 527–539 wrapped as
 * `measureSilentWarningLeg({ scope })`).
 *
 * `measureSilentWarnings` keeps its own name and body: it was already a
 * declaration, so it moved as a whole. Only its CALLER needed a wrapper, and it
 * still refuses before anything is written when the detector cannot run.
 */
import { execFileSync } from 'node:child_process';

import { OUT_PATH, ROOT, rel } from './paths.mjs';

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
// ---- silent-warning detector -----------------------------------------------
// The two catch-swallow counts, read off the repo's own AST reporter with
// `--json` — exactly how `phantomRules` is read off eslint's messages above.
// Never a literal: 41 and 59 are what this run's tool reported, and a hardcoded
// pair would freeze the ceiling in place of the number.
//
// UNTIL SLICE a3 this detector was referenced by nothing on a gate path (only
// `package.json#test:ci`, which no workflow calls), so a leg that was red on
// arrival could also grow without anyone seeing it.
//
// ITS SCOPE IS ITS OWN: a walk of `src/` (781 files measured 2026-09-29), NOT
// the `scope` list this generator builds from `git ls-files` (1298). The numbers
// are recorded as the detector reports them; retargeting it is a different
// slice. Grace-marked sites (`// TODO(g2):`) are already subtracted by the
// detector itself — that suppression is its behaviour, and this leg keeps it.
//
// FAIL-CLOSED like the prettier-config guard below: a detector that cannot run,
// or that scanned nothing, aborts the run BEFORE anything is written. Writing a
// zero here would seed a ceiling of zero for a number that was never measured.
const SW_DETECTOR = 'scripts/lint/silent-warning-detector.mjs';

function measureSilentWarnings() {
  let raw = '';
  try {
    raw = execFileSync('node', [SW_DETECTOR, '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024
    });
  } catch (err) {
    raw = err.stdout ?? ''; // exit 1 means violations were found; the envelope is still on stdout
  }
  let env;
  try {
    env = JSON.parse(raw);
  } catch {
    return { failure: `${SW_DETECTOR} --json produced no parseable envelope` };
  }
  if (!Number.isInteger(env.scannedFiles) || env.scannedFiles <= 0) {
    return { failure: `${SW_DETECTOR} scanned 0 files, so it measured nothing` };
  }
  if (typeof env.byRule !== 'object' || env.byRule === null) {
    return { failure: `${SW_DETECTOR} produced an envelope with no byRule object` };
  }
  return {
    failure: null,
    scannedFiles: env.scannedFiles,
    catchReturnNull: env.byRule['catch-return-null'] ?? 0,
    emptyCatch: env.byRule['empty-catch'] ?? 0
  };
}

/** Run the detector, refuse on a run that measured nothing, return its two counts. */
export function measureSilentWarningLeg({ scope }) {
  console.error('running the silent-warning detector...');
  const sw = measureSilentWarnings();
  if (sw.failure !== null) {
    console.error(
      `\nREFUSING to write ${rel(OUT_PATH)}: ${sw.failure}.\n` +
        '  Nothing has been written; the existing ceilings are untouched.\n'
    );
    process.exit(1);
  }
  console.error(
    `silent-warning: catch-return-null=${sw.catchReturnNull}, empty-catch=${sw.emptyCatch} ` +
      `(detector scanned ${sw.scannedFiles} of its own \`src/\` files, not the ${scope.length} above)`
  );
  return sw;
}

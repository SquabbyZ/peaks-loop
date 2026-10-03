// The census spawn (`measureFileSizeOverCap`), its hooks-envelope validation
// (`hooksEnvelopeProblem`) and the named-subset refusal (`refuseScopedSubset`).
// `execFileSync` is the one import HEAD's file carried; `hooksEnvelopeProblem` is
// called by `measureFileSizeOverCap` inside this module. Bodies moved verbatim
// from `.husky/peaks-gate-file-size.mjs` (rid `2026-10-02-wave9-file-size-split`).

import { execFileSync } from 'node:child_process';
import { FS_CENSUS, FS_CEILING_KEY, FS_HOOKS_CEILING_KEY, TSX_CLI } from './constants.mjs';
import { censusFilesProblem, partitionCensusOverCap } from './partition.mjs';

/**
 * Why a census envelope's `hooks` block may not be believed, or `null` when it may.
 *
 * The same fail-closed posture as `missingFileSizeCeilings`, one layer up: the two
 * hooks rows share the main census run, so an envelope that stopped reporting the
 * second scope has not measured it. `overCap: 0` is exactly what "the `.husky/` debt
 * is cleared" looks like, and it is also what a census that never counted the scope
 * looks like — the distinction is the entire content of the row.
 *
 * A `countedFiles` of 0 is NOT a trip here, unlike the main scope: a `.husky` with no
 * policy-extension files is a measured zero. What makes it trustworthy is upstream —
 * `scripts/lint/file-size-census-hooks.ts` crashes rather than enumerating a hooks
 * directory that is gone, so a run that reports 0 counted files did look at the
 * directory and found nothing in it.
 */
export function hooksEnvelopeProblem(hooks) {
  if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) {
    return `produced no \`hooks\` block, so the ${FS_HOOKS_CEILING_KEY} row would be a number nobody measured`;
  }
  if (!Number.isInteger(hooks.overCap) || hooks.overCap < 0) {
    return 'produced a hooks block with no non-negative integer overCap';
  }
  if (!Number.isInteger(hooks.excessLines) || hooks.excessLines < 0) {
    return 'produced a hooks block with no non-negative integer excessLines';
  }
  if (!Number.isInteger(hooks.scope?.countedFiles) || hooks.scope.countedFiles < 0) {
    return 'produced a hooks block whose countedFiles is not a non-negative integer';
  }
  if (!Number.isInteger(hooks.caps?.hooksCap) || hooks.caps.hooksCap <= 0) {
    return 'produced a hooks block with no usable hooksCap to bind its ceiling to';
  }
  if (typeof hooks.convention !== 'string' || hooks.convention === '') {
    return 'produced a hooks block that does not name the line convention it counted in';
  }
  return null;
}

/**
 * The census envelope, or why this leg may not be believed.
 *
 * `files` narrows the count for a control arm (the same posture as
 * `measureSilentWarnings`); an empty list asks the census for its own scope:
 * `git ls-files` over the policy's four directories. `cwd` is the repo root each
 * caller already resolves for itself — the census paths are repo-relative.
 *
 * FAIL-CLOSED on every path: a census that cannot run, that produced no parseable
 * envelope, that reported no integer count, or that counted nothing, returns a
 * `failure` — it never returns `overCap: 0`, because 0 is what "the whole tree is
 * under the cap" looks like, and telling those two states apart is the entire
 * reason the row exists.
 */
export function measureFileSizeOverCap(files = [], cwd = process.cwd()) {
  let raw = '';
  try {
    raw = execFileSync('node', [TSX_CLI, FS_CENSUS, '--json', ...files], {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (err) {
    // Exit 1 means the census FOUND over-cap files; the envelope is still on
    // stdout — the same shape as eslint's report and the detector's.
    raw = err.stdout ?? '';
  }
  const refuse = (why) => ({ failure: why, env: null, partition: null });
  let env;
  try {
    env = JSON.parse(raw);
  } catch {
    return refuse(`${FS_CENSUS} --json produced no parseable envelope`);
  }
  if (!Number.isInteger(env.overCap) || env.overCap < 0) {
    return refuse(`${FS_CENSUS} produced an envelope with no integer overCap`);
  }
  if (!Number.isInteger(env.excessLines) || env.excessLines < 0) {
    // The same trip, one row down: `0` is also what "nothing is over cap" looks
    // like, so an envelope without the sum cannot seed or check `fileSizeExcessLines`.
    return refuse(`${FS_CENSUS} produced an envelope with no integer excessLines`);
  }
  if (!Number.isInteger(env.scope?.countedFiles) || env.scope.countedFiles <= 0) {
    return refuse(`${FS_CENSUS} counted 0 files, so it measured nothing`);
  }
  // THE SECOND SCOPE TRIPS THE SAME WAY. One census run feeds four rows, so a
  // hooks block that is missing or malformed is not a reason to print the main pair
  // and skip the rest — it is a reason to print nothing (`§2.32`).
  const hooksProblem = hooksEnvelopeProblem(env.hooks);
  if (hooksProblem !== null) return refuse(`${FS_CENSUS} ${hooksProblem}`);
  // THE LINT-SCOPE PARTITION (rid `2026-10-03-w10-rescope-a`): the gated rows and
  // the shadow note are cut from the envelope's own per-file list, so the list must
  // exist and must add up to the totals it is cut against. An envelope that cannot
  // be partitioned is not a partition of zero.
  const filesProblem = censusFilesProblem(env);
  if (filesProblem !== null) return refuse(`${FS_CENSUS} ${filesProblem}`);
  return { failure: null, env, partition: partitionCensusOverCap(env) };
}

/**
 * The refusal for a caller that handed the leg a named-file subset without saying
 * so, or `null` when the leg may speak for `ceilings.fileSizeOverCap`.
 *
 * WHY (F1, reproduced 2026-09-30): `node .husky/peaks-gate.mjs file-size
 * src/one-file.ts` printed `✓ file-size over cap 0 (ceiling 174) … file-size
 * ceiling held` and exited 0. A named-file run cannot contain an over-cap file the
 * whole-tree row does not already count, so its `0` is not a held ceiling — it is
 * the absence of a measurement wearing the row's label. The leg refuses it. A test
 * that genuinely means to hand the leg a subset says so with `--control-arm`, and
 * the leg then reports exactly what it measured: the count OF THE NAMED FILES,
 * labelled as a control arm, with the repo row explicitly disclaimed.
 */
export function refuseScopedSubset({ controlArm, files }) {
  if (files.length === 0 || controlArm) return null;
  return (
    `REFUSING to report the ${FS_CEILING_KEY} row — ${files.length} named file(s) are a ` +
    'subset, and a subset cannot fail a whole-tree row: it can only ever report fewer over-cap ' +
    'files than the census scope contains. A held ceiling here would be a green the row was ' +
    'never measured against.\n' +
    `  Run \`node .husky/peaks-gate.mjs file-size\` with no paths to measure ${FS_CEILING_KEY}, ` +
    'or pass `--control-arm` to test the leg on a subset deliberately.'
  );
}

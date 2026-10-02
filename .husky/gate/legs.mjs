// .husky/gate/legs.mjs
// The two legs that read a whole-tree measurement and print it through `check`:
// the silent-warning pair (detector) and the file-size quartet (census). Hoisted
// VERBATIM out of `.husky/peaks-gate.mjs` by rid `2026-10-02-wave9-gate-entry-split`.
// The census measurement path is NOT here — it lives in
// `.husky/peaks-gate-file-size.mjs`, which this module imports with the same
// repo-root-anchored specifier the entry used.

import { execFileSync } from 'node:child_process';
import { ROOT, baseline } from './context.mjs';
import {
  FS_CEILING_KEY,
  FS_CENSUS,
  FS_EXCESS_CEILING_KEY,
  FS_EXCESS_ROW_LABEL,
  FS_HOOKS_CEILING_KEY,
  FS_HOOKS_EXCESS_CEILING_KEY,
  FS_HOOKS_EXCESS_ROW_LABEL,
  FS_HOOKS_ROW_LABEL,
  FS_ROW_LABEL,
  TSX_CLI,
  describeInputTrips,
  fileSizeInputTrips,
  measureFileSizeOverCap,
  missingFileSizeCeilings,
  refuseScopedSubset
} from '../../.husky/peaks-gate-file-size.mjs';

// ---------------------------------------------------------------------------
// silent-warning legs — read off the detector, never hardcoded
// ---------------------------------------------------------------------------
// `scripts/lint/silent-warning-detector.mjs` has reported `catch-return-null`
// and `empty-catch` since slice A.2, but until slice a3 NOTHING on a gate path
// read its numbers: the detector was referenced only by `package.json#test:ci`,
// and no workflow calls `test:ci`. A leg that is red on arrival and ungated can
// grow in silence, so the two counts join the ratchet as ceiling lines that may
// only go DOWN.
//
// MEASURED, not typed in — the same rule the regenerator follows for
// `phantomRules`: the number comes off the tool in this run. The tool runs as a
// child process with `--json`, so what this gate reports is exactly what
// `pnpm test:ci` would have reported, grace markers (`// TODO(g2):`) subtracted
// by the detector itself.
//
// FAIL-CLOSED, like `notLinted` and the `REFUSING to measure` prettier branch:
// a detector that cannot run, or that scanned nothing, ABORTS the gate. It is
// never read as a zero, because a zero is what "no swallows found" looks like —
// and the only reason to have this leg is to tell those two states apart.
const SW_DETECTOR = 'scripts/lint/silent-warning-detector.mjs';

/** [detector rule, baseline ceiling key, table label] */
const SW_RULES = [
  ['catch-return-null', 'silentWarningCatchReturnNull', 'silent-warn return-null'],
  ['empty-catch', 'silentWarningEmptyCatch', 'silent-warn empty-catch']
];

/**
 * `files` narrows the scan for a control arm of the unit test. An empty list
 * asks the detector for its OWN default scope — a walk of `src/`, 781 files
 * measured 2026-09-29 — which is NOT this gate's `git ls-files` set (1298).
 * The divergence is recorded, not reconciled: retargeting the detector is a
 * different slice.
 */
function measureSilentWarnings(files = []) {
  let raw = '';
  try {
    raw = execFileSync('node', [SW_DETECTOR, '--json', ...files], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024
    });
  } catch (err) {
    // The detector exits 1 whenever it finds a violation; the envelope is still
    // on stdout — the same shape as eslint's report above.
    raw = err.stdout ?? '';
  }
  const refuse = (why) => ({ failure: why, scannedFiles: 0, counts: {} });
  let env;
  try {
    env = JSON.parse(raw);
  } catch {
    return refuse(`${SW_DETECTOR} --json produced no parseable envelope`);
  }
  if (!Number.isInteger(env.scannedFiles) || env.scannedFiles <= 0) {
    return refuse(`${SW_DETECTOR} scanned 0 files, so it measured nothing`);
  }
  if (typeof env.byRule !== 'object' || env.byRule === null) {
    return refuse(`${SW_DETECTOR} produced an envelope with no byRule object`);
  }
  const counts = {};
  for (const [rule] of SW_RULES) counts[rule] = env.byRule[rule] ?? 0;
  return { failure: null, scannedFiles: env.scannedFiles, counts };
}

/**
 * Print the two rows through `check`. Returns `{ refusal, scannedFiles }`: a
 * non-null `refusal` means the caller must fail the run — a leg that could not
 * be measured contributes no row, let alone a zero.
 */
function silentWarningLeg(check, ceilings, files) {
  const m = measureSilentWarnings(files);
  if (m.failure !== null) {
    return {
      refusal:
        `REFUSING to measure the silent-warning legs — ${m.failure}.\n` +
        `  A detector that cannot run is a gate FAILURE, not a zero. Run \`node ${SW_DETECTOR}\` to see why.`,
      scannedFiles: 0
    };
  }
  const missing = SW_RULES.map(([, key]) => key).filter((k) => !Number.isInteger(ceilings[k]));
  if (missing.length > 0) {
    return {
      refusal:
        `REFUSING to measure the silent-warning legs — the baseline has no ceiling for ` +
        `${missing.join(', ')}.\n` +
        '  Regenerate it: node .husky/peaks-gate-baseline.mjs',
      scannedFiles: m.scannedFiles
    };
  }
  for (const [rule, key, label] of SW_RULES) check(label, m.counts[rule], ceilings[key]);
  return { refusal: null, scannedFiles: m.scannedFiles };
}
// ---------------------------------------------------------------------------
// file-size legs — the whole-tree count over the policy cap, and the lines over it
// ---------------------------------------------------------------------------
// THE POLICY ITSELF lives in `src/services/scan/file-size-policy.ts`: 300 raw
// lines for `src/`, `packages/` and `scripts/`, 500 for the root `tests/` tree,
// a line counted as `split('\n').length`. Until this slice the policy was
// written twice in two units (eslint `max-lines: 400` effective, and a
// `DEFAULT_FILE_SIZE_THRESHOLD = 800` raw in the scan) and ratcheted ZERO times:
// the only file-size number the gate watched was `eslintFindings`, which counts
// a DIFFERENT population — 98 `max-lines` findings under 400-effective, not the
// 174 files over the decided 300/500. A row keyed on the wrong population makes
// the gate vouch for a number it never measured, the failure 3db079d3 and
// ebee68ce just fixed in the build guard. So the count gets its own line.
//
// MEASURED, not typed in. This gate is plain `.mjs` and cannot import a `.ts`
// policy module, so it spawns `scripts/lint/file-size-census.ts` — the one
// thing that does import it — through tsx, and reads `overCap` off the
// envelope. `.husky/peaks-gate-baseline.mjs` spawns the same census to SEED the
// ceiling, which is why the seeded number cannot be a transcription error.
//
// FAIL-CLOSED, exactly like the silent-warning legs above: a census that cannot
// run, that counted nothing, or that is no longer measuring the policy the ceiling
// was seeded under, ABORTS the leg with exit 1. It is never read as a zero — a zero
// is what "every file is under the cap" looks like, and the whole point of the row
// is to tell those two states apart.
//
// THE MEASUREMENT PATH IS SHARED (F5). `measureFileSizeOverCap` and its refusal
// conditions used to be duplicated here and in `.husky/peaks-gate-baseline.mjs`,
// already drifted on one option; they live in `.husky/peaks-gate-file-size.mjs`,
// which this file and the generator both import.

/**
 * The row, through `check`. Returns `{ refusal, ... }`: a non-null `refusal` means
 * the caller must fail the run — a leg that could not be measured contributes no
 * row, let alone a zero.
 *
 * Two refusals the slice did not have before the repair cycle:
 *   F1 — a named-file subset that did not opt into `--control-arm`. One existing
 *        file cannot contain an over-cap file the whole-tree row does not already
 *        count, so printing `✓ … 0 (ceiling 174) … ceiling held` for it vouched
 *        for a measurement that had not been made.
 *   F2 — the census's policy inputs (caps, scope dirs, extensions, line
 *        convention) are not the ones recorded under the ceiling. Re-deciding the
 *        cap moved the number the row ratchets and stayed green; the row now
 *        refuses to compare against a ceiling produced by a different policy.
 */
function fileSizeLeg(check, ceilings, files, controlArm = false) {
  const subset = refuseScopedSubset({ controlArm, files });
  if (subset !== null) return { refusal: subset, envelope: null, controlArm };
  const m = measureFileSizeOverCap(files, ROOT);
  if (m.failure !== null) {
    return {
      refusal:
        `REFUSING to measure the file-size leg — ${m.failure}.\n` +
        `  A census that cannot run is a gate FAILURE, not a zero. Run \`node ${TSX_CLI} ${FS_CENSUS}\` to see why.`,
      envelope: null,
      controlArm
    };
  }
  const missingCeiling = missingFileSizeCeilings(ceilings);
  if (missingCeiling !== null) {
    return { refusal: missingCeiling, envelope: m.env, controlArm };
  }
  const trips = fileSizeInputTrips(m.env, baseline);
  if (trips.length > 0) {
    return { refusal: describeInputTrips(trips), envelope: m.env, controlArm };
  }
  // TWO ROWS, ONE CENSUS (rid `2026-10-01-file-size-excess-row`). `fileSizeOverCap`
  // counts the files over the cap; `fileSizeExcessLines` counts the lines over it —
  // the figure wave 6 moved by +67 while the file count held at 166. Both read the
  // same envelope, so every refusal above applies to both, and neither can print a
  // number the census did not produce.
  check(FS_ROW_LABEL, m.env.overCap, ceilings[FS_CEILING_KEY]);
  check(FS_EXCESS_ROW_LABEL, m.env.excessLines, ceilings[FS_EXCESS_CEILING_KEY]);
  // THE SAME TWO QUANTITIES FOR THE SECOND SCOPE (rid `2026-10-02-hooks-size-rows`,
  // backlog §2.32): `.husky/`, the directory the ratchet lives in, measured from the
  // SAME census run as its own `hooks` block. Four rows, one census — which is why a
  // census that cannot run, a ceiling that was never seeded, or a policy that moved
  // under the ceiling takes all four down rather than printing the two that still fit.
  check(FS_HOOKS_ROW_LABEL, m.env.hooks.overCap, ceilings[FS_HOOKS_CEILING_KEY]);
  check(FS_HOOKS_EXCESS_ROW_LABEL, m.env.hooks.excessLines, ceilings[FS_HOOKS_EXCESS_CEILING_KEY]);
  return { refusal: null, envelope: m.env, controlArm };
}

export { silentWarningLeg, fileSizeLeg, measureSilentWarnings };

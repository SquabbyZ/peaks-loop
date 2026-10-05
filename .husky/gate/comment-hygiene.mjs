// .husky/gate/comment-hygiene.mjs
//
// The comment-debt leg and its standalone mode, in one file of their own.
//
// They moved here because `.husky/**` carries its own 300-line cap (`fileSizeHooksOverCap`
// and `fileSizeHooksExcessLines`, rid `2026-10-02-hooks-size-rows`) and adding the leg to
// `legs.mjs` pushed that file past it — 269 lines to ~325. A guard whose own home crosses
// the cap it ratchets is exactly the §2.32 invisibility the two hooks rows were filed for,
// so the bodies moved rather than the cap. The layout follows `.husky/file-size/`, which
// split for the same reason one wave earlier.
//
// WHAT DID NOT MOVE: the measurement path stays in `.husky/peaks-gate-comment-hygiene.mjs`
// (the one module the gate leg and the ceiling generator both call), and `repoMode` and the
// entry import THIS file, so the leg runs identically in both modes.

import { ROOT, baseline, makeCheck, rel } from './context.mjs';
import { lintFileList } from '../../scripts/lint/lint-file-list.mjs';
import { TSX_CLI } from '../peaks-gate-file-size.mjs';
import {
  CH_CEILING_KEYS,
  CH_DETECTOR,
  CH_RULES,
  describeCommentHygieneRun,
  runCommentHygieneScan
} from '../peaks-gate-comment-hygiene.mjs';

// ---------------------------------------------------------------------------
// comment-hygiene mode — the two comment rows, without eslint / prettier / tsc
// ---------------------------------------------------------------------------
// Same reason `silent-warning` mode exists: a unit test has to hand the leg ONE file
// carrying `ceiling + 1` findings and watch the run go red (`tests/unit/lint/
// comment-hygiene-gate-leg.test.ts`). `repo` mode is the enforcement surface, and a mode
// that cannot be handed a file cannot be proved to fail — which is how a guard starts
// reporting clean because it stopped being able to see. A named-file run therefore
// disclaims itself out loud: the ceilings are whole-scope numbers.

/**
 * The two comment rows, through the shared measurement path.
 *
 * A missing ceiling is a REFUSAL, not a skip: `.husky/monotonic/keys.mjs` may name a
 * row the published artifact never carries — a fresh key, or a generator run nobody
 * made — and `check(label, n, undefined)` would compare against nothing and report
 * clean. That is the invisibility this gate family exists to refuse.
 *
 * The population is the enforced scope the leg is HANDED, never a walk of its own:
 * `peaks comments audit` now walks the same rule (`src` plus every
 * `packages/<anything>/src`, since the day its list of names was found to be a second,
 * narrower spelling of it — 14 gated rows lived in the packages it did not read), but it
 * walks the DISK while the ratchet
 * reads `git ls-files`. A row is still measured only over the tracked list, so an
 * untracked scratch file can never move a ceiling nobody edited
 * (rid `2026-10-03-silent-warning-scope`).
 */
function commentHygieneLeg(check, ceilings, files) {
  const m = runCommentHygieneScan(files, ROOT);
  if (m.failure !== null) {
    return {
      refusal:
        `REFUSING to measure the comment-hygiene legs — ${m.failure}.\n` +
        '  A detector that cannot run is a gate FAILURE, not a zero. Run ' +
        `\`node ${TSX_CLI} ${CH_DETECTOR}\` to see why.`,
      scannedFiles: 0,
      line: null
    };
  }
  const missing = CH_CEILING_KEYS.filter((key) => !Number.isInteger(ceilings[key]));
  if (missing.length > 0) {
    return {
      refusal:
        `REFUSING to measure the comment-hygiene legs — the baseline has no ceiling for ` +
        `${missing.join(', ')}.\n` +
        '  Regenerate it: node .husky/peaks-gate-baseline.mjs',
      scannedFiles: m.scannedFiles,
      line: null
    };
  }
  for (const [field, ceilingKey, label] of CH_RULES) check(label, m[field], ceilings[ceilingKey]);
  return {
    refusal: null,
    scannedFiles: m.scannedFiles,
    line: describeCommentHygieneRun({
      deadReferences: m.deadReferences,
      narrative: m.narrative,
      scanned: m.scannedFiles
    })
  };
}

async function commentHygieneMode(argv) {
  const named = argv.map(rel).filter((f) => f !== '');
  const files = named.length > 0 ? named : lintFileList();
  const failures = [];
  const check = makeCheck(failures);

  console.log('');
  const ch = commentHygieneLeg(check, baseline.ceilings, files);
  console.log('');
  if (ch.refusal !== null) {
    console.error(`peaks-gate: ${ch.refusal}\n`);
    return 1;
  }
  console.log(`  ${ch.line}`);
  if (named.length > 0) {
    console.log(
      `  CONTROL ARM: these rows were measured over the ${named.length} file(s) named on the ` +
        'command line, not over the enforced scope. The ceilings are whole-scope numbers, so ' +
        'a held row here says nothing about the repository.'
    );
  }
  console.log('');

  if (failures.length > 0) {
    console.error('peaks-gate: comment-hygiene ratchet breached — a total grew.\n');
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error('\nThese totals only ever go DOWN. Remove the debt; do not raise a ceiling.\n');
    return 1;
  }

  console.log(`peaks-gate: comment-hygiene ceilings held (${ch.scannedFiles} file(s) scanned).`);
  return 0;
}

export { commentHygieneLeg, commentHygieneMode };

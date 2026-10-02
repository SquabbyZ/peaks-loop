// .husky/gate/modes.mjs
// The three mode bodies that are thin wrappers over a shared leg: staged mode,
// silent-warning mode and file-size mode. Hoisted VERBATIM out of
// `.husky/peaks-gate.mjs` by rid `2026-10-02-wave9-gate-entry-split`.

import { baseline, inScope, makeCheck, rel, reportEmpty } from './context.mjs';
import { ratchetFiles } from './ratchet.mjs';
import { silentWarningLeg, fileSizeLeg } from './legs.mjs';
import {
  FS_CEILING_KEY,
  parseFileSizeArgv,
  printFileSizeLeg
} from '../../.husky/peaks-gate-file-size.mjs';

// ---------------------------------------------------------------------------
// staged mode — invoked by lint-staged with the staged file list
// ---------------------------------------------------------------------------
async function stagedMode(argv) {
  const files = argv.map(rel).filter(inScope);
  if (files.length === 0) return reportEmpty('staged');
  return ratchetFiles(files, 'staged');
}
// ---------------------------------------------------------------------------
// silent-warning mode — the two legs, without eslint / prettier / tsc
// ---------------------------------------------------------------------------
// WHY THIS MODE EXISTS. `repo` mode is the enforcement surface, and it costs
// minutes. The unit test for this leg has to add a swallow to a scratch file and
// watch THE SAME leg go red — and a test that re-implemented the comparison to
// stay cheap would prove nothing about the gate. So it spawns this mode instead:
// one measurement, one `check`, the same ceilings, ~1s.
//
// Path arguments narrow the detector's scan for a control arm; with none it
// ratchets exactly what `repo` mode ratchets.
async function silentWarningMode(argv) {
  const files = argv.map(rel).filter((f) => f !== '');
  const failures = [];
  const check = makeCheck(failures);

  console.log('');
  const sw = silentWarningLeg(check, baseline.ceilings, files);
  console.log('');
  if (sw.refusal !== null) {
    console.error(`peaks-gate: ${sw.refusal}\n`);
    return 1;
  }

  if (failures.length > 0) {
    console.error('peaks-gate: silent-warning ratchet breached — a total grew.\n');
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error(
      '\nThese totals only ever go DOWN. Fix the regression; do not raise a ceiling.\n'
    );
    return 1;
  }

  console.log(`peaks-gate: silent-warning ceilings held (${sw.scannedFiles} file(s) scanned).`);
  return 0;
}
// ---------------------------------------------------------------------------
// file-size mode — the over-cap leg, without eslint / prettier / tsc
// ---------------------------------------------------------------------------
// Same reason `silent-warning` mode exists: `repo` mode is the enforcement
// surface and costs minutes, while this leg's guard has to hand the gate ONE
// over-cap file and watch the same `check` against the same ceiling go red. A
// test that re-implemented the comparison to stay cheap would prove nothing
// about the gate.
//
// A named-file list needs `--control-arm`, because a subset is not the row (F1):
// with the flag the leg runs the SAME measurement and the SAME `check` against the
// SAME ceiling and says plainly that it measured only the named files; without it
// the leg refuses. With no paths at all it ratchets exactly what `repo` mode does,
// and that is the only run that may say the word "held".
function fileSizeMode(argv) {
  const { controlArm, files } = parseFileSizeArgv(argv);
  const scoped = files.map(rel).filter((f) => f !== '');
  const failures = [];
  const check = makeCheck(failures);
  const ceiling = baseline.ceilings[FS_CEILING_KEY];

  console.log('');
  const size = fileSizeLeg(check, baseline.ceilings, scoped, controlArm);
  // Evidence before verdict, in both modes and for every refusal that has an
  // envelope behind it — see `printFileSizeLeg`. Exit 1 is unchanged.
  if (!printFileSizeLeg(size, ceiling)) return 1;
  console.log('');

  if (failures.length > 0) {
    console.error(
      `peaks-gate: file-size ${size.controlArm ? 'CONTROL ARM ' : ''}breached — ` +
        'one or more of the four rows this leg ratchets is over its ceiling.\n'
    );
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error('\nThese totals only ever go DOWN. Split the file; do not raise the ceiling.\n');
    return 1;
  }

  if (size.controlArm) {
    console.log(
      `peaks-gate: file-size CONTROL ARM within the ceiling (${size.envelope.overCap} of ` +
        `${size.envelope.scope.countedFiles} named file(s) over cap, ceiling ${ceiling}). ` +
        'The repo row was not measured and is not claimed by this run.\n'
    );
    return 0;
  }

  console.log(
    `peaks-gate: file-size ceiling held (${size.envelope.overCap} file(s) over cap in the ` +
      `policy scope, ${size.envelope.hooks.overCap} over cap under .husky/ with ` +
      `${size.envelope.hooks.excessLines} excess lines).`
  );
  return 0;
}

export { stagedMode, silentWarningMode, fileSizeMode };

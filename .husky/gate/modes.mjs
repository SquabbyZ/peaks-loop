// .husky/gate/modes.mjs
// The three mode bodies that are thin wrappers over a shared leg: staged mode,
// silent-warning mode and file-size mode. Hoisted VERBATIM out of
// `.husky/peaks-gate.mjs` by rid `2026-10-02-wave9-gate-entry-split`.

import { baseline, inScope, makeCheck, outOfScopeNotice, rel, reportEmpty } from './context.mjs';
import { ratchetFiles } from './ratchet.mjs';
import { silentWarningLeg, fileSizeLeg } from './legs.mjs';
// The enforced scope, from the one module that owns the rule — the same list
// `.husky/peaks-gate.mjs`'s `repoFileList()` builds for `repo` mode, reached the
// copy-safe way (see the header of `.husky/peaks-gate.mjs`).
import { lintFileList } from '../../scripts/lint/lint-file-list.mjs';
import {
  FS_CEILING_KEY,
  parseFileSizeArgv,
  printFileSizeLeg
} from '../../.husky/peaks-gate-file-size.mjs';

// ---------------------------------------------------------------------------
// staged mode — invoked by lint-staged with the staged file list
// ---------------------------------------------------------------------------
// THE OUT-OF-SCOPE SENTENCE (rid `2026-10-03-w10-rescope-a`, H2): since the
// owner's boundary moved, a staged code file with no baseline row is EXEMPT —
// but the exemption must be READ, not felt. A silent skip is §2.41's shape:
// "0 findings" and "nothing checked" must never share an output. The sentence
// itself lives in `context.mjs`, one implementation for both per-file modes.
async function stagedMode(argv) {
  const all = argv.map(rel).filter((f) => f !== '');
  const dropped = outOfScopeNotice('staged', all);
  const files = all.filter(inScope);
  if (files.length === 0) return reportEmpty('staged', dropped);
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
// Path arguments narrow the scan for a control arm (the injection arms in
// `tests/unit/lint/silent-warning-gate-leg.test.ts` hand one scratch file from
// outside the repository); with none the leg derives the enforced scope itself,
// from the one module that owns it, so this mode ratchets EXACTLY what `repo` mode
// ratchets. Either way the population is the list the leg was handed, and
// `runSilentWarningScan` refuses when the detector's count disagrees with it (rid
// `2026-10-03-silent-warning-scope`) — a named-file run says plainly below that it
// spoke for the named files and not for the repo row.
async function silentWarningMode(argv) {
  const named = argv.map(rel).filter((f) => f !== '');
  const files = named.length > 0 ? named : lintFileList();
  const failures = [];
  const check = makeCheck(failures);

  console.log('');
  const sw = silentWarningLeg(check, baseline.ceilings, files);
  console.log('');
  if (sw.refusal !== null) {
    console.error(`peaks-gate: ${sw.refusal}\n`);
    return 1;
  }
  console.log(`  ${sw.line}`);
  if (named.length > 0) {
    console.log(
      `  CONTROL ARM: these rows were measured over the ${named.length} file(s) named on the ` +
        'command line, not over the enforced scope. The ceilings are whole-scope numbers; a ' +
        'held row here is not a held row for the repository, and a breached one is not a breach.'
    );
  }
  console.log('');

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
    `peaks-gate: file-size ceiling held (${size.partition.gated.overCap} in-scope file(s) over ` +
      `cap (ceiling ${ceiling}) + ${size.partition.shadow.overCap} out-of-scope file(s) counted ` +
      `and not gated, ${size.envelope.hooks.overCap} over cap under .husky/ with ` +
      `${size.envelope.hooks.excessLines} excess lines).`
  );
  return 0;
}

export { stagedMode, silentWarningMode, fileSizeMode };

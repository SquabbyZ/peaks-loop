// .husky/gate/modes.mjs
// The three mode bodies that are thin wrappers over a shared leg: staged mode,
// silent-warning mode and file-size mode. Hoisted VERBATIM out of
// `.husky/peaks-gate.mjs` by rid `2026-10-02-wave9-gate-entry-split`.

import {
  ROOT,
  baseline,
  inScope,
  makeCheck,
  outOfScopeNotice,
  rel,
  reportEmpty
} from './context.mjs';
import { ratchetFiles } from './ratchet.mjs';
import { silentWarningLeg, fileSizeLeg } from './legs.mjs';
import { stagedSizeLeg } from './staged-size.mjs';
import { wideFormatLeg } from './wide-format.mjs';
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
//
// NO FILE ARGUMENT AT ALL IS A MISUSE, NOT AN EMPTY CHANGE SET (rid-038, W2/D1).
// Measured 2026-10-09: `node .husky/peaks-gate.mjs staged`, typed with no paths,
// printed "EMPTY CHANGE SET (staged) — 0 in-scope files, NOTHING WAS CHECKED" and
// exited 0. The sentence is honest; the EXIT CODE is not, and a caller that reads
// only the exit code (an orchestrator did) reads a misuse as a PASS.
//
// WHY "NO FILE" IS DECIDABLE AND WHY IT IS A REFUSAL. `staged` takes its file
// list from argv because lint-staged passes the staged paths to it — and
// lint-staged does NOT run a command whose glob matched nothing. So an argv
// carrying no file cannot have come from lint-staged: it was written by hand or
// generated empty, and in both cases the gate was asked to ratchet nothing while
// looking like it had ratcheted something.
//
// WHAT IS DELIBERATELY UNCHANGED. Two empty results are LEGITIMATE and keep exit
// 0 through reportEmpty() below, and this refusal is placed so that neither can
// reach it: (1) argv that DOES name files, every one of which is outside the lint
// scope — a scope exemption, already said in full sentences; (2) `changed` mode
// with nothing to compare — a real no-change, which never takes argv at all.
// Only "no file was handed to me" is refused, and only in this mode.
function noFileArgumentReceived(argv) {
  // A blank argument is not a file: `staged "$FILES"` with an empty `$FILES` is
  // the same misuse as `staged`, arriving through the other shell spelling.
  return argv.every((arg) => arg.trim() === '');
}

function refuseNoFileArgument() {
  console.error(
    'peaks-gate: USAGE (staged) — this run was given NO file argument, so NOTHING WAS\n' +
      '  CHECKED and the gate refuses to hand back the exit code of a check.\n' +
      '\n' +
      '  `staged` reads its file list from argv because lint-staged passes the staged\n' +
      '  paths to it, and lint-staged does NOT run a command whose glob matched nothing.\n' +
      '  An argv with no file in it therefore did not come from lint-staged: it is a\n' +
      "  hand-written or empty-generated invocation. Exit 2 is this gate's usage code.\n" +
      '\n' +
      '  NOT refused here, and still exit 0: a change set whose code files are all\n' +
      '  outside the lint scope (a scope exemption), and `changed` mode with nothing to\n' +
      '  compare. Both are real, and both still say so in full sentences.\n' +
      '\n' +
      '  To check files by hand: node .husky/peaks-gate.mjs staged <file> [<file>...]\n' +
      '  To reproduce the commit path: pnpm exec lint-staged\n'
  );
  return 2;
}

/**
 * What the OTHER axis did, for the empty-change-set sentence.
 *
 * The per-file ratchet and the wide formatting leg are two different checks over
 * two different scopes, and the sentence that reports "nothing was compared" must
 * only ever be said when NOTHING was compared. So this returns `null` — meaning
 * "no other axis read anything, the plain sentence is true as it stands" — when
 * the wide leg measured no file, and a sentence naming the other axis when it
 * did. A wide leg that could not measure at all is a third case, and it says so
 * rather than letting an unreadable scope read as an empty one.
 */
function wideNote(wide) {
  if (wide.line === null) {
    return 'The wide formatting check could not measure them at all.';
  }
  if (wide.compared.length === 0) {
    return null;
  }
  return `The wide formatting check compared ${wide.compared.length} of them on a different axis — see its line above.`;
}

async function stagedMode(argv) {
  if (noFileArgumentReceived(argv)) return refuseNoFileArgument();
  const all = argv.map(rel).filter((f) => f !== '');
  const dropped = outOfScopeNotice('staged', all);
  const files = all.filter(inScope);
  // THE WIDE FORMATTING LEG, ON THE COMMIT PATH. It is handed `all`, not `files`,
  // for the same reason the file-size leg is: `tests/**` and `scripts/**` are
  // OUTSIDE the lint scope by owner decision (2026-10-03), and they are exactly
  // the files this leg measures. The wide scope is read from
  // `package.json#scripts['format:check']` — the same four globs the CI job and
  // the push gate's format ratchet use — so the two spellings cannot drift.
  //
  // IT IS NOT THE ESLINT LEG, AND IT DOES NOT WIDEN THE LINT SCOPE. The wide
  // check's rule is "prettier-clean" and it needs no baseline row, which is
  // exactly the objection the owner's 2026-10-03 decision recorded against
  // widening the PER-FILE ratchet: a per-file ratchet can only cover files that
  // HAVE a baseline row. `.husky/gate/wide-format.mjs` states the whole
  // distinction, and the lint scope, the eslint leg and the per-file baseline
  // rows are all untouched by this one.
  const wide = await wideFormatLeg(all);
  // THE FILE-SIZE RATCHET, ON THE COMMIT PATH. It is handed `all`, not `files`:
  // `tests/**` and `scripts/**` are outside the LINT scope but inside the file-size
  // POLICY's, and a leg hung off `files` would have missed the very file the defect was
  // measured on (a 504-line test file under a 500 cap, staged, exit 0). The policy —
  // not this gate — decides which of the staged paths it measures; see
  // `staged-size.mjs` for why there is no threshold written down here.
  //
  // It runs BEFORE the empty-change-set branch below, deliberately: that branch is
  // exactly the defect's signature (every staged file out of lint scope), so a leg
  // placed after it would be unreachable on the input this slice exists to cover.
  const size = stagedSizeLeg(all, ROOT);
  if (size.line !== null) console.log(`peaks-gate: ${size.line}`);
  if (wide.line !== null) console.log(`peaks-gate: ${wide.line}`);
  const lint =
    files.length === 0
      ? reportEmpty('staged', dropped, wideNote(wide))
      : await ratchetFiles(files, 'staged');
  if (wide.refusal !== null) {
    console.error(`\npeaks-gate: commit blocked — the wide formatting check refused.\n`);
    console.error(`${wide.refusal}\n`);
    return 1;
  }
  if (size.refusal !== null) {
    console.error(`\npeaks-gate: commit blocked — the staged file-size ratchet refused.\n`);
    console.error(`${size.refusal}\n`);
    return 1;
  }
  return lint;
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

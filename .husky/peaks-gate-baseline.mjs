#!/usr/bin/env node
/**
 * Regenerates .peaks/lint/gate-baseline.json — the ceilings the husky gate
 * ratchets against. Run it after a cleanup slice has landed, to lower a
 * ceiling to the new measured value:
 *
 *   node .husky/peaks-gate-baseline.mjs
 *
 * It measures, it never guesses: every number written here is read off the
 * tools in this run. Read the diff before committing it anyway — what the
 * ceilings may not do is go UP. Since rid `2026-10-02-baseline-monotonicity` that
 * sentence is enforced here as well as written into the artifact, and since its
 * repair cycle (`2026-10-02-monotonicity-head-anchor`) the number it is enforced
 * against is read out of git — `git show HEAD:.peaks/lint/gate-baseline.json` —
 * rather than out of the file this run is about to overwrite, which is the file a
 * weakening edits. The working copy is audited against that anchor as a second,
 * independent trip, the ceiling key set is audited against `CEILING_KEYS`, and any
 * of the three refusals stops the run before a byte changes
 * (`.husky/peaks-gate-baseline-monotonic.mjs`). Before those slices the rule was
 * only a sentence in the file's own `note`, and on 2026-10-01 the generator raised
 * `prettierUnformatted` 0 → 7 and exited 0.
 *
 * WHY EXPLICIT PATHS + --no-ignore
 * --------------------------------
 * The obvious invocation — `eslint src tests packages scripts` — silently
 * skipped 33 files, because `.peaks-rules.cjs` sets `ignorePatterns:
 * ['skills/', ...]` to exclude the repo-root prose directory and ESLint reads a
 * trailing-slash pattern with no inner slash the way .gitignore does: it
 * matches a directory of that name at ANY depth. `src/services/skills/`,
 * `src/skills/`, and two test directories — 33 files, production source among
 * them — were recorded as "0 findings" without ever being parsed.
 *
 * Passing the file list explicitly and disabling ignore patterns removes that
 * whole failure mode. It is safe here only because the arguments are always
 * FILES and never directories: `--no-ignore` on a directory would descend into
 * node_modules.
 *
 * CLASSES THAT ARE NEVER BLURRED INTO `findings`
 * ---------------------------------------------
 * `coverageGap`    — parserOptions.project does not cover the file; eslint
 *                    fails it before parsing. Also MASKS real defects, since
 *                    parsing never happens.
 * `syntaxError`    — in the project, cannot be parsed. A real defect.
 * `phantomRules`   — a ruleId the config names but the pinned plugin does not
 *                    define. Fires on EVERY parsed file, so counting it as debt
 *                    both inflates the ceiling by ~2400 and makes "a NEW file
 *                    must be clean" unsatisfiable. The set is derived from the
 *                    messages, never hardcoded, so it cannot go stale.
 * `notLinted`      — eslint reported nothing at all for a file we asked about.
 * `unparsable`     — prettier cannot parse it.
 * Each has its own ceiling line. None is ever counted as a lint finding, so
 * none can be traded against real debt.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
// `./` here, `../.husky/` in `.husky/peaks-gate.mjs`, for the SAME file — not drift
// to "fix": the gate is run from a scratch copy by the parity test's control arm and
// has to resolve its helper from one level under the repo root, while this generator
// is only ever run in place (see the comment on that import).
import {
  FS_CEILING_KEY,
  FS_WHOLE_SCOPE_SOURCE,
  measureFileSizeOverCap
} from './peaks-gate-file-size.mjs';
// The ratchet's own rule, one module down from the sentence that states it in the
// artifact. Pure, so every row of its decision table is testable without paying for
// a whole measurement run — see the header of that file for why an untested guard on
// a ratchet is a rumour, which is exactly what this one was, and for the order the
// refusals below run in (anchor first, working copy second, canonical set third).
import {
  CEILING_KEYS,
  SEED_FLAG,
  canonicalKeyProblems,
  compareCeilings,
  describeCanonicalKeyFailure,
  describeMonotonicityFailure,
  describeMonotonicityNotes,
  missingCanonicalKeys,
  parsePreviousArtifact,
  workingCopyTrip
} from './peaks-gate-baseline-monotonic.mjs';

// Slash-normalised once, at the definition — `resolve()` returns backslashes on
// Windows and a `${ROOT}/` built from that can never match a normalised path.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  .split('\\')
  .join('/');
const OUT_PATH = resolve(ROOT, '.peaks/lint/gate-baseline.json');
const ESLINT_CONFIG = 'config/eslint/.peaks-rules.cjs';
const CODE_EXT = /\.(ts|tsx|mts|cts|mjs|cjs|js)$/;
const TOP_DIRS = ['src', 'tests', 'packages', 'scripts'];
const COVERAGE_GAP = /was not found in any of the provided project/;
const PHANTOM_DEF = /Definition for rule '(.+)' was not found/;
const BATCH = 150; // argv stays well under the Windows command-line limit

const rel = (p) => p.split('\\').join('/').replace(`${ROOT}/`, '');

// ---------------------------------------------------------------------------
// The config guard — why this generator may now REFUSE to write
// ---------------------------------------------------------------------------
// `prettier.resolveConfig()` returns NULL and does not throw when no config is
// found. Spreading that null yields prettier's DEFAULTS (printWidth 80, double
// quotes, trailing commas), under which a file correctly formatted for THIS repo
// reads as dirty. Measured 2026-09-19: of the 88 files the baseline calls
// prettier-clean, 6 of 6 sampled return true with the repo config and false with
// the spread null.
//
// Left unguarded, this generator would not merely print a wrong number — it
// would WRITE it. `prettierUnformatted` would jump 1178 -> ~1266 and become the
// ceiling, and every one of those files would be marked `prettierClean: false`,
// so the ratchet could never be satisfied for them again. A transient race in
// `scripts/bump-version.mjs` (truncate-then-write of the root package.json, not
// atomic) would become permanent damage to the baseline.
//
// So the config is compared against the repo's own declaration before anything
// is written, and a mismatch aborts the run with the ceilings untouched.
const DECLARED_PRETTIER = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).prettier;

function prettierConfigProblem(resolved) {
  if (DECLARED_PRETTIER === undefined) return 'package.json has no "prettier" key to check against';
  if (resolved === null) return 'prettier found NO config (resolveConfig returned null)';
  for (const [key, want] of Object.entries(DECLARED_PRETTIER)) {
    if (resolved[key] !== want) {
      return `resolved ${key}=${JSON.stringify(resolved[key])} but package.json declares ${JSON.stringify(want)}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// THE ANCHOR — where the previous ceilings come from (rid 2026-10-02-monotonicity-head-anchor)
// ---------------------------------------------------------------------------
// C wave 8 read them back out of `OUT_PATH`: the working-tree artifact, the same
// file this run is about to overwrite and the same file a weakening edits. An
// out-of-band review measured the three ways past that: delete a row and the run
// prints `NEWLY SEEDED` and writes it, inflate a row and it prints `CLEARED` and
// writes the descent, set `"ceilings": {}` and all thirteen rows re-seed because an
// empty object parses. The push leg then closed it worse — the remedy its own
// refusal prints is `Regenerate it: node .husky/peaks-gate-baseline.mjs`, so an
// operator following the gate's instruction performs attack one.
//
// So the previous side is a git object now, and the whole trip runs BEFORE the
// measurement: minutes of eslint, prettier and tsc are not spent deciding a verdict
// about a file that an edit already decided. Two guards, independent of each other:
//
//   1. `git show HEAD:.peaks/lint/gate-baseline.json` is what the fresh measurement
//      is compared against. Editing the working copy cannot move it.
//   2. The working copy is then compared against THAT. Lifting a number, dropping a
//      row or adding one HEAD never carried is the attack, and this refuses it
//      before it judges its own measurement. A working copy that is only LOWER is a
//      stricter request, not an attack: it goes through, out loud, and the
//      measurement decides the number that is written.
//
// The order of the refusals is stated in `.husky/peaks-gate-baseline-monotonic.mjs`
// and the arms in `tests/unit/lint/baseline-monotonicity-head-anchor.test.ts` follow
// it: no anchor → the documented `--seed` path; anchor + edited working copy → trip;
// then the canonical key set on all three vectors; then HEAD vs measurement.
const OUT_REL = rel(OUT_PATH);
const HEAD_REF = `HEAD:${OUT_REL}`;
const seedRun = process.argv.slice(2).includes(SEED_FLAG);

/** Print the generator's one refusal shape and stop, with the bytes untouched. */
function refuse(reason) {
  console.error(
    `\nREFUSING to write ${OUT_REL}: ${reason}\n` +
      '  Nothing has been written; the existing ceilings are untouched.\n'
  );
  process.exit(1);
}

/**
 * `git show HEAD:…`, or the reason there is no anchor. Never throws: a repository
 * with no commit, no such path, no git binary or no git at all is the documented
 * seed path (a baseline that has to be seeded says so with `--seed`), not a stack
 * trace an operator has to read.
 */
function readGitShowHead(path) {
  try {
    return {
      text: execFileSync('git', ['show', `HEAD:${path}`], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true
      }),
      problem: null
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {
        text: null,
        problem: 'git could not be run at all (ENOENT), and the previous ceilings live in git'
      };
    }
    const first = String(err.stderr ?? err.message).split('\n')[0].trim();
    return { text: null, problem: `HEAD has no readable artifact (${first})` };
  }
}

/**
 * The artifact on disk, as a second witness rather than as the source of the
 * previous numbers. `state` says which of the four situations the trip has to
 * distinguish: nothing there, something unreadable, something unparseable, ceilings.
 */
function readWorkingCopyCeilings() {
  if (!existsSync(OUT_PATH)) return { state: 'absent', ceilings: null, problem: null };
  let text;
  try {
    text = readFileSync(OUT_PATH, 'utf8');
  } catch (err) {
    return { state: 'unreadable', ceilings: null, problem: `could not be read (${err.code ?? err.message})` };
  }
  if (text.trim() === '') return { state: 'empty', ceilings: null, problem: 'is empty' };
  const parsed = parsePreviousArtifact(text);
  if (parsed.problem !== null) {
    return { state: 'unparseable', ceilings: null, problem: parsed.problem };
  }
  // An emptied `ceilings` block on disk is row-deletion by another name, and it is
  // a row-deletion the trip below can only see if it is still read as a vector.
  return { state: 'ceilings', ceilings: parsed.ceilings, problem: null };
}

const anchorRead = readGitShowHead(OUT_REL);
let anchorCeilings = null;
let anchorProblem = anchorRead.problem;
if (anchorProblem === null) {
  const parsed = parsePreviousArtifact(anchorRead.text);
  anchorCeilings = parsed.ceilings;
  anchorProblem = parsed.problem;
}
// A `ceilings` block that is empty, or full of rows no slice sanctioned, is not a
// baseline with holes in it: it is the absence of one. Treat it as such so it lands
// on the documented `--seed` path instead of silently seeding every canonical row.
if (anchorProblem === null && missingCanonicalKeys(anchorCeilings).length === CEILING_KEYS.length) {
  anchorCeilings = null;
  anchorProblem = `has no canonical ceiling row at all (${HEAD_REF} carries an empty or ` +
    'unrecognised `ceilings` block)';
}
const workingCopy = readWorkingCopyCeilings();
const anchorKnown = anchorCeilings !== null;

if (!anchorKnown && !seedRun) {
  refuse(
    `the previous ceilings are anchored in ${HEAD_REF} and that anchor ${anchorProblem}.\n\n` +
      '  A baseline cannot be re-based on a number nobody read, and the file on disk is not\n' +
      `  the anchor: ${OUT_REL} is what a weakening edits. If this really is the first\n` +
      '  generation in this repository, say so on purpose:\n' +
      `    node .husky/peaks-gate-baseline.mjs ${SEED_FLAG}\n` +
      `  Otherwise restore the anchor: git checkout HEAD -- ${OUT_REL}`
  );
}

// The artifact on disk is the file the push-time gate reads, so an unreadable or
// unparseable copy of it is worth naming even though it carries no number to
// launder. `--seed` is the way to say "this repository has no baseline yet, write it
// anyway"; nothing else silences this.
const anchorNotes = [];
if (anchorKnown && workingCopy.state !== 'ceilings' && workingCopy.state !== 'absent') {
  if (!seedRun) {
    refuse(
      `the artifact on disk ${workingCopy.problem}, and the push-time gate reads that\n` +
        `  file. The anchor is ${HEAD_REF}, so this run could compare it and refused to\n` +
        '  overwrite something it could not read:\n' +
        `    - ${OUT_REL}\n` +
        `  Restore it first: git checkout HEAD -- ${OUT_REL}\n` +
        '  (If this repository really has no baseline yet, that is what ' +
        `${SEED_FLAG} is for, and it will replace the file.)`
    );
  }
  anchorNotes.push(
    `anchor: the artifact on disk ${workingCopy.problem}, and ${SEED_FLAG} was passed, so ` +
      `this run replaces it.\n  The comparison was made against ${HEAD_REF}, not against it.`
  );
}

// The second guard: the working copy judged against the anchor, not against itself.
if (anchorKnown && workingCopy.state === 'ceilings') {
  const trip = workingCopyTrip({
    headRef: HEAD_REF,
    outRel: OUT_REL,
    head: anchorCeilings,
    working: workingCopy.ceilings
  });
  if (trip.refusal !== null) refuse(trip.refusal);
  anchorNotes.push(...trip.notes);
}

// ---- scope -----------------------------------------------------------------
// The scope list is `git ls-files`, and since this file's own slice the generator
// needs git for a second reason: its previous ceilings live in HEAD. So a checkout
// with no git is a refusal the operator can read, not an `ENOENT` stack trace from
// `execFileSync` — the trip up in THE ANCHOR block is the one that fires first, and
// this one catches a `--seed` run that got past it.
let trackedFiles;
try {
  trackedFiles = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
} catch (err) {
  refuse(
    'this generator measures the tracked file list with `git ls-files` and git could not ' +
      `be run here (${err.code ?? err.message}).\n` +
      `  The previous ceilings are read from ${HEAD_REF} for the same reason.`
  );
}
const scope = trackedFiles
  .trim()
  .split('\n')
  .filter((f) => CODE_EXT.test(f) && TOP_DIRS.some((d) => f.startsWith(`${d}/`)));
console.error(`scope: ${scope.length} files`);

// ---- eslint ----------------------------------------------------------------
console.error('running eslint over explicit paths with --no-ignore...');
const messagesByFile = {};
for (let i = 0; i < scope.length; i += BATCH) {
  let raw;
  try {
    raw = execFileSync(
      'node',
      [
        'node_modules/eslint/bin/eslint.js',
        '--config',
        ESLINT_CONFIG,
        '--no-ignore',
        '--format',
        'json',
        ...scope.slice(i, i + BATCH)
      ],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }
    );
  } catch (err) {
    raw = err.stdout;
  }
  for (const f of JSON.parse(raw)) messagesByFile[rel(f.filePath)] = f.messages;
}

const phantomRules = new Set();
for (const file of scope) {
  for (const m of messagesByFile[file] ?? []) {
    const hit = PHANTOM_DEF.exec(m.message);
    if (hit) phantomRules.add(hit[1]);
  }
}

const classify = (messages) => {
  if (messages === undefined) return { notLinted: true };
  const fatal = messages.filter((m) => m.fatal);
  const nonFatal = messages.filter((m) => !m.fatal);
  const real = nonFatal.filter((m) => m.ruleId === null || !phantomRules.has(m.ruleId));
  const coverageGap = fatal.length > 0 && fatal.every((m) => COVERAGE_GAP.test(m.message));
  return {
    eslint: real.length,
    eslintErrors: real.filter((m) => m.severity === 2).length,
    coverageGap,
    notLinted: false,
    syntaxError: fatal.length > 0 && !coverageGap,
    phantomFindings: nonFatal.length - real.length,
    fatalMessage: fatal[0] ? fatal[0].message.split('\n')[0] : ''
  };
};

let findings = 0;
let errors = 0;
let phantomFindings = 0;
const coverageGapFiles = [];
const syntaxErrorFiles = [];
const notLinted = [];
for (const file of scope) {
  const v = classify(messagesByFile[file]);
  if (v.notLinted) {
    notLinted.push(file);
    continue;
  }
  phantomFindings += v.phantomFindings;
  if (v.syntaxError) syntaxErrorFiles.push(file);
  else if (v.coverageGap) coverageGapFiles.push(file);
  else {
    findings += v.eslint;
    errors += v.eslintErrors;
  }
}
console.error(
  `eslint: ${findings} real findings (${errors} errors); ${phantomFindings} phantom-rule findings ` +
    `from ${phantomRules.size} nonexistent ruleId(s)${phantomRules.size ? `: ${[...phantomRules].join(', ')}` : ''}`
);
console.error(
  `  ${coverageGapFiles.length} coverage-gap; ${syntaxErrorFiles.length} syntax error; ` +
    `${notLinted.length} NOT LINTED`
);
for (const f of notLinted) console.error(`  ? never linted: ${f}`);

// ---- prettier --------------------------------------------------------------
console.error('checking prettier...');
const prettierCleanByFile = {};
const unparsable = [];
let prettierDirty = 0;
let configFailure = null;
for (const file of scope) {
  const abs = resolve(ROOT, file);
  let src;
  try {
    src = readFileSync(abs, 'utf8');
  } catch {
    continue;
  }
  const opts = await prettier.resolveConfig(abs, { editorconfig: false });
  const problem = prettierConfigProblem(opts);
  if (problem !== null) {
    configFailure = `${file}: ${problem}`;
    break;
  }
  try {
    const clean = await prettier.check(src, { ...opts, filepath: abs });
    prettierCleanByFile[file] = clean;
    if (!clean) prettierDirty++;
  } catch (err) {
    unparsable.push({ file, reason: String(err.cause?.message ?? err.message).split('\n')[0] });
    prettierCleanByFile[file] = false;
  }
}

// Refuse BEFORE writing. Writing here would poison the ceiling with ~1266
// false "unformatted" entries and the ratchet could never recover from it.
if (configFailure !== null) {
  console.error(
    `\nREFUSING to write ${rel(OUT_PATH)}: prettier's config did not resolve.\n  ${configFailure}\n\n` +
      'The root package.json is the config host. If it is being rewritten right now\n' +
      '(scripts/bump-version.mjs truncates then writes it, not atomically), re-run in\n' +
      'a moment. Nothing has been written; the existing ceilings are untouched.\n'
  );
  process.exit(1);
}
console.error(
  `prettier: ${prettierDirty} of ${scope.length} unformatted; ${unparsable.length} unparsable`
);
for (const u of unparsable) console.error(`  ! ${u.file}: ${u.reason}`);

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

// ---- file-size census ------------------------------------------------------
// The third measured-only ceiling, and the one this slice exists to add. The
// policy — 300 raw lines for `src`/`packages`/`scripts`, 500 for the root
// `tests/` tree — lives in `src/services/scan/file-size-policy.ts`; the census is
// the only tool that imports it and counts the whole scope, so the ceiling and
// the gate's own reading of `fileSizeOverCap` come from ONE measurement path.
// Nothing here may type the number: 174 is what this run's census reported, and a
// literal would freeze the ceiling in place of the count — the same defect the
// silent-warning legs were added to end.
//
// THE SAME ENVELOPE SEEDS THE SECOND FILE-SIZE ROW, `fileSizeExcessLines` — the
// LINES over those caps, which `overCap` cannot see (rid `2026-10-01-file-size-excess-row`;
// C wave 6 paid 67 excess lines to buy 19 lint findings while the file count held).
// It is copied off `size.env.excessLines` under the same rule: never typed.
//
// FAIL-CLOSED on the same terms as the silent-warning step below: a census that
// cannot run, or that counted no file, aborts the run BEFORE anything is written.
// Writing a zero here would seed a ceiling of zero for a number that was never
// measured, and the ratchet could then never be satisfied again.
//
// THE MEASUREMENT PATH IS SHARED with the gate (`.husky/peaks-gate-file-size.mjs`,
// F5 of the repair cycle). These two callers used to carry near-verbatim copies of
// the spawn and its four refusal conditions, already drifted on one option; the
// ceiling and the row the gate compares must come from one code path, not two that
// happen to look alike.
console.error('running the file-size census...');
const size = measureFileSizeOverCap([], ROOT);
if (size.failure !== null) {
  console.error(
    `\nREFUSING to write ${rel(OUT_PATH)}: ${size.failure}.\n` +
      '  Nothing has been written; the existing ceilings are untouched.\n'
  );
  process.exit(1);
}
const sizeBuckets = Object.entries(size.env.byDir ?? {})
  .map(([dir, totals]) => `${dir} ${totals.files}`)
  .join(', ');
console.error(
  `file-size: ${size.env.overCap} of ${size.env.scope.countedFiles} file(s) over the policy cap ` +
    `(${size.env.caps.defaultCap}/${size.env.caps.testsCap} raw lines; ${sizeBuckets}; ` +
    `${size.env.excessLines} excess lines)`
);

// The ceiling describes the ROW, so it may only be seeded from the census's own
// whole-scope run. An explicit-path run counts whatever it is handed.
if (size.env.scope.source !== FS_WHOLE_SCOPE_SOURCE) {
  console.error(
    `\nREFUSING to write ${rel(OUT_PATH)}: the census reported source ` +
      `"${size.env.scope.source}" instead of "${FS_WHOLE_SCOPE_SOURCE}", so its overCap is not ` +
      'the number the gate ratchets.\n  Nothing has been written; the existing ceilings are ' +
      'untouched.\n'
  );
  process.exit(1);
}

// ---- write -----------------------------------------------------------------
const files = {};
for (const file of scope) {
  const v = classify(messagesByFile[file]);
  files[file] = {
    eslint: v.notLinted ? 0 : v.eslint,
    eslintErrors: v.notLinted ? 0 : v.eslintErrors,
    coverageGap: v.notLinted ? false : v.coverageGap,
    notLinted: Boolean(v.notLinted),
    prettierClean: prettierCleanByFile[file] ?? false
  };
}

// THE THIRTEEN ROWS, assembled before the artifact is written, because they are
// what the comparison below reads. Nothing here may type a number: every value is
// a measurement this run made, for the same reason the census and the
// silent-warning rows refuse a literal.
const ceilings = {
  eslintFindings: findings,
  eslintErrors: errors,
  eslintPhantomFindings: phantomFindings,
  eslintCoverageGapFiles: coverageGapFiles.length,
  eslintSyntaxErrorFiles: syntaxErrorFiles.length,
  eslintNotLintedFiles: notLinted.length,
  prettierUnformatted: prettierDirty,
  prettierUnparsableFiles: unparsable.length,
  tscErrors,
  silentWarningCatchReturnNull: sw.catchReturnNull,
  silentWarningEmptyCatch: sw.emptyCatch,
  fileSizeOverCap: size.env.overCap,
  // THE SAME ENVELOPE, THE OTHER UNIT (rid `2026-10-01-file-size-excess-row`):
  // the files over cap above, and the LINES over those caps. Nothing may type
  // this number either — it is the census's own `excessLines`, the figure the
  // gate prints in its scope note and, from this row on, enforces.
  fileSizeExcessLines: size.env.excessLines
};

// ---- monotonicity: the anchor was read above; decide, then write ------------
// RID 2026-10-02-BASELINE-MONOTONICITY (§2.27), repaired by rid
// 2026-10-02-monotonicity-head-anchor (§2.33). THE DEFECT IS THE SHAPE OF THIS
// BLOCK: until the first slice existed, the `note` string written below promised
// that a ceiling may only go DOWN and nothing compared a single key; until the
// second one, the number it compared against came from the file it was about to
// overwrite. Measured 2026-10-01: the generator raised `prettierUnformatted` 0 → 7
// and exited 0, and the only thing that caught it was an operator diffing the
// artifact by hand. A ratchet whose upper bound is decided by whoever last ran the
// tool — or last EDITED the tool's input — is not a ratchet.
//
// So the write below is refused if any pre-existing ceiling rose against HEAD, if any
// row vanished, if any of the three vectors disagrees with the canonical key set, or
// if the working copy had already been moved away from HEAD by the time this run
// started (refused up in THE ANCHOR block, before a minute of measurement).
const seedApplied = !anchorKnown;
const previousCeilings = anchorCeilings ?? {};

// THE CANONICAL KEY SET, AUDITED ON EVERY VECTOR — RA4's `13 rows, two places`.
// HEAD and the working copy may each be missing a canonical row, because that is how
// a new ceiling gets seeded once the key is in the generator AND on the list (and the
// working copy missing one HEAD carries is the trip's business, refused up in THE
// ANCHOR block). The measurement may not: a canonical row this run stopped measuring
// is a hole in the ratchet whatever the artifact says.
const keyProblems = [
  ...canonicalKeyProblems('measured by this run', ceilings),
  ...(anchorKnown ? canonicalKeyProblems(HEAD_REF, anchorCeilings, { allowMissing: true }) : []),
  ...(workingCopy.state === 'ceilings'
    ? canonicalKeyProblems('the artifact on disk', workingCopy.ceilings, { allowMissing: true })
    : [])
];

const monotonicity = compareCeilings(previousCeilings, ceilings);
// Every reason this run may not write is named in ONE refusal. They are collected
// rather than returned one at a time because they overlap — a row nobody sanctioned
// is both off the canonical list and a row this run no longer measures — and an
// operator shown only the first of the two fixes the wrong thing.
const refusals = [];
const keyFailure = describeCanonicalKeyFailure(keyProblems);
if (keyFailure !== null) refusals.push(keyFailure);
const monotonicityFailure = describeMonotonicityFailure(monotonicity);
if (monotonicityFailure !== null) refusals.push(monotonicityFailure);
if (refusals.length > 0) {
  refuse(
    `${refusals.join('\n\n')}\n\n  The anchor is ${HEAD_REF}. Nothing above it was rewritten by this run.`
  );
}
// The permitted write is the arm a guard most often forgets: a run that says
// nothing when it agrees looks identical to a run that never compared anything.
for (const note of anchorNotes) console.error(note);
for (const note of describeMonotonicityNotes(monotonicity, seedApplied)) console.error(note);

// `.peaks/lint/` is a tracked directory today, but the seed path above is the one
// run that may legitimately find it absent, and a refusal to write because of a
// missing directory is not a refusal the operator can act on.
mkdirSync(dirname(OUT_PATH), { recursive: true });

writeFileSync(
  OUT_PATH,
  `${JSON.stringify(
    {
      version: 3,
      generatedAt: new Date().toISOString(),
      note:
        'Ratchet baseline for the husky gate. Every ceiling may only go DOWN — if a regeneration ' +
        'raises one, that is a regression to fix, not a number to commit. Lint counts exclude ' +
        'coverage gaps, syntax errors and findings from ruleIds the pinned plugin does not ' +
        'define; each excluded class has its own ceiling line so that no artifact and no config ' +
        'bug can hide inside a number traded against real debt. Generated by ' +
        '.husky/peaks-gate-baseline.mjs with explicit file paths + --no-ignore.',
      invocation: { explicitPaths: true, noIgnore: true, linted: scope.length - notLinted.length },
      scope: { dirs: TOP_DIRS, extensions: 'ts, tsx, mts, cts, mjs, cjs, js' },
      phantomRules: [...phantomRules],
      ceilings,
      // The unit the row above is counted in, copied off the census envelope
      // rather than restated: `split('\n').length` and `wc -l` differ by one per
      // file, so 174 files is a 174-line ambiguity unless the artifact says
      // which convention produced it.
      fileSizeLineConvention: size.env.convention,
      // THE CEILING'S INPUTS, RECORDED WITH THE CEILING (repair cycle F2). Binding
      // only the convention left the number free to mean anything: measured by the
      // security audit on 2026-09-30, caps 300/500 → 174, 400/600 → 162, retiring
      // the cap to 800 → **40 and a GREEN gate**, and dropping `ts` from the
      // extension list → 5 over cap out of 43 counted files, which the
      // `countedFiles <= 0` trip cannot see. A ratchet whose input can be
      // re-decided underneath it is not a ratchet, so `.husky/peaks-gate.mjs` now
      // re-derives these four fields from a live census run and REFUSES the leg on
      // any mismatch. They come from the envelope, never from a literal, so this
      // generator cannot record an input it did not measure.
      fileSizePolicyInputs: {
        defaultCap: size.env.caps.defaultCap,
        testsCap: size.env.caps.testsCap,
        scopeDirs: size.env.scope.dirs,
        scopeExtensions: size.env.scope.extensions
      },
      coverageGapFiles,
      syntaxErrorFiles,
      notLinted,
      prettierUnparsable: unparsable,
      files
    },
    null,
    2
  )}\n`
);
console.error(`wrote ${rel(OUT_PATH)}`);

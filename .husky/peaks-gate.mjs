#!/usr/bin/env node
/**
 * peaks-gate — the ratchet gate driven by husky.
 *
 * WHY A RATCHET AND NOT A STRICT CHECK
 * ------------------------------------
 * Measured 2026-09-19: 1178 of 1266 source files are unformatted, eslint
 * reports 6597 findings across 1233 files, and `tsc -p tsconfig.json` reports
 * 142 errors. A hook that failed on "any lint error" would block every commit
 * from the first one, on files the committer never touched — and a gate that
 * is dead on arrival is not a strict gate, it is a gate people learn to bypass
 * with `--no-verify`.
 *
 * So this gate enforces the property that IS satisfiable today and that still
 * closes the door on new debt:
 *
 *   staged mode  — a file you touch may not be WORSE than it was; a file that
 *                  did not exist before must be clean outright. The file list
 *                  comes from lint-staged (the index).
 *   changed mode — the SAME per-file rule, applied to the files the commits
 *                  being pushed touched. Same comparison, different source of
 *                  the file list. This is what pre-push runs.
 *   repo mode    — the whole-repo totals may not grow. CI only (slice B5).
 *   silent-warning mode — the two silent-warning legs on their own: same
 *                  detector, same `check`, same ceilings as `repo` mode, without
 *                  eslint / prettier / tsc. It exists so a unit test can inject
 *                  a swallow and watch THIS leg go red (slice a3).
 *   file-size mode — the over-cap census leg on its own: same census, same
 *                  `check`, same ceiling as `repo` mode, for the same reason — a
 *                  unit test has to hand it one over-cap file and watch THIS leg
 *                  go red (rid 2026-09-30-cap-unify-01). A named-file list needs
 *                  `--control-arm`: a subset cannot fail a whole-tree row, so
 *                  without the flag the leg refuses instead of printing one
 *                  (repair cycle F1).
 *
 * The ceilings in `.peaks/lint/gate-baseline.json` are lowered slice by slice
 * by the cleanup program. At zero these same hooks are the strict gates,
 * unchanged — nothing here has to be rewritten to get there.
 *
 * AN UNLINTED FILE IS NOT A CLEAN FILE
 * ------------------------------------
 * `parserOptions.project` does not cover `packages/**` or `scripts/**`, so
 * eslint fails those files with "not found in any of the provided project(s)"
 * BEFORE it parses them. 71 files are in that state. Counting that artifact as
 * a lint finding would (a) inflate the ceiling with 71 numbers that are not
 * debt and (b) make every NEW file under those two directories permanently
 * unclean, i.e. uncommittable. Both were true of the first draft of this
 * script. So coverage gaps and syntax errors are classified out of the
 * findings, tracked on their own ceiling lines, and never traded against real
 * debt. A coverage gap also MASKS a real syntax error — eslint stops at the
 * project error and never parses — so the two must not share a counter.
 *
 * Exit codes: 0 pass, 1 gate failed (commit/push must be blocked), 2 usage.
 * An EMPTY change set exits 0 but says so in full sentences — see reportEmpty().
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import {
  EXTENSIONS,
  filterScopeFiles,
  lintFileList,
  scopeDirs
} from '../scripts/lint/lint-file-list.mjs';
// `../.husky/`, NOT `./`: a gate COPY has to be able to load. `lintFileList` is
// reached the same way (`../scripts/lint/…`) because `tests/unit/lint/lint-file-list-parity.test.ts`
// runs a scratch copy of THIS file from `.tmp/` — one level under the repo root, so
// `<copy dir>/..` is the repo root — to prove its own CONTROL arm goes red. When
// this file grew a sibling helper (repair cycle F5) the copy stopped loading at
// all: `ERR_MODULE_NOT_FOUND` on `.tmp/peaks-gate-file-size.mjs`, exit 1, no output,
// and the control arm failed with "the gate exited (1) before printing its scope
// line" — a guard that cannot be watched failing is a guard that is decoration. The
// copy-safe spelling costs nothing in-tree (`../.husky/x` from `.husky/x` is the
// same file) and is what keeps the enforcement surface copyable. If you are about
// to "clean this up" to `./`, run that parity test first.
import {
  FS_CEILING_KEY,
  FS_CENSUS,
  FS_EXCESS_CEILING_KEY,
  FS_EXCESS_ROW_LABEL,
  FS_ROW_LABEL,
  TSX_CLI,
  describeInputTrips,
  fileSizeInputTrips,
  measureFileSizeOverCap,
  missingFileSizeCeilings,
  parseFileSizeArgv,
  printFileSizeLeg,
  refuseScopedSubset
} from '../.husky/peaks-gate-file-size.mjs';

// Slash-normalised ONCE, at the definition. `resolve()` returns backslashes on
// Windows, so a `p.split('\\').join('/')` path can never match a `${ROOT}/`
// prefix built from it — the first draft of this file did exactly that, and the
// eslint leg silently compared every file against nothing while reporting
// "improved N -> 0 findings". Six of seven injection arms passed anyway. Hence
// also the fail-closed check in stagedMode(): eslint not reporting on a file we
// asked about is an error, never a zero.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  .split('\\')
  .join('/');
const BASELINE_PATH = resolve(ROOT, '.peaks/lint/gate-baseline.json');
const ESLINT_CONFIG = 'config/eslint/.peaks-rules.cjs';
const COVERAGE_GAP = /was not found in any of the provided project/;

const BATCH = 150; // keep argv well under the Windows command-line limit
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
// The scope rule is `scripts/lint/lint-file-list.mjs`, not a copy in this file.
// It used to be a local `CODE_EXT` regex x `baseline.scope.dirs`, i.e. a second
// spelling of the rule `pnpm lint` also measures — and `tests/unit/lint/`
// observed the module, the baseline and `package.json`, but NOTHING observed
// this file's copy. Measured 2026-09-29: cutting the local regex to `ts|tsx`
// made `repo` mode check 1259 files instead of 1298, lose 80 findings, and still
// print `all whole-repo ceilings held` with exit 0. One list, one filter, both
// imported here, is what closes that class;
// `tests/unit/lint/lint-file-list-parity.test.ts` runs THIS file's `repo` mode
// and compares the count it reports against the published rule.
const SCOPE_DIRS = scopeDirs();

// RuleIds the config names but the pinned plugin does not define. ESLint reports
// each one on EVERY parsed file, so they are config bugs, not lint debt: leaving
// them in the findings makes "a NEW file must be clean" unsatisfiable (no new
// file can avoid them) and inflates the ceiling by ~2400. The list comes from
// the baseline, which derives it from the messages rather than hardcoding it.
const PHANTOM_RULES = new Set(baseline.phantomRules ?? []);
const isPhantom = (m) => m.ruleId !== null && PHANTOM_RULES.has(m.ruleId);

const rel = (p) => p.split('\\').join('/').replace(`${ROOT}/`, '');
// Per-path, so `staged` / `changed` keep their own filter step. The list is the
// files ONE commit touches, so calling the batch filter once per path costs
// nothing measurable and keeps one spelling of the rule.
const inScope = (p) => filterScopeFiles([p], SCOPE_DIRS, EXTENSIONS).length === 1;

/** Split eslint messages into the classes the baseline distinguishes. */
function classify(messages) {
  const fatal = messages.filter((m) => m.fatal);
  const nonFatal = messages.filter((m) => !m.fatal);
  const real = nonFatal.filter((m) => !isPhantom(m));
  const coverageGap = fatal.length > 0 && fatal.every((m) => COVERAGE_GAP.test(m.message));
  return {
    findings: real.length,
    errors: real.filter((m) => m.severity === 2).length,
    phantomFindings: nonFatal.length - real.length,
    coverageGap,
    syntaxError: fatal.length > 0 && !coverageGap,
    firstFinding: real[0],
    fatalMessage: fatal[0] ? fatal[0].message.split('\n')[0] : ''
  };
}

/**
 * One eslint process for the whole list: the type-aware program is built once.
 *
 * `--no-ignore` is required, not cosmetic. The config's `ignorePatterns` has
 * `'skills/'`, which ESLint reads the .gitignore way — a trailing slash with no
 * inner slash matches a directory of that name at ANY depth — so 33 files under
 * `src/services/skills/`, `src/skills/` and two test directories were silently
 * skipped and read as "0 findings". Safe here only because `files` is always a
 * list of FILES; with a directory argument this would descend into node_modules.
 */
function runEslint(files) {
  const out = new Map();
  if (files.length === 0) return out;
  for (let i = 0; i < files.length; i += BATCH) {
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
          ...files.slice(i, i + BATCH)
        ],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }
      );
    } catch (err) {
      // eslint exits 1 whenever findings exist; the JSON report is still on stdout.
      raw = err.stdout ?? '';
    }
    if (!raw.trim()) continue;
    for (const f of JSON.parse(raw)) out.set(rel(f.filePath), classify(f.messages));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Config resolution — the failure mode this gate got wrong
// ---------------------------------------------------------------------------
// `prettier.resolveConfig()` returns NULL and does not throw when no config can
// be found. Spreading that null — `{ ...opts }` — yields `{ filepath }`, i.e.
// prettier's DEFAULTS (printWidth 80, double quotes). A file correctly formatted
// under this repo's config then fails the check. Measured 2026-09-19 on the 88
// files the baseline calls prettier-clean: 6 of 6 sampled return `true` with the
// repo config and `false` with `{ ...null }`.
//
// What can make it unresolvable: `scripts/bump-version.mjs` rewrites the root
// `package.json` with `writeFileSync(JSON.stringify(...))` — truncate-then-write,
// not atomic — so a gate run inside that window finds no config anywhere up the
// tree. That is a long-lived, low-probability race, which is exactly the kind of
// failure that shows up once, cannot be reproduced, and destroys trust in the
// gate. It happened once already: this gate reported a clean file as
// "not prettier-formatted" and the cause was not recoverable from the output.
//
// Two consequences, both worse than a false red:
//   1. The advice was destructive. Under defaults `prettier --write` rewrites
//      the file with double quotes — measured 8380 -> 8505 bytes on
//      scripts/dist-freshness.mjs. A dev obeying the gate mangles the file.
//   2. `.husky/peaks-gate-baseline.mjs` spreads the same null, so a run inside
//      the window would record `prettierClean: false` for ALL 1266 files and
//      write that as the ceiling. The ratchet would be poisoned permanently.
//
// So a config that did not resolve is now its own failure class: no `--write`
// advice, and the resolved config is compared against the repo's own declaration
// in package.json — which catches a WRONG config too, not only a missing one.
const DECLARED_PRETTIER = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).prettier;

/** Returns a human-readable problem, or null when the config is the declared one. */
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

/**
 * true = already formatted, false = would be rewritten, throws = unparsable.
 * A config that did not resolve is reported as `{ configProblem }` — NEVER as
 * "false", because under defaults `false` is what a perfect file looks like.
 */
async function prettierCheck(file) {
  const abs = resolve(ROOT, file);
  const resolved = await prettier.resolveConfig(abs, { editorconfig: false });
  const configProblem = prettierConfigProblem(resolved);
  // `configProblem` is ALWAYS present on the returned object, null included.
  // Omitting the key on success made `result.configProblem` read as `undefined`,
  // and `undefined !== null` is TRUE — so every file took the CONFIG UNRESOLVED
  // branch and nothing could ever commit. The sentinel has to be one value, not
  // "null or absent". Caught by running the gate against a healthy tree.
  if (configProblem !== null) return { configProblem, configFailed: true };
  const clean = await prettier.check(readFileSync(abs, 'utf8'), { ...resolved, filepath: abs });
  return { configProblem: null, configFailed: false, clean, resolved };
}

/**
 * An empty change set, said out loud.
 *
 * This used to read "no in-scope files staged, nothing to check." and exit 0.
 * An orchestrator read that as a PASS once — the exit code and the word count
 * were all it looked at. An empty set is LEGAL (a change set really can be
 * empty), so this must not become a failure; but it must also never be
 * mistakable for a verification result, because it is the absence of one. Hence
 * a message that a reader cannot flatten: it names the count, the source, and
 * what did NOT happen. The failure path is separate and shouts differently
 * ("push blocked", exit 1).
 */
function reportEmpty(source) {
  console.log(
    `peaks-gate: EMPTY CHANGE SET (${source}) — 0 in-scope files, NOTHING WAS CHECKED.\n` +
      '  This is neither a pass nor a failure: there was no file to compare against the\n' +
      '  baseline. Zero files checked is not "clean" — it is zero files checked.'
  );
  return 0;
}

// ---------------------------------------------------------------------------
// the per-file comparison — ONE implementation, two file-list sources
// ---------------------------------------------------------------------------
// `staged` and `changed` differ in exactly one thing: where the list of files
// comes from (lint-staged's argv vs. the commits being pushed). Everything
// below — the `baseline.files[file]` lookup, the fail-closed rule when eslint
// says nothing, the "a new file must be clean outright" rule, the prettier
// per-file check — is shared on purpose. Since slice B5 the changed mode is the
// ONLY gate on the push path, so a second implementation of this comparison
// would turn "green under changed, red under repo" from a contradiction into a
// silent possibility. There is one comparison. There are two ways to fill the
// list it runs on.
async function ratchetFiles(files, label) {
  const eslintResults = runEslint(files);
  const failures = [];
  const warnings = [];
  let improved = 0;

  for (const file of files) {
    const allowed = baseline.files[file];
    const actual = eslintResults.get(file);

    // Fail closed. eslint reporting nothing about a file we handed it is an
    // error in this script, not a clean file. The first draft defaulted to
    // "0 findings" here, which turned the whole eslint leg into decoration.
    if (actual === undefined) {
      failures.push(
        `${file} was handed to eslint but eslint reported nothing for it. ` +
          'Refusing to read that as 0 findings.'
      );
    } else if (actual.syntaxError) {
      failures.push(`${file} cannot be parsed: ${actual.fatalMessage}`);
    } else if (actual.coverageGap) {
      warnings.push(
        `${file} was NOT linted — eslint's parserOptions.project does not cover it. ` +
          'This is not a pass; it is a hole. See the eslintCoverageGapFiles ceiling.'
      );
    } else if (allowed === undefined) {
      if (actual.findings > 0) {
        const m = actual.firstFinding;
        failures.push(
          `NEW file ${file} has ${actual.findings} lint finding(s). First: ` +
            `${m.ruleId ?? '(fatal)'} at ${m.line}:${m.column} — ${m.message.split('\n')[0]}`
        );
      }
    } else if (actual.findings > allowed.eslint) {
      failures.push(
        `${file} went from ${allowed.eslint} to ${actual.findings} lint finding(s) ` +
          `(+${actual.findings - allowed.eslint}).`
      );
    } else if (actual.findings < allowed.eslint) {
      improved++;
      console.log(
        `peaks-gate: ${file} improved ${allowed.eslint} -> ${actual.findings} finding(s).`
      );
    }

    let result;
    try {
      result = await prettierCheck(file);
    } catch (err) {
      failures.push(
        `${file} cannot be parsed by prettier: ` +
          `${String(err.cause?.message ?? err.message).split('\n')[0]}`
      );
      continue;
    }

    // A config that did not resolve is NOT "unformatted". Under defaults a
    // perfectly formatted file reads as dirty, and the `--write` advice would
    // rewrite it with double quotes. Fail, say why, and give no advice.
    if (result.configFailed) {
      failures.push(
        `CONFIG UNRESOLVED for ${file}: ${result.configProblem}\n` +
          '      NOT a formatting problem — do not run prettier --write. Under prettier default\n' +
          '      options it would rewrite the file with the wrong style.'
      );
      continue;
    }

    const clean = result.clean;
    const wasClean = allowed?.prettierClean ?? true; // a NEW file is expected to be clean
    if (!clean && wasClean) {
      failures.push(
        `${file} is not prettier-formatted. Run: pnpm exec prettier --write "${file}"\n` +
          `      resolved config: ${JSON.stringify(result.resolved)}`
      );
    }
  }

  for (const w of warnings) console.warn(`peaks-gate: WARNING — ${w}`);

  if (failures.length > 0) {
    console.error(`\npeaks-gate: ${label === 'staged' ? 'commit' : 'push'} blocked.\n`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error(
      '\nThis is a ratchet, not a demand that you clean the whole repo. Files you did\n' +
        'not touch are exempt. A file you DID touch may not get worse, and a new file\n' +
        'must be clean.\nBaseline: .peaks/lint/gate-baseline.json\n'
    );
    return 1;
  }

  console.log(
    `peaks-gate: ${files.length} ${label} file(s) OK (ratchet held${improved > 0 ? `, ${improved} improved` : ''}).`
  );
  return 0;
}

// ---------------------------------------------------------------------------
// staged mode — invoked by lint-staged with the staged file list
// ---------------------------------------------------------------------------
async function stagedMode(argv) {
  const files = argv.map(rel).filter(inScope);
  if (files.length === 0) return reportEmpty('staged');
  return ratchetFiles(files, 'staged');
}

// ---------------------------------------------------------------------------
// changed mode — invoked by pre-push with the diff of the commits being pushed
// ---------------------------------------------------------------------------
// WHY THE PUSH GATE CHECKS CHANGED FILES AND NOT THE WHOLE REPO
// ------------------------------------------------------------
// The whole-repo ratchet is ~9 type-aware eslint programs (each rebuilding the
// TS program) plus a whole-program `tsc`. Measured 2026-09-19 on a healthy
// machine that was ~90s; measured on this host 2026-09-23 it is 8+ minutes.
// A push gate that costs minutes stops being a "check before I push" and starts
// being a thing people skip with `--no-verify` — and a gate that gets skipped is
// worse than no gate, because it is also believed.
//
// The per-file check is not a weaker check. It ENTAILS the whole-repo one:
//
//     every changed file ≤ its own baseline in `.peaks/lint/gate-baseline.json`
//     AND every new file contributes 0
//     AND every deleted file contributes 0
//   ⟹ total = Σ(untouched files' baseline) + Σ(changed files' actual) + 0
//            ≤ Σ(all baselines) ≤ the whole-repo ceiling.
//
// The baseline stores a number PER FILE, so "each file ≤ its own line" is not
// an approximation of the total check — it IS the total check, decomposed. The
// whole-repo run is therefore REDUNDANT FOR THE TOTALS.
//
// What it is not redundant for: growth on a file nobody touched, caused by
// config drift (a rule switched off/on, a phantom rule appearing, a coverage
// hole opening). That class is real, it is rare, it is nobody's commit, and it
// costs minutes — so it belongs in CI, where `.github/workflows/ci.yml` now runs
// `node .husky/peaks-gate.mjs repo` (step "Whole-repo lint ratchet", in the
// `vitest + build` job, right after Build — the tsc leg needs `packages/*/dist`
// and Build is what creates it). Nothing was dropped; the expensive half moved
// to the one place that can afford to pay for it on every push.
//
// The three details below each come from a real failure; none of them is
// defensive decoration.
const CHANGED_BASE_ENV = 'PEAKS_GATE_CHANGED_BASE';
const CHANGED_BASE_DEFAULT = 'origin/main';
// Tried ONLY when the env override is absent. A missing base must never turn
// this gate green: a gate whose answer is "could not measure, so pass" is a
// gate that fails open on exactly the checkouts (fresh clone, no remote) where
// nobody would notice.
const CHANGED_BASE_FALLBACKS = ['@{upstream}', 'main'];

function gitOut(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

/** The commit a ref points at, or null when it does not resolve. */
function revParse(ref) {
  try {
    return gitOut(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim() || null;
  } catch {
    return null; // `--quiet` makes a bad ref a silent exit 1, not a poison message
  }
}

function resolveChangedBase() {
  const override = process.env[CHANGED_BASE_ENV];
  return override ? [override] : [CHANGED_BASE_DEFAULT, ...CHANGED_BASE_FALLBACKS];
}

async function changedMode() {
  const candidates = resolveChangedBase();
  // MEMO: an explicit override gets NO fallback. `PEAKS_GATE_CHANGED_BASE=typo`
  // must fail loudly, not quietly degrade onto `main` — otherwise the switch
  // exists to make the gate unverifiable.
  const base = candidates.map((ref) => ({ ref, sha: revParse(ref) })).find((c) => c.sha !== null);
  if (base === undefined) {
    console.error(
      `peaks-gate: cannot compute the changed set — none of [${candidates.join(', ')}] resolves.\n` +
        '  REFUSING to pass. A gate that goes green because it could not measure is not a gate.\n' +
        '  Fix: `git fetch origin main` (or push the branch to a remote first).\n' +
        `  To point this mode at another ref deliberately: ${CHANGED_BASE_ENV}=<ref>\n`
    );
    return 1;
  }

  const head = revParse('HEAD');
  if (head !== null && base.sha === head) {
    console.error(
      `peaks-gate: ${base.ref} resolves to HEAD (${head.slice(0, 8)}), so the changed set is empty\n` +
        '  by construction. REFUSING to report that as a pass: "nothing to compare" and\n' +
        '  "compared and clean" are different results, and only one of them is evidence.\n' +
        '  and clean" are different results and only one of them is evidence.\n' +
        '  Normally git does not run pre-push when there is nothing to push; if you are\n' +
        '  running the gate by hand, name a base: ' +
        `${CHANGED_BASE_ENV}=<ref> node .husky/peaks-gate.mjs changed\n`
    );
    return 1;
  }

  let raw;
  try {
    // `-c core.quotepath=false`: with git's default, a non-ASCII path is printed
    // C-quoted ("src/a\303\251.ts"), which would then fail BOTH the existence
    // test and the baseline lookup and be reported as a deleted file — i.e. a
    // silent skip dressed up as a legitimate one. The repo's paths are ASCII
    // today; this closes the class rather than relying on that staying true.
    raw = gitOut(['-c', 'core.quotepath=false', 'diff', '--name-only', `${base.ref}...HEAD`]);
  } catch (err) {
    const why = String(err.stderr ?? err.message)
      .trim()
      .split('\n')[0];
    console.error(
      `peaks-gate: git diff ${base.ref}...HEAD failed — cannot compute the changed set.\n` +
        `  ${why}\n` +
        '  REFUSING to pass.\n'
    );
    return 1;
  }

  const listed = raw
    .split('\n')
    .map((l) => rel(l.trim()))
    .filter((l) => l !== '' && inScope(l));

  // DELETED FILES CONTRIBUTE 0 — and must not be handed to eslint.
  //
  // This is not hypothetical: batch B1 deleted a file without staging the
  // deletion, the gate asked eslint about a path that no longer existed, eslint
  // fail-closed on it (correctly — "you asked me about a file and I have nothing
  // to say" is not a license to read 0), and the push was blocked by a false red
  // on a path that contributed nothing to any total. Existence on disk is the
  // test, not `--diff-filter=D`: the git-level filter only sees deletions that
  // were COMMITTED, while a deletion that is still sitting in the working tree
  // is exactly the B1 shape. One filter covers both, and it is printed, so a
  // path dropped by mistake is visible instead of silent.
  //
  // Renames need no special case: with git's default rename detection
  // `--name-only` lists the NEW path (checked against its own baseline line)
  // and not the old one, so a rename is neither a false red nor a skip. Adding
  // `--no-renames` would be worse, not safer — it decomposes every rename into
  // "delete the old path, add the new one", which forces the new path's
  // inherited debt through the "a NEW file must be clean" rule.
  const files = [];
  const missing = [];
  for (const f of listed) {
    if (existsSync(resolve(ROOT, f))) files.push(f);
    else missing.push(f);
  }

  console.log(
    `peaks-gate: changed-file ratchet vs ${base.ref} (${base.sha.slice(0, 8)}) — ` +
      `${files.length} in-scope file(s) in the changed set.`
  );
  if (missing.length > 0) {
    console.log(
      `peaks-gate: ${missing.length} in-scope path(s) in the diff no longer exist on disk ` +
        'and contribute 0 (not handed to eslint):'
    );
    for (const f of missing) console.log(`    - ${f}`);
  }

  if (files.length === 0) return reportEmpty(`changed vs ${base.ref}`);
  return ratchetFiles(files, 'changed');
}

// ---------------------------------------------------------------------------
// the ceiling comparison — ONE row printer for every total
// ---------------------------------------------------------------------------
// Hoisted out of `repoMode` so `silent-warning` mode prints through it too. A
// second copy of this comparison would be exactly the thing this file's history
// warns about: a leg that reads green in one place and red in another.
function makeCheck(failures) {
  return (label, actual, ceiling) => {
    const ok = actual <= ceiling;
    console.log(
      `  ${ok ? '✓' : '✗'} ${label.padEnd(26)} ${String(actual).padStart(6)}   (ceiling ${ceiling})`
    );
    if (!ok) failures.push(`${label}: ${actual} > ceiling ${ceiling} (+${actual - ceiling})`);
  };
}

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
  return { refusal: null, envelope: m.env, controlArm };
}

// ---------------------------------------------------------------------------
// repo mode — invoked by CI
// ---------------------------------------------------------------------------
async function repoMode() {
  // The same list `pnpm lint` lints: `git ls-files` x the published scope, from
  // the one module that owns it. This used to be a local `execFileSync('git',
  // ['ls-files'])…filter(inScope)` with `inScope` built from this file's own
  // `CODE_EXT`, i.e. a second copy that no test read (see the SCOPE_DIRS note).
  const files = lintFileList();

  console.log(`peaks-gate: checking ${files.length} file(s) against the whole-repo ceilings...`);

  let findings = 0;
  let errors = 0;
  let phantomFindings = 0;
  let coverageGapFiles = 0;
  let syntaxErrorFiles = 0;
  let notLinted = 0;
  const lint = runEslint(files);
  for (const file of files) {
    const v = lint.get(file);
    if (v === undefined) {
      notLinted++;
      continue;
    }
    phantomFindings += v.phantomFindings;
    if (v.coverageGap) coverageGapFiles++;
    else if (v.syntaxError) syntaxErrorFiles++;
    else {
      findings += v.findings;
      errors += v.errors;
    }
  }

  let unformatted = 0;
  let configProblem = null;
  const unparsable = [];
  for (const file of files) {
    let result;
    try {
      result = await prettierCheck(file);
    } catch (err) {
      unparsable.push(`${file}: ${String(err.cause?.message ?? err.message).split('\n')[0]}`);
      continue;
    }
    if (result.configFailed) {
      configProblem = `${file}: ${result.configProblem}`;
      break;
    }
    if (!result.clean) unformatted++;
  }

  // Abort rather than report a number. Under an unresolved config every clean
  // file reads as dirty, so the totals below would be ~1266 and would look like
  // a regression the pusher must fix. A wrong measurement is worse than none.
  if (configProblem !== null) {
    console.error(
      `peaks-gate: REFUSING to measure — prettier's config did not resolve.\n  ${configProblem}\n` +
        'The root package.json is the config host; if it is being rewritten right now\n' +
        '(scripts/bump-version.mjs truncates then writes it), re-run in a moment.\n'
    );
    return 1;
  }

  let tscErrors = 0;
  let tscLines = [];
  try {
    execFileSync('node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--noEmit'], {
      cwd: ROOT,
      encoding: 'utf8'
    });
  } catch (err) {
    tscLines = `${err.stdout ?? ''}${err.stderr ?? ''}`
      .split('\n')
      .filter((l) => /error TS\d+/.test(l));
    tscErrors = tscLines.length;
  }

  // `tsc -p tsconfig.json` RESOLVES SUBPATH EXPORTS INTO UNTRACKED BUILD OUTPUT.
  // `peaks-loop-shared/version` and its siblings point at `packages/*/dist`, which
  // no commit contains — that is why ci.yml runs `npm run build` BEFORE any tsc
  // step. This gate skipped that step, so on 2026-09-19 it went red with 7 errors
  // that had nothing to do with the source: a stale `dist/` was missing
  // `version.d.ts`. A bare error count sent the investigation to the wrong place.
  // Detect that shape precisely and say what to do instead of reporting it as a
  // type regression: every error is a module-resolution failure naming an internal
  // workspace package.
  //
  // TWO CODES, NOT ONE — and finding that out cost a failed injection. If the whole
  // build output is absent, tsc says TS2307 (`Cannot find module`). If only the
  // declaration file is missing while the JS is there, it says TS7016 (`Could not
  // find a declaration file for module`). The first draft matched TS2307 only, so
  // the injection that moved a single `.d.ts` sailed past it and the gate reported
  // a bare type regression. The detector has to key on the property — a module
  // path that belongs to this workspace — not on one spelling of the symptom.
  const onlyMissingWorkspaceDist =
    tscErrors > 0 &&
    tscLines.every((l) => /error TS(?:2307|7016)/.test(l) && /'peaks-loop-[^']*'/.test(l));
  if (onlyMissingWorkspaceDist) {
    console.error(
      `\npeaks-gate: REFUSING to report ${tscErrors} error(s) as a type regression.\n` +
        'Every one is a module-resolution failure (TS2307 or TS7016) naming an internal\n' +
        'workspace package, which resolves into untracked `packages/*/dist` output. That\n' +
        'build output is stale or absent — this is an artifact problem, not a source\n' +
        'problem. Run `pnpm build` first, then re-run.\n\n' +
        tscLines.slice(0, 3).join('\n') +
        '\n'
    );
    return 1;
  }

  const c = baseline.ceilings;
  const failures = [];
  const check = makeCheck(failures);

  console.log('');
  check('eslint findings', findings, c.eslintFindings);
  check('  of which errors', errors, c.eslintErrors);
  check('  phantom-rule findings', phantomFindings, c.eslintPhantomFindings);
  check('prettier unformatted', unformatted, c.prettierUnformatted);
  check('tsc errors', tscErrors, c.tscErrors);
  check('never linted', notLinted, c.eslintNotLintedFiles);
  check('unlinted files (config)', coverageGapFiles, c.eslintCoverageGapFiles);
  check('syntax errors', syntaxErrorFiles, c.eslintSyntaxErrorFiles);
  check('unparsable files', unparsable.length, c.prettierUnparsableFiles);
  const sw = silentWarningLeg(check, c, []);
  if (sw.refusal !== null) {
    console.error(`\npeaks-gate: ${sw.refusal}\n`);
    return 1;
  }
  console.log(
    `  scope note: the silent-warning detector scanned ${sw.scannedFiles} file(s) of its own \`src/\` ` +
      `walk, not the ${files.length} files in this gate's scope. Recorded, not reconciled.`
  );
  const size = fileSizeLeg(check, c, []);
  // The measurement is printed WHETHER OR NOT the leg then refuses (repair cycle 2):
  // the run that trips the policy-input binding is exactly the run whose numbers a
  // reader needs. `printFileSizeLeg` returns false on a refusal, which still fails
  // the run with exit 1 — evidence first, verdict second, same exit code.
  if (!printFileSizeLeg(size, c[FS_CEILING_KEY])) return 1;
  console.log('');

  if (unparsable.length > 0) {
    console.log('  unparsable:');
    for (const u of unparsable) console.log(`    - ${u}`);
    console.log('');
  }

  if (failures.length > 0) {
    console.error('peaks-gate: push blocked — a whole-repo total grew.\n');
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error('\nThese total only ever go DOWN. Fix the regression; do not raise a ceiling.\n');
    return 1;
  }

  console.log('peaks-gate: all whole-repo ceilings held.');
  return 0;
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
        `${size.envelope.overCap} over-cap file(s) against ceiling ${ceiling}.\n`
    );
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error('\nThis total only ever goes DOWN. Split the file; do not raise the ceiling.\n');
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

  console.log(`peaks-gate: file-size ceiling held (${size.envelope.overCap} file(s) over cap).`);
  return 0;
}

// ---------------------------------------------------------------------------
const mode = process.argv[2];
const code =
  mode === 'staged'
    ? await stagedMode(process.argv.slice(3))
    : mode === 'changed'
      ? await changedMode()
      : mode === 'repo'
        ? await repoMode()
        : mode === 'silent-warning'
          ? await silentWarningMode(process.argv.slice(3))
          : mode === 'file-size'
            ? fileSizeMode(process.argv.slice(3))
            : (console.error(
                'usage: peaks-gate.mjs <staged|changed|repo|silent-warning|file-size> ' +
                  '[--control-arm] [files...]'
              ),
              2);
process.exit(code);

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
 *   staged mode — a file you touch may not be WORSE than it was; a file that
 *                 did not exist before must be clean outright.
 *   repo mode   — the whole-repo totals may not grow.
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
 * Exit codes: 0 pass, 1 gate failed (commit/push must be blocked).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

// Slash-normalised ONCE, at the definition. `resolve()` returns backslashes on
// Windows, so a `p.split('\\').join('/')` path can never match a `${ROOT}/`
// prefix built from it — the first draft of this file did exactly that, and the
// eslint leg silently compared every file against nothing while reporting
// "improved N -> 0 findings". Six of seven injection arms passed anyway. Hence
// also the fail-closed check in stagedMode(): eslint not reporting on a file we
// asked about is an error, never a zero.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..').split('\\').join('/');
const BASELINE_PATH = resolve(ROOT, '.peaks/lint/gate-baseline.json');
const ESLINT_CONFIG = 'config/eslint/.peaks-rules.cjs';
const CODE_EXT = /\.(ts|tsx|mts|cts|mjs|cjs|js)$/;
const COVERAGE_GAP = /was not found in any of the provided project/;

const BATCH = 150; // keep argv well under the Windows command-line limit
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const SCOPE_DIRS = baseline.scope.dirs;

// RuleIds the config names but the pinned plugin does not define. ESLint reports
// each one on EVERY parsed file, so they are config bugs, not lint debt: leaving
// them in the findings makes "a NEW file must be clean" unsatisfiable (no new
// file can avoid them) and inflates the ceiling by ~2400. The list comes from
// the baseline, which derives it from the messages rather than hardcoding it.
const PHANTOM_RULES = new Set(baseline.phantomRules ?? []);
const isPhantom = (m) => m.ruleId !== null && PHANTOM_RULES.has(m.ruleId);

const rel = (p) => p.split('\\').join('/').replace(`${ROOT}/`, '');
const inScope = (p) => CODE_EXT.test(p) && SCOPE_DIRS.some((d) => p.startsWith(`${d}/`));

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

/** true = already formatted, false = would be rewritten, throws = unparsable. */
async function prettierClean(file) {
  const abs = resolve(ROOT, file);
  const opts = await prettier.resolveConfig(abs, { editorconfig: false });
  return prettier.check(readFileSync(abs, 'utf8'), { ...opts, filepath: abs });
}

// ---------------------------------------------------------------------------
// staged mode — invoked by lint-staged with the staged file list
// ---------------------------------------------------------------------------
async function stagedMode(argv) {
  const files = argv.map(rel).filter(inScope);
  if (files.length === 0) {
    console.log('peaks-gate: no in-scope files staged, nothing to check.');
    return 0;
  }

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
      console.log(`peaks-gate: ${file} improved ${allowed.eslint} -> ${actual.findings} finding(s).`);
    }

    let clean;
    try {
      clean = await prettierClean(file);
    } catch (err) {
      failures.push(
        `${file} cannot be parsed by prettier: ` +
          `${String(err.cause?.message ?? err.message).split('\n')[0]}`
      );
      continue;
    }
    const wasClean = allowed?.prettierClean ?? true; // a NEW file is expected to be clean
    if (!clean && wasClean) {
      failures.push(`${file} is not prettier-formatted. Run: pnpm exec prettier --write "${file}"`);
    }
  }

  for (const w of warnings) console.warn(`peaks-gate: WARNING — ${w}`);

  if (failures.length > 0) {
    console.error('\npeaks-gate: commit blocked.\n');
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error(
      '\nThis is a ratchet, not a demand that you clean the whole repo. Files you did\n' +
        'not touch are exempt. A file you DID touch may not get worse, and a new file\n' +
        'must be clean.\nBaseline: .peaks/lint/gate-baseline.json\n'
    );
    return 1;
  }

  console.log(
    `peaks-gate: ${files.length} staged file(s) OK (ratchet held${improved > 0 ? `, ${improved} improved` : ''}).`
  );
  return 0;
}

// ---------------------------------------------------------------------------
// repo mode — invoked by pre-push
// ---------------------------------------------------------------------------
async function repoMode() {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(inScope);

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
  const unparsable = [];
  for (const file of files) {
    let clean;
    try {
      clean = await prettierClean(file);
    } catch (err) {
      unparsable.push(`${file}: ${String(err.cause?.message ?? err.message).split('\n')[0]}`);
      continue;
    }
    if (!clean) unformatted++;
  }

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

  const c = baseline.ceilings;
  const failures = [];
  const check = (label, actual, ceiling) => {
    const ok = actual <= ceiling;
    console.log(
      `  ${ok ? '✓' : '✗'} ${label.padEnd(26)} ${String(actual).padStart(6)}   (ceiling ${ceiling})`
    );
    if (!ok) failures.push(`${label}: ${actual} > ceiling ${ceiling} (+${actual - ceiling})`);
  };

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
const mode = process.argv[2];
const code =
  mode === 'staged'
    ? await stagedMode(process.argv.slice(3))
    : mode === 'repo'
      ? await repoMode()
      : (console.error('usage: peaks-gate.mjs <staged|repo> [files...]'), 2);
process.exit(code);

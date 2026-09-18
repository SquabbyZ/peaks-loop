#!/usr/bin/env node
/**
 * Regenerates .peaks/lint/gate-baseline.json — the ceilings the husky gate
 * ratchets against. Run it after a cleanup slice has landed, to lower a
 * ceiling to the new measured value:
 *
 *   node .husky/peaks-gate-baseline.mjs
 *
 * It measures, it never guesses: every number written here is read off the
 * tools in this run. Read the diff before committing it — a ceiling that went
 * UP is the one thing this file must never contain, and only a human reading
 * the diff can catch that. The gate itself enforces it after the fact
 * (pre-push fails if a total grew).
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
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

// Slash-normalised once, at the definition — `resolve()` returns backslashes on
// Windows and a `${ROOT}/` built from that can never match a normalised path.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..').split('\\').join('/');
const OUT_PATH = resolve(ROOT, '.peaks/lint/gate-baseline.json');
const ESLINT_CONFIG = 'config/eslint/.peaks-rules.cjs';
const CODE_EXT = /\.(ts|tsx|mts|cts|mjs|cjs|js)$/;
const TOP_DIRS = ['src', 'tests', 'packages', 'scripts'];
const COVERAGE_GAP = /was not found in any of the provided project/;
const PHANTOM_DEF = /Definition for rule '(.+)' was not found/;
const BATCH = 150; // argv stays well under the Windows command-line limit

const rel = (p) => p.split('\\').join('/').replace(`${ROOT}/`, '');

// ---- scope -----------------------------------------------------------------
const scope = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
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
for (const file of scope) {
  const abs = resolve(ROOT, file);
  let src;
  try {
    src = readFileSync(abs, 'utf8');
  } catch {
    continue;
  }
  const opts = await prettier.resolveConfig(abs, { editorconfig: false });
  try {
    const clean = await prettier.check(src, { ...opts, filepath: abs });
    prettierCleanByFile[file] = clean;
    if (!clean) prettierDirty++;
  } catch (err) {
    unparsable.push({ file, reason: String(err.cause?.message ?? err.message).split('\n')[0] });
    prettierCleanByFile[file] = false;
  }
}
console.error(`prettier: ${prettierDirty} of ${scope.length} unformatted; ${unparsable.length} unparsable`);
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
      ceilings: {
        eslintFindings: findings,
        eslintErrors: errors,
        eslintPhantomFindings: phantomFindings,
        eslintCoverageGapFiles: coverageGapFiles.length,
        eslintSyntaxErrorFiles: syntaxErrorFiles.length,
        eslintNotLintedFiles: notLinted.length,
        prettierUnformatted: prettierDirty,
        prettierUnparsableFiles: unparsable.length,
        tscErrors
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

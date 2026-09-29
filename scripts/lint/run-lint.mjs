#!/usr/bin/env node
/**
 * `pnpm lint` — eslint over the file set the push is actually judged by.
 *
 * WHY A SCRIPT AND NOT AN ESLINT COMMAND LINE
 * ------------------------------------------
 * The property a developer needs from `pnpm lint` is: the number I see is the
 * number the gate sees. That is only true if both run eslint over the SAME
 * explicit file list, and a list of 1298 paths cannot be spelled in a
 * `package.json` script. So the list comes from `./lint-file-list.mjs` (the one
 * source of truth) and this file only batches and reports.
 *
 * Two details are inherited from `.husky/peaks-gate.mjs` because they change the
 * NUMBER, not just the speed:
 *   - `--no-ignore`: the config's `ignorePatterns` is read the .gitignore way, so
 *     without it a same-named directory at any depth is swallowed and reports
 *     "0 findings" without ever being parsed. Safe to combine with an explicit
 *     list precisely because every argument is a FILE.
 *   - the 150-file batch: one eslint process per batch keeps argv under the
 *     Windows command-line limit. CI runs on ubuntu, the dev host is win32.
 *
 * The totals exclude the same three classes the gate excludes — findings from
 * ruleIds the pinned plugin does not define (config bugs, not debt), files eslint
 * could not parse, and files that belong to no TS project (a hole, not a result).
 * Counting either artifact as lint debt would let a config bug inflate the number
 * a developer is told to fix.
 *
 * Exit codes: 0 no error-severity finding, 1 findings at error severity (eslint's
 * own default), 2 eslint could not run — which is never reported as "clean".
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintFileList } from './lint-file-list.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ESLINT_CONFIG = 'config/eslint/.peaks-rules.cjs';
const ESLINT_BIN = 'node_modules/eslint/bin/eslint.js';
const BATCH = 150; // keep argv well under the Windows command-line limit
// 512 MB — the same ceiling `.husky/peaks-gate.mjs` gives its eslint runs. The
// option exists so a big JSON report cannot kill the child mid-read and leave
// this script reporting nothing; the report for one batch is a few hundred KB.
const MAX_BUFFER_BYTES = 536870912;
const COVERAGE_GAP = /was not found in any of the provided project/;
const baseline = JSON.parse(readFileSync(resolve(ROOT, '.peaks/lint/gate-baseline.json'), 'utf8'));
const PHANTOM_RULES = new Set(baseline.phantomRules ?? []);

/** Absolute path in, repo-relative forward-slash path out — as the gate does. */
const rel = (p) =>
  p
    .split('\\')
    .join('/')
    .replace(`${ROOT.split('\\').join('/')}/`, '');

/**
 * One eslint process over one batch, JSON on stdout.
 *
 * The CLI is used rather than the Node API on purpose: the coverage-gap message
 * only takes this shape through the CLI (`inferSingleRun`), and the gate's
 * classifier keys on it. A second spelling of the same rule would drift.
 */
function eslintBatch(files) {
  let raw;
  try {
    raw = execFileSync(
      'node',
      [ESLINT_BIN, '--config', ESLINT_CONFIG, '--no-ignore', '--format', 'json', ...files],
      {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: MAX_BUFFER_BYTES,
        windowsHide: true
      }
    );
  } catch (err) {
    // eslint exits 1 whenever findings exist; the JSON report is still on stdout.
    raw = err.stdout ?? '';
    if (!raw.trim()) {
      // No report at all means eslint did not run (bad config, crash). Saying
      // "0 findings" here would be the one exit path that lies.
      console.error(`peaks-lint: eslint could not run over ${files.length} file(s).`);
      console.error(String(err.stderr ?? err.message).trim());
      process.exit(2);
    }
  }
  return raw.trim() ? JSON.parse(raw) : [];
}

/** The classes the baseline distinguishes, for one file's messages. */
function classify(messages) {
  const fatal = messages.filter((m) => m.fatal);
  const real = messages.filter(
    (m) => !m.fatal && !(m.ruleId !== null && PHANTOM_RULES.has(m.ruleId))
  );
  const coverageGap = fatal.length > 0 && fatal.every((m) => COVERAGE_GAP.test(m.message));
  return {
    real,
    phantom: messages.length - fatal.length - real.length,
    coverageGap,
    syntaxError: fatal.length > 0 && !coverageGap,
    fatalMessage: fatal[0] ? fatal[0].message.split('\n')[0] : ''
  };
}

const files = lintFileList();
console.log(
  `peaks-lint: ${files.length} file(s) in scope (git ls-files x the published gate scope), ` +
    `--no-ignore, ${BATCH} per eslint process.`
);

const totals = { findings: 0, errors: 0, phantom: 0, coverageGapFiles: 0, syntaxErrorFiles: 0 };
const skipped = [];
for (let i = 0; i < files.length; i += BATCH) {
  const results = eslintBatch(files.slice(i, i + BATCH));
  const reported = new Set(results.map((r) => rel(r.filePath)));
  for (const file of files.slice(i, i + BATCH)) {
    if (!reported.has(file)) skipped.push(file);
  }
  for (const result of results) {
    const v = classify(result.messages);
    if (v.coverageGap) {
      totals.coverageGapFiles++;
      continue; // a hole is not a lint result
    }
    if (v.syntaxError) {
      totals.syntaxErrorFiles++;
      console.error(`\n${rel(result.filePath)} cannot be parsed: ${v.fatalMessage}`);
      continue;
    }
    if (v.real.length === 0) continue;
    console.log(`\n${rel(result.filePath)}`);
    for (const m of v.real) {
      totals.errors += m.severity === 2 ? 1 : 0;
      console.log(
        `  ${m.line}:${m.column}  ${m.severity === 2 ? 'error' : 'warning'}  ${m.message}  ${m.ruleId ?? ''}`.trimEnd()
      );
    }
    totals.findings += v.real.length;
    totals.phantom += v.phantom;
  }
}

const warnings = totals.findings - totals.errors;
console.log(`\n✖  ${totals.findings} problems (${totals.errors} errors, ${warnings} warnings)`);

// Printed only when non-zero: these are config / coverage numbers, and mixing
// them into the line above is how a developer ends up "fixing" a rule that does
// not exist in the pinned plugin.
const excluded = [
  totals.phantom > 0 ? `${totals.phantom} phantom-rule finding(s)` : null,
  totals.coverageGapFiles > 0 ? `${totals.coverageGapFiles} file(s) belong to no TS project` : null,
  totals.syntaxErrorFiles > 0 ? `${totals.syntaxErrorFiles} unparsable file(s)` : null,
  skipped.length > 0 ? `${skipped.length} file(s) eslint reported nothing about` : null
].filter((s) => s !== null);
if (excluded.length > 0) {
  console.log(`   excluded from the totals above: ${excluded.join(', ')}`);
  for (const file of skipped) console.log(`   not linted: ${file}`);
}

process.exit(totals.errors > 0 ? 1 : 0);

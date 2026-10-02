// .husky/gate/eslint.mjs
// The eslint leg: the config and coverage-gap constants, the phantom-rule set the
// baseline derives, `classify`, and the one batched eslint process both per-file modes
// and `repo` mode run through. Hoisted VERBATIM out of `.husky/peaks-gate.mjs` by rid
// `2026-10-02-wave9-gate-entry-split`.

import { execFileSync } from 'node:child_process';
import { ROOT, baseline, rel } from './context.mjs';

const ESLINT_CONFIG = 'config/eslint/.peaks-rules.cjs';
const COVERAGE_GAP = /was not found in any of the provided project/;

const BATCH = 150; // keep argv well under the Windows command-line limit
// RuleIds the config names but the pinned plugin does not define. ESLint reports
// each one on EVERY parsed file, so they are config bugs, not lint debt: leaving
// them in the findings makes "a NEW file must be clean" unsatisfiable (no new
// file can avoid them) and inflates the ceiling by ~2400. The list comes from
// the baseline, which derives it from the messages rather than hardcoding it.
const PHANTOM_RULES = new Set(baseline.phantomRules ?? []);
const isPhantom = (m) => m.ruleId !== null && PHANTOM_RULES.has(m.ruleId);
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

export { runEslint, classify, isPhantom };

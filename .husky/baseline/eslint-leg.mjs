/**
 * `.husky/baseline/eslint-leg.mjs` — the eslint batches, the phantom-rule
 * derivation and the classification tally (rid
 * `2026-10-02-wave9-generator-split`, HEAD lines 334–412 wrapped as
 * `measureEslintLeg({ scope })`).
 *
 * `classify` leaves as a CLOSURE, not as a reformulated function: HEAD's
 * `const classify = (messages) => …` reads the `phantomRules` set the same region
 * fills, and the artifact assembly calls it again per file. Returning the pair
 * keeps both call sites byte-for-byte HEAD's and keeps the set it closes over out
 * of reach of a caller that might refill it.
 */
import { execFileSync } from 'node:child_process';

import { BATCH, COVERAGE_GAP, ESLINT_CONFIG, PHANTOM_DEF, ROOT, rel } from './paths.mjs';

/** Every row the eslint block produced, in one record; the prints stay here. */
export function measureEslintLeg({ scope }) {
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
  return {
    messagesByFile,
    phantomRules,
    classify,
    findings,
    errors,
    phantomFindings,
    coverageGapFiles,
    syntaxErrorFiles,
    notLinted
  };
}

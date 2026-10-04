// .husky/gate/repo.mjs
// Repo mode — the whole-repo ratchet CI runs. It takes the file list as an
// argument instead of computing it, because the list is the ENTRY's decision:
// `tests/unit/lint/lint-file-list-parity.test.ts` copies the entry to `.tmp/` and
// weakens its `const files = lintFileList();` line to prove the scope check can go
// red, and a single-file copy cannot reach a sibling that no longer contains it.

import { execFileSync } from 'node:child_process';
import { ROOT, baseline, makeCheck } from './context.mjs';
import { runEslint } from './eslint.mjs';
import { prettierCheck } from './prettier.mjs';
import { commentHygieneLeg } from './comment-hygiene.mjs';
import { silentWarningLeg, fileSizeLeg } from './legs.mjs';
import { FS_CEILING_KEY, printFileSizeLeg } from '../../.husky/peaks-gate-file-size.mjs';

// ---------------------------------------------------------------------------
// repo mode — invoked by CI
// ---------------------------------------------------------------------------
async function repoMode(files) {
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
  const sw = silentWarningLeg(check, c, files);
  if (sw.refusal !== null) {
    console.error(`\npeaks-gate: ${sw.refusal}\n`);
    return 1;
  }
  // THE POPULATION, SAID AS AN EQUALITY (rid `2026-10-03-silent-warning-scope`).
  // This line used to read `the silent-warning detector scanned 905 file(s) of its
  // own \`src/\` walk, not the 943 files in this gate's scope. Recorded, not
  // reconciled.` — two numbers on one screen, neither of them an error, and the 38
  // files it waved away were `packages/*/src`, where 17 real swallows sat uncounted
  // while this footnote stayed polite. The leg now measures the SAME tracked list
  // every row above measures and refuses if the counts disagree; §2.41's rule
  // applied to the last leg that did not follow it.
  console.log(`  ${sw.line}`);
  // THE COMMENT ROWS, over the same tracked list as every row above. Refusing here is
  // deliberate: a comment-debt number that could not be measured must not sit beside a
  // green run, because "0 dead references" and "the detector did not run" look identical
  // in an output nobody reads closely — the exact failure the widened probe produced when
  // it took the count to 0 and the suite stayed healthy.
  const ch = commentHygieneLeg(check, c, files);
  if (ch.refusal !== null) {
    console.error(`\npeaks-gate: ${ch.refusal}\n`);
    return 1;
  }
  console.log(`  ${ch.line}`);
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

export { repoMode };

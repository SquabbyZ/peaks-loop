// .husky/gate/ratchet.mjs
// The per-file comparison — ONE implementation, two file-list sources. Hoisted
// VERBATIM out of `.husky/peaks-gate.mjs` by rid `2026-10-02-wave9-gate-entry-split`.

import { baseline } from './context.mjs';
import { runEslint } from './eslint.mjs';
import { prettierCheck } from './prettier.mjs';

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

export { ratchetFiles };

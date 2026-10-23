// .husky/gate/wide-format.mjs
// THE WIDE FORMATTING CHECK, AT COMMIT TIME, OVER THE STAGED FILES ONLY.
//
// THE DEFECT THIS CLOSES (measured three times in one slice, 2026-10-23). Three
// files reached a commit UNFORMATTED while every commit-time gate was green, and
// the push gate's format ratchet (`.husky/pre-push` leg 1) refused the push each
// time — the author had to amend and re-push. The commit gate dropped those
// files before any check ran: `tests/**` is outside the lint scope (owner
// decision 2026-10-03), so `.husky/gate/context.mjs` `outOfScopeNotice` removed
// them from the list the per-file ratchet was handed.
//
// WHAT THIS IS, AND WHAT IT IS NOT. It is the WIDE check's own rule —
// "prettier-clean" — applied to the staged files the lint scope drops. It is NOT
// the per-file ratchet and it does NOT widen it: the lint scope, the eslint leg,
// the per-file baseline rows and the per-file prettier comparison are exactly as
// the owner decided on 2026-10-03. The owner's recorded objection (the design
// block in `.husky/pre-commit`) was that a PER-FILE ratchet "can only cover files
// that HAVE a baseline row". This check has no row and needs none: the wide
// check's allowed set (`FORMAT_CHECK_BASELINE_FILES` in
// `.husky/format-check-ratchet.mjs`) is EMPTY and may only shrink, so its rule
// over its four globs is literally "no unformatted file at all". The two
// mechanisms differ in KIND, not only in coverage — the distinction the owner's
// own design block already drew ("they differ in WHICH files they watch, not in
// what KIND of check they are").
//
// THE POPULATION IS EXACTLY: staged files that are OUTSIDE the lint scope and
// INSIDE the wide globs. A staged file inside the lint scope is NOT measured
// here — the per-file ratchet already compares it against its own row, and
// measuring it a second time would change what the per-file ratchet means (a row
// that says `prettierClean: false` may keep a file unformatted; the wide rule
// may not). That exclusion is what keeps the owner's 2026-10-03 decision intact.
//
// THE SCOPE IS SOURCED, NOT RESTATED. The four globs are read from
// `package.json#scripts['format:check']` by the SAME reader the CI job's
// ratchet uses (`.husky/format-check-ratchet.mjs` -> `readCheckGlobs`). A second
// copied glob list here would be the §2.28 shape: a scope spelled twice with
// nothing observing that the two spellings agree.
//
// STAGED FILES ONLY. The whole-tree version is the CI job's (the `format-check`
// job of .github/workflows/ci.yml) and the push gate's leg 1; running it here
// would make every commit pay for the tree.
//
// THE MEASUREMENT IS THE SAME PRETTIER. `.husky/gate/prettier.mjs` `prettierCheck`
// resolves the repository's own config and treats an unresolvable config as its
// own failure class — under prettier's defaults a clean file reads as dirty, so
// "unformatted" must never be inferred from a missing config.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import picomatch from 'picomatch';

import { ROOT, inScope } from './context.mjs';
import { prettierCheck } from './prettier.mjs';
import { readCheckGlobs } from '../../.husky/format-check-ratchet.mjs';

/**
 * The wide scope: the globs, read from the script that owns them, and the matcher
 * built from them. THROWS when the scope cannot be derived — a check whose scope
 * cannot be read must refuse, never quietly measure nothing.
 */
function wideScope() {
  const globs = readCheckGlobs();
  // picomatch is the engine fast-glob (and therefore prettier's own glob
  // expansion) uses, so "is this path inside the wide scope" is answered by the
  // SAME matcher that decides which files the CI job measures.
  return { globs, matches: picomatch(globs) };
}

/** The staged files this leg measures: outside the lint scope, inside the wide one. */
function wideSubject(files, matches) {
  return files.filter((file) => !inScope(file) && matches(file));
}

/**
 * The measurement line. It says how many of the staged files fell inside the wide
 * scope, which of those were read, and how many of them are not prettier-clean —
 * so "no file was format-checked", "one file was format-checked and it was
 * clean" and "one file was format-checked and it was dirty" are three different
 * sentences, and the line is never a verdict the refusal contradicts.
 */
function describeRun(total, subject, present, gone, unformatted) {
  const head =
    `wide formatting check — ${subject.length} of the ${total} staged file(s) are in this ` +
    "leg's scope: inside the wide format scope (package.json scripts.format:check) and " +
    'outside the lint scope.';
  if (present.length === 0) {
    const why =
      gone > 0
        ? `${gone} of them ${gone === 1 ? 'is' : 'are'} gone from disk and could not be read.`
        : 'The lint scope and the wide format scope cover this change set between them.';
    return `${head}\n  no file was format-checked: ${why}`;
  }
  const verdict =
    unformatted.length === 0
      ? 'all prettier-clean'
      : `${unformatted.length} of ${present.length} not prettier-formatted`;
  return `${head}\n  compared: ${present.join(', ')} — ${verdict}.`;
}

/**
 * The leg. Returns `{ line, refusal }`: `line` is always the measurement (so the
 * evidence is printed even when the verdict is a refusal), `refusal` is the block
 * the caller turns into exit 1. `compared` names the files that were read, so the
 * caller can tell "compared and clean" from "nothing was there to compare".
 */
export async function wideFormatLeg(files) {
  let scope;
  try {
    scope = wideScope();
  } catch (err) {
    return {
      line: null,
      compared: [],
      refusal:
        `REFUSING to measure the wide formatting check — ${String(err.message)}\n` +
        '  The wide scope is read from package.json scripts.format:check, and a scope that\n' +
        '  cannot be read is not an empty scope: "nothing to check" and "checked and clean"\n' +
        '  look identical in an exit code.\n' +
        '  Restore the script:  "format:check": "prettier --check <globs>"'
    };
  }

  const subject = wideSubject(files, scope.matches);
  const present = subject.filter((file) => existsSync(resolve(ROOT, file)));
  const gone = subject.length - present.length;

  const unformatted = [];
  const failed = [];
  for (const file of present) {
    let result;
    try {
      result = await prettierCheck(file);
    } catch (err) {
      failed.push(
        `${file} could not be read by prettier: ` +
          `${String(err.cause?.message ?? err.message).split('\n')[0]}`
      );
      continue;
    }
    // A config that did not resolve is NOT "unformatted". Under prettier's defaults
    // a perfectly formatted file reads as dirty, and the `--write` advice would
    // rewrite it with the wrong style.
    if (result.configFailed) {
      failed.push(
        `CONFIG UNRESOLVED for ${file}: ${result.configProblem}\n` +
          '      NOT a formatting problem — do not run prettier --write.'
      );
      continue;
    }
    if (!result.clean) unformatted.push(file);
  }

  const line = describeRun(files.length, subject, present, gone, unformatted);
  if (failed.length === 0 && unformatted.length === 0) {
    return { line, compared: present, refusal: null };
  }

  const parts = [];
  if (unformatted.length > 0) {
    parts.push(
      `${unformatted.length} staged file(s) inside the wide format scope are not ` +
        'prettier-formatted:'
    );
    for (const file of unformatted) {
      parts.push(`  ✗ ${file}`);
      parts.push(`      Fix: pnpm exec prettier --write "${file}"`);
    }
  }
  if (failed.length > 0) {
    parts.push(`${failed.length} staged file(s) could not be measured:`);
    for (const why of failed) parts.push(`  ✗ ${why}`);
  }
  parts.push(
    'The wide format scope is package.json scripts.format:check:',
    `  ${scope.globs.join(' ')}`
  );
  parts.push(
    'This is the WIDE check (prettier-clean, no baseline row), not the per-file ratchet:',
    'the file is outside the lint scope, so the per-file ratchet never compared it. The',
    'lint scope itself is unchanged (owner decision 2026-10-03), and the eslint leg is',
    'not widened by this one.'
  );
  return { line, compared: present, refusal: parts.join('\n') };
}

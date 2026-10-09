#!/usr/bin/env node
/**
 * `.husky/format-check-ratchet.mjs` — the WIDE formatting check as a SET RATCHET.
 *
 * WHY A RATCHET AND NOT `pnpm format:check`. `format:check` is a whole-tree
 * BOOLEAN: it exits 1 the moment ANY file differs, so a CI step running it on a
 * tree with pre-existing unformatted files is RED ON ARRIVAL and stays red until
 * someone formats every one of them — debt that is not this job's to own. A job
 * that is permanently red teaches everyone to ignore it, which is the failure
 * mode this check exists to end: nine unformatted files reached a commit with
 * every gate green (docs/superpowers/specs/2026-10-09-post-mcp-current-state-roadmap.md
 * §2 W2). This is the same posture as every ceiling in this repository, and
 * `.husky/peaks-gate.mjs` states it in as many words: "This is a ratchet, not a
 * demand that you clean the whole repo."
 *
 * THE ASSERTION IS SET CONTAINMENT, NOT A COUNT.
 * `FORMAT_CHECK_BASELINE_FILES` below NAMES the files that were already
 * unformatted when this ratchet went in, and the rule is:
 *
 *     the CURRENT unformatted set must be a SUBSET of that allowed set.
 *
 * Any unformatted file OUTSIDE the set is RED and is named. A count cannot make
 * this claim. Under `count <= N`, cleaning one old file and adding one new one
 * leaves the count unchanged — still green — while the script prints "no new
 * unformatted file", i.e. it says something FALSE in exactly the case the check
 * exists to catch. Containment fixes that in both directions: cleaning an old
 * file SHRINKS the current set (still a subset → green, correct), and adding a
 * new one puts a name OUTSIDE the set (red, correct).
 *
 * THE ALLOWED SET MAY ONLY SHRINK. When the debt falls, remove the cleaned names
 * from the set and re-point it at the current set; NEVER add a name to silence a
 * breach. Adding a name is how a ratchet becomes a permission.
 *
 * THE SCOPE IS SOURCED, NOT RESTATED. The four globs live in
 * `package.json#scripts['format:check']`; this script reads them from there and
 * runs prettier over exactly that set, in `--list-different` form so the result
 * is a list of NAMES rather than a human sentence. A second, copied glob list
 * here would be a second spelling of the scope that nothing observes — the
 * §2.28 shape that produced the original unrun check.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), '..');
const FORMAT_SCRIPT = 'format:check';

// ---------------------------------------------------------------------------
// THE ALLOWED SET — the ONE place these names live. These 12 files were already
// unformatted when this ratchet went in (prettier --check, 2026-10-09), measured
// BEFORE the rid-038 slice and NOT introduced by it. The rule above applies:
// containment, not a count. This is PRE-EXISTING DEBT, not a target and not a
// permission: the check reports the debt and blocks only its GROWTH. It is
// deliberately not empty, because a demand to format all 12 would be red on
// arrival and would be the whole-repo cleanup the gate's own header refuses to
// demand. Exported so the ratchet's own test re-derives these names rather than
// restating them (a second copy of a list is the drift this file exists to end).
// ---------------------------------------------------------------------------
export const FORMAT_CHECK_BASELINE_FILES = Object.freeze([
  'tests/unit/cli/node-floor.test.ts',
  'tests/unit/comments/comment-scan-parity.test.ts',
  'tests/unit/lint/baseline-rescope-guard.test.ts',
  'tests/unit/lint/baseline-scope-growth-vs-shrink.test.ts',
  'tests/unit/lint/baseline-scope-population-set.test.ts',
  'tests/unit/lint/file-size-excess-gate-leg.test.ts',
  'tests/unit/lint/gate-scope-exemption.test.ts',
  'tests/unit/lint/lint-file-list-parity.test.ts',
  'tests/unit/lint/lint-scope-rule.test.ts',
  'tests/unit/lint/shadow-move-warning.test.ts',
  'tests/unit/standards/_scope-shadow-coverage.ts',
  'tests/unit/standards/scope-shadow-coverage.test.ts'
]);

/** A configuration problem (exit 2), the same usage code the gate uses. */
function refuse(message) {
  console.error(`format-check-ratchet: ${message}`);
  process.exit(2);
}

/** The four globs, read from the script that owns them. */
function checkGlobs() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  const script = pkg.scripts?.[FORMAT_SCRIPT];
  if (typeof script !== 'string') {
    refuse(
      `package.json declares no scripts.${FORMAT_SCRIPT}, so this ratchet has no scope to ` +
        'measure. It reads the globs from that script rather than restating them.'
    );
  }
  // Assert the SHAPE, so a rewritten script is a loud refusal instead of a
  // prettier invocation over the wrong (or no) arguments. Bare and double-quoted
  // tokens are both accepted, so quoting the globs differently is not a refusal.
  const match = /^prettier\s+--check\s+(.+)$/.exec(script.trim());
  if (match === null) {
    refuse(
      `scripts.${FORMAT_SCRIPT} is ${JSON.stringify(script)}, which is not ` +
        '"prettier --check <globs>" — this ratchet cannot derive its scope from it.'
    );
  }
  const tokens = match[1].match(/"[^"]*"|\S+/g) ?? [];
  const globs = tokens.map((token) => token.replace(/^"|"$/g, ''));
  if (globs.length === 0)
    refuse(`scripts.${FORMAT_SCRIPT} names no globs: ${JSON.stringify(script)}`);
  return globs;
}

/** The differing files, one per line. prettier exits 1 when any differ. */
function listDifferent(globs) {
  const bin = require.resolve('prettier/bin/prettier.cjs');
  try {
    return execFileSync(process.execPath, [bin, '--list-different', ...globs], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    // Exit 1 is the measured answer ("some files differ"); anything else is a
    // failure to measure, and a failure to measure must never read as a pass.
    if (err.status === 1 && typeof err.stdout === 'string') return err.stdout;
    refuse(
      `prettier could not be run over the ${FORMAT_SCRIPT} globs (exit ${err.status ?? '?'}): ` +
        `${String(err.stderr ?? '').trim() || err.message}`
    );
  }
}

/** The measured unformatted NAMES, normalised to `/` (prettier's own spelling). */
function unformattedFiles() {
  return listDifferent(checkGlobs())
    .split('\n')
    .map((line) => line.trim().split('\\').join('/'))
    .filter((line) => line !== '');
}

/** The set-containment comparison this file exists to make. Never silently passes. */
function main() {
  const files = unformattedFiles();
  const allowed = new Set(FORMAT_CHECK_BASELINE_FILES);
  const present = new Set(files);
  const outside = files.filter((file) => !allowed.has(file));
  const cleaned = FORMAT_CHECK_BASELINE_FILES.filter((file) => !present.has(file));

  console.log(
    `format-check-ratchet: ${files.length} unformatted file(s); the baseline is a SET of ` +
      `${FORMAT_CHECK_BASELINE_FILES.length} allowed name(s) (it may only shrink).`
  );
  for (const file of files) console.log(`  ${file}`);

  if (outside.length > 0) {
    console.error(
      `\nformat-check-ratchet: BREACHED — ${outside.length} unformatted file(s) are OUTSIDE the ` +
        'baseline set:'
    );
    for (const file of outside) console.error(`  ${file}`);
    console.error(
      '\nThe baseline is a set of KNOWN names, not a count and not a permission: a name here means ' +
        'an unformatted file reached the tree with the wide check unrun — the exact leak this job ' +
        'exists to catch.\n' +
        '  Fix: run `pnpm format` over the file(s) above. Do NOT add them to ' +
        'FORMAT_CHECK_BASELINE_FILES; the whole point of this set is that growth is a regression.\n'
    );
    process.exit(1);
  }

  console.log('format-check-ratchet: held — no unformatted file outside the baseline set.');
  if (cleaned.length > 0) {
    console.log(
      `  The debt shrank: ${cleaned.length} baseline name(s) are no longer unformatted ` +
        `(${cleaned.join(', ')}). Shrink FORMAT_CHECK_BASELINE_FILES to the names listed above.`
    );
  }
}

// Run only when invoked as a program. Importing this module (the ratchet's own
// test does, to read FORMAT_CHECK_BASELINE_FILES) must have no side effects.
const invokedAsProgram =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsProgram) main();

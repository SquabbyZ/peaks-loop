// scripts/packages-build-messages.mjs
//
// The four sentences this guard refuses with, each separated from the others for the
// reason its own docblock gives: a stale dist/, a stamp file that cannot be READ, a tree
// with no package to check at all, and a build that ran and did not satisfy the
// prerequisite.
//
// Split out of `scripts/packages-build-prerequisite.mjs` (rid-043). Every line below
// was moved VERBATIM from that file; only this header, the import block, the
// re-export block on the entry, and the `export` keyword on names a sibling imports
// are new.

import { join } from 'node:path';

import { REBUILD_COMMAND } from './dist-freshness.mjs';
import { PACKAGES_BUILD_COMMAND } from './packages-build-scope.mjs';
import { PACKAGE_STAMP_RELATIVE_PATH, stampPath } from './packages-build-stamps.mjs';

const MAX_NAMED = 8;

/**
 * The operator-facing refusal. `stale` is the list from `evaluatePackages`.
 *
 * @param {readonly string[]} stale
 */
export function staleMessage(stale) {
  const named = stale.slice(0, MAX_NAMED);
  const extra = stale.length > MAX_NAMED ? [`    … (+${stale.length - MAX_NAMED} more)`] : [];
  return [
    '',
    `Test suite refused to start: ${stale.length} workspace package(s) have a dist/ that was not built from their current src/.`,
    '',
    '  stale:',
    ...named.map((name) => `    packages/${name}/dist`),
    ...extra,
    '',
    '  `packages/*/dist` is what these tests import, through `node_modules` — the',
    '  workspace packages are separately published artifacts and are NOT aliased to',
    '  their `src/`. A stale build means the suite would test code that no longer',
    '  exists, so it is not rebuilt silently on your behalf. Rebuild, then re-run:',
    '',
    `    ${REBUILD_COMMAND}`,
    ''
  ].join('\n');
}

/**
 * The refusal for a tree whose stamps could not be READ, as distinct from one
 * whose `dist/` disagrees with its `src/`.
 *
 * Separate from `staleMessage` for the reason that one's sentence would be false
 * here: the packages are not stale, the RECORDS could not be read, and the
 * `dist/` may be perfectly current. Its remedy is wrong here too, and that half
 * is the load-bearing one — `pnpm build` cannot clear this state, because
 * `scripts/write-package-dist-stamps.mjs` is the FOURTH of the eight
 * `&&`-joined steps of `package.json#scripts.build` (index 3: sync-version,
 * clean-dist, the packages build, this write, tsc, …), so the steps before it
 * run first — `clean-dist.mjs` at step 2 `rmSync`s the root `dist` and every
 * package `dist/` under `packages/`; step 3 remakes the packages' dists only,
 * and the root `dist` would be remade by step 5's `tsc`, which this chain never
 * reaches — and only then does the write hit the same obstacle, print `FAILED`
 * and exit 1. A refusal that names a command which cannot work costs the
 * operator a full build cycle AND the artifacts that were fine before it, so
 * this message names the state instead.
 *
 * @param {string} root
 */
export function stampBlockedMessage(root) {
  return [
    '',
    'Test suite refused to start: the package stamps could not be read as a file.',
    '',
    `  ${PACKAGE_STAMP_RELATIVE_PATH} is not an ordinary readable file — a directory, a`,
    '  broken link, or a permissions problem — so every package reads `stale` for',
    '  that reason alone. This is NOT a statement that a `dist/` disagrees with its',
    '  `src/`: nothing here could compare the two, and the artifacts may be current.',
    '',
    `  stamp file: ${stampPath(root)}`,
    '',
    '  A rebuild does not clear this, and it is not the first thing that happens',
    '  either: this file is written by step 4 of the 8 steps of',
    '  `package.json#scripts.build`. Step 2 wipes every `packages/*/dist` and the',
    '  root `dist`; step 3 remakes only the package dists, and the root `dist` is',
    '  not remade at all, because the step that would remake it (step 5) is later',
    '  than this one. So a rebuild destroys the artifacts first, still stops here,',
    '  and never reaches `tsc`.',
    '  That path must be an ordinary file, or absent. Remove or repair whatever is',
    '  at it, then re-run.',
    ''
  ].join('\n');
}

/**
 * The refusal for a tree this guard found no package in — an absent `packages/`
 * directory, or one holding no `src/` to compile.
 *
 * Not a no-op, and that is the whole point: an empty search and a search from
 * the wrong root are the same reading from in here, so this is the one case
 * where refusing to answer is the only honest answer. It is deliberately not
 * `staleMessage` either — that one names packages that were classified, and
 * here there are none.
 *
 * @param {string} root the resolved project root that was searched
 */
export function noPackagesMessage(root) {
  const packagesDir = join(root, 'packages');
  return [
    '',
    `Test suite refused to start: no workspace package under ${packagesDir} has a src/ to build.`,
    '',
    '  A verdict that covers no package is not a green one — this prerequisite',
    '  cannot vouch for a tree it found nothing to check in, and "the root is not',
    '  this repository" reads exactly like "there is nothing here to build".',
    '',
    `  searched: ${packagesDir}`,
    '',
    '  Point this guard at a checkout of this repository, then re-run.',
    ''
  ].join('\n');
}

/**
 * The refusal for a build that RAN and did not satisfy the prerequisite.
 *
 * Separate from `staleMessage` for two reasons. Its list is different — a
 * package with no `dist/` at all was never classified `stale`, and saying "a
 * dist/ that was not built from their current src/" about a package that has no
 * `dist/` would be false. And its cause is different: the command reported
 * success, so what needs naming is that `pnpm -r run <script>` skips a package
 * that does not declare that script and exits 0 regardless.
 *
 * @param {{ missing: readonly string[], stale: readonly string[] }} after
 */
export function unbuiltMessage(after) {
  const group = (label, names) =>
    names.length === 0
      ? []
      : [
          `  ${label}`,
          ...names.slice(0, MAX_NAMED).map((name) => `    packages/${name}/dist`),
          ...(names.length > MAX_NAMED ? [`    … (+${names.length - MAX_NAMED} more)`] : [])
        ];
  return [
    '',
    `Test suite refused to start: ${PACKAGES_BUILD_COMMAND} returned, but ${after.missing.length + after.stale.length} workspace package(s) are not built from their current src/.`,
    '',
    ...group('no dist/ at all:', after.missing),
    ...group('dist/ present but not the emit of the current src/:', after.stale),
    '',
    '  The build command reports success while building nothing: `pnpm -r run',
    '  <script>` skips a package that does not declare that script and still',
    '  exits 0. A package whose `build` script is missing, or one whose build did',
    '  not finish, is what the list above is. Rebuild, then re-run:',
    '',
    `    ${REBUILD_COMMAND}`,
    ''
  ].join('\n');
}

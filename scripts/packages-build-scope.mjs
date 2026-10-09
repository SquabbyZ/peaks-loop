// scripts/packages-build-scope.mjs
//
// The WALK and the SET: one recursive file lister, the package roots it is applied to,
// and the command that builds them. Both halves of the set rule are here because they
// are one question — "which packages, built how".
//
// Split out of `scripts/packages-build-prerequisite.mjs` (rid-043). Every line below
// was moved VERBATIM from that file; only this header, the import block, the
// re-export block on the entry, and the `export` keyword on names a sibling imports
// are new.

import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Builds all four packages. `pnpm` resolves the workspace topology, so the
 * order is dependency-correct without this file restating it.
 */
export const PACKAGES_BUILD_COMMAND = 'pnpm -r --filter "./packages/*" run build';

/**
 * Every DIRECTORY ENTRY under `packages/` that has a `src/` tree to compile,
 * i.e. every package whose `dist/` this prerequisite is responsible for.
 *
 * This set is defined by a DIFFERENT RULE than the build's, and the two rules
 * are not nested, so the two sets do NOT agree. This walk takes *a directory
 * entry with a non-empty `src/`*; the build takes *a workspace project with a
 * `package.json`*. Measured 2026-09-25 with pnpm **10.11.0** — this
 * repository's own, selected by its `packageManager` pin — on one probe
 * workspace with one root per arm
 * (`rd/repair2-probes/probe-v1-pnpm-version-and-sets.mjs`):
 *
 *   - real `packages/<dir>`, manifest, NO `src/`     → BUILT here, not walked;
 *   - `packages/<dir>` a symlink with a manifest     → BUILT here, not walked
 *     (`withFileTypes` reports a symlink as a symlink, so `entry.isDirectory()`
 *     is false and the entry is dropped);
 *   - real `packages/<dir>`, `src/`, NO manifest     → walked, NOT built. That
 *     direction is the "the build command reports success while building
 *     nothing" refusal below, it refuses loudly, and it is why this rule is
 *     `src/` and not `package.json`.
 *
 * The first two are packages whose `dist/` is never freshness-checked.
 * DOCUMENTABLE rather than CLOSEABLE — and the two halves are blocked by
 * DIFFERENT mechanisms, so the reason is stated per half. The **symlinked** entry
 * is VERSION-bound: closing it means following the link, and the SAME probe root
 * without a `packageManager` field runs pnpm **12.6.0** and builds neither the
 * link nor lists it, so the alignment would be alignment with one pnpm version
 * silently and the mismatch would move rather than close. The **manifest, no
 * `src/`** entry is NOT version-bound: it is built at BOTH pins, so alignment for
 * it is version-independent, and what blocks it is `emitIsComplete` below —
 * completeness is read off `src/`, so a tree with no `src/` can never read
 * `fresh` (measured: `stale` with a `dist/`, `missing` without one). That is a
 * design decision this module does not name, not a version bind.
 * `.peaks/docs/backlog.md` §2.15 owns the finding and the probe.
 *
 * Re-measure when the `packageManager` PIN changes — the axis is the pin and the
 * pnpm it resolves to, NOT a pnpm major, because a probe root that carries no
 * `packageManager` field does not measure this repository's pnpm at all — or
 * when `PACKAGES_BUILD_COMMAND` changes.
 *
 * THE PER-PACKAGE DROP BELOW IS LOAD-BEARING, said here because it reads like a
 * redundancy and is not one. A directory entry with no `.ts` source under its
 * `src/` — an empty directory, one holding only a `.d.ts`, a `README.md` or a
 * subdirectory of neither, or an unreadable one through the same `catch` — is
 * dropped from the guard entirely: never `missing`, never `stale`, never
 * vouched for. Removing the drop does not make the guard keener, it makes it
 * refuse a tree `REBUILD_COMMAND` can never repair. Measured 2026-09-25: a
 * package whose `src/` holds no `.ts` has a tsc `include` that matches nothing,
 * and this repository's own tsc refuses it — `TS18003: No inputs were found`
 * (exit 2) — so such a package can never acquire a `dist/`, it reads `missing`
 * for good, and the post-build assertion then names a remedy that cannot clear
 * it.
 *
 * THE CRITERION IS THE GATE'S — and unlike the sentence this replaced, that is
 * now DEMONSTRATED rather than asserted. It is `check-build-integrity.mjs`'s
 * `listTsSources(...).length === 0 → continue`: this walk recurses, and filters
 * by the same `.ts` and not `.d.ts`, as `listTsSources` does. THE EARLIER TEXT
 * HERE CLAIMED THIS ALIGNMENT WHILE THE CODE HELD A TOP-LEVEL
 * `readdirSync(src).length`, and the two rules diverged on the one neighbouring
 * shape — a `src/` holding entries and no `.ts` anywhere under it, e.g.
 * `src/services/` left behind after its sources were deleted. There the guard
 * walked the package, recorded `fileCount: 0` for it, and read it `fresh` over
 * a `dist/` nothing had rebuilt, while the gate skipped it and printed
 * `build-integrity: OK`. Both halves are measured, on constructed trees, in
 * `tests/unit/scripts/packages-build-scope-alignment.test.ts`, which runs the
 * gate itself against the same tree it asks this walk about — because a claim
 * of alignment is a claim about TWO rules, and one made from reading only this
 * file is how the divergence outlived its own docblock
 * (`.peaks/docs/backlog.md` §2.14 site 2).
 *
 * ONE INPUT SITS OUTSIDE THAT ALIGNMENT, and it is named rather than folded
 * into the claim. An UNREADABLE `src/` — a permissions failure — is dropped
 * here, through the `catch` below, while the gate reaches its own `readdirSync`
 * and throws, so the gate dies loudly where this walk is silent. The divergence
 * is in this guard's favour and it is not closed: it is reasoned from the two
 * sources rather than measured, because no permission state was reproduced on
 * this host.
 *
 * The recursion is what keeps the correction from over-reaching in the other
 * direction: a package whose only `.ts` sits one directory down under `src/` is
 * still walked, because `listTsSources` sees it too. That shape's other half is
 * a different axis, and `hasBuild` below owns it.
 *
 * @param {string} projectRoot
 * @returns {Array<{ name: string, root: string }>}
 */
export function listPackageRoots(projectRoot) {
  const packagesRoot = join(resolve(projectRoot), 'packages');
  let entries;
  try {
    entries = readdirSync(packagesRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, root: join(packagesRoot, entry.name) }))
    .filter((pkg) => {
      try {
        // The gate's rule, one predicate — see the docblock above.
        return listFiles(join(pkg.root, 'src')).some(
          (name) => name.endsWith('.ts') && !name.endsWith('.d.ts')
        );
      } catch {
        return false;
      }
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Every file under `dir`, recursively, as `/`-separated paths relative to it.
 *
 * Throws when `dir` is unreadable — which is what `emitIsComplete`'s `catch`
 * is for. A walker that returned `[]` on a read failure would answer "nothing
 * is missing" about a directory it never read, and `.every()` over an empty
 * list is `true`: this module's own silent-green shape, one predicate away.
 */
export function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const nested of listFiles(join(dir, entry.name))) {
        files.push(`${entry.name}/${nested}`);
      }
    } else {
      files.push(entry.name);
    }
  }
  return files;
}

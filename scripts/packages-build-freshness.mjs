// scripts/packages-build-freshness.mjs
//
// The verdict itself: does a package have build output at all (`hasBuild`), is that
// output the COMPLETE emit of the current `src/` (`emitIsComplete`), and the three-bucket
// classification that composes them (`evaluatePackages`). Reads only — never builds,
// never writes.
//
// Split out of `scripts/packages-build-prerequisite.mjs` (rid-043). Every line below
// was moved VERBATIM from that file; only this header, the import block, the
// re-export block on the entry, and the `export` keyword on names a sibling imports
// are new.

import { join, resolve } from 'node:path';

import { computeSourceDigest } from './dist-freshness.mjs';
import { listFiles, listPackageRoots } from './packages-build-scope.mjs';
import { readStamps } from './packages-build-stamps.mjs';

// An incomplete `dist/` is `stale`, not `missing`: `missing` stays what it
// says — no build output at all, the clean checkout, where building is the only
// repair — while a partial emit is a build that did not finish, and the guard
// does not vouch for it. The rule for "complete" is the one
// `scripts/check-build-integrity.mjs` already encodes (every source under
// `src/`, recursively, has its emit under `dist/`) and deliberately not a
// stricter one: a stricter rule here would refuse a tree the build pipeline's
// own gate calls `build-integrity: OK`, and the remediation this module names
// would then never clear it.
//
// WHAT `fresh` VOUCHES FOR, AND WHAT IT CANNOT
//
// `fresh` means "the RECORDED digest matches the `src/` on disk, and every
// source under `src/`, recursively, has its emit under `dist/`". It is not
// provenance. The stamp is unauthenticated — nothing links it to the artifacts
// it describes — so a hand-written stamp makes a `dist/` built from OLD `src/`
// read `fresh`, which is the failure this module refuses in the other
// direction. That is not merely expensive to close, it is unclosable here: the
// writer, the verifier and any key between them are files in one checkout
// written by one principal, so an actor able to forge the stamp can forge the
// artifacts or replace this module instead. The stamp is gitignored as well,
// so a forged or hand-edited one is invisible to `git status` and to review.
// The guard reports the records it read; it does not vouch for who wrote them.
//
// THE RULE CHECKS ONE DIRECTION, AND THE OTHER IS RECORDED HERE ON PURPOSE
//
// `emitIsComplete` is a containment test (`src` ⊆ `dist`), so a `dist/` holding
// an artifact whose source is gone — an orphan — still reads `fresh`, where
// `check-build-integrity.mjs` exits 1 on the same tree (its rule 2). Measured
// on this repository with a probe source written for the measurement and
// deleted once it was taken: a top-level `zz-rd-emit-probe.ts`, added under
// `packages/peaks-loop-mut`, built, and then removed with its `dist/` emit left
// in place. On that tree, `fresh` x4 against
// `orphan dist/zz-rd-emit-probe.js` / exit 1. That boundary is deliberate. The
// refusal below says "a dist/ that was not built from their current src/", and
// for an orphan that sentence would be FALSE — the dist WAS built from the
// current `src/`, it just carries leftovers — so calling it `stale` would make
// this module's own message lie in order to block a test run over a file
// nothing imports. The path that reaches the state, measured, is narrower than
// it sounds: the orphan only reads `fresh` once the stamps have been refreshed
// after the deletion (a `pretest` does that, and runs no `clean-dist`), and
// `pretest`'s own last step is `check-build-integrity.mjs`, which FAILS on it —
// so the state is reached by a run that has already been refused loudly. The
// direct vitest entry points (`test:unit`, `test:dev`, `test:cli`,
// `test:workflow`) are what consult this guard, and they run no gate of their
// own. A `fresh` over an orphan is therefore always downstream of the louder
// refusal, never a substitute for it.
//
// BOTH WALKS ARE RECURSIVE, AND THEY COMPARE RELATIVE PATHS — this module's and
// rule 1's alike, as of rid-5b6d975f, which closed the blind spot this paragraph
// used to record here. It was pre-existing in `check-build-integrity.mjs`
// (`bef907a4`, 2026-07-30 — never a regression of §2.11), and it was measured
// rather than inferred: with
// `packages/peaks-loop-mut/dist/services/mut/report-loader.js` deleted and its
// source untouched, this module read `fresh` and the gate printed
// `build-integrity: OK` — two green gates over a tree missing an artifact its
// own `index.js` imports. It is closed rather than merely recorded because the
// reason the paragraph gave for leaving it — one definition, owned by the gate —
// only holds while both sides of that definition agree: a recursive source list
// read against a top-level `dist` set can never match for a nested source, so
// every one of them reads as a missing artifact over a tree the gate calls OK.

/**
 * Does this package have any built JavaScript at all — anywhere under `dist/`?
 *
 * "Anywhere", not "at the top of it", and the difference is a FALSE REFUSAL
 * rather than a blind spot (rid-4134eb10; `backlog.md` §2.16). `outDir` and
 * `rootDir` are per-package, so a package whose every source sits under
 * `src/<sub>/` has its every emit under `dist/<sub>/`, and this walk used to be
 * the THIRD top-level `readdirSync` in this module — the one §2.12 left behind
 * when it made the other two recurse. Measured 2026-09-25 on a nested-only
 * fixture: `evaluatePackages` read the package `missing` while its nested emit
 * was on disk, and `ensurePackagesBuilt` refused the tree with *"no dist/ at
 * all: packages/a/dist"* although the build had succeeded — a refusal no
 * rebuild clears, over a tree `scripts/check-build-integrity.mjs` calls
 * `build-integrity: OK`, which is the cost this module's own header says its
 * rule must not pay. With the recursive walk the same tree is `fresh`, or
 * `stale` when the emit is gone: the emit rule decides it, not this one.
 *
 * The `.js` FILTER is deliberately untouched. A stray `.js` under `dist/`
 * reading as "built" is the direction §2.14 examined and cleared — the digest +
 * emit pair then refuses rather than vouches — and that judgment is about the
 * filter. This is the walk's REACH; the two are different properties of this
 * function and must not be changed together.
 *
 * Named rather than left to be found: the `catch` still maps an UNREADABLE
 * `dist/` to `false`, i.e. to the same "no build output at all" answer, so a
 * permissions failure produces a false refusal of this family. That is the
 * `catch` and not the walk, the recursion above leaves it byte-identical, no
 * live instance exists, and it is not this change's axis.
 */
function hasBuild(pkgRoot) {
  try {
    return listFiles(join(pkgRoot, 'dist')).some((name) => name.endsWith('.js'));
  } catch {
    return false;
  }
}

/**
 * Does this package's `dist/` hold the EMIT of its `src/`?
 *
 * `hasBuild` above answers a different question — whether there is any build
 * output at all — and a `dist/` with one file missing in it answers that one
 * yes. This is the second half of a `fresh` verdict: the digest RECORDS the
 * SOURCE side — records it, it does not vouch for who wrote the record, see the
 * header — and this checks the artifacts are all there.
 *
 * The rule is `scripts/check-build-integrity.mjs`'s, and deliberately not a
 * stricter one — see the header. Unreadable `src/` or `dist/` counts as
 * incomplete, which is the safe direction (it refuses rather than vouches).
 *
 * Both sides are the SAME recursive walk, on relative paths. One side
 * recursive against one side top-level is not a weaker check but a comparison
 * that can never match — every nested source would read as an artifact that is
 * missing, over a tree the gate calls OK. (The top-level `readdirSync(dist)`
 * this replaced also carried directory entries; no `.js` lookup ever matched
 * one, so dropping them is not a rule change.)
 *
 * THE VACUOUS-TRUE CASE NEVER ARRIVES HERE, and after rid-4134eb10 repair 1
 * that is a property of the walk above rather than an assumption about it.
 * `.every()` over no files is `true`; the digest of nothing is a constant
 * (`computeSourceDigest` hashes the empty input and returns `fileCount: 0`);
 * and `writePackageDistStamps` records that constant happily. Composed, those
 * two safe-looking helpers read `fresh` over a `dist/` built from sources that
 * have been DELETED. That composition is the reason `listPackageRoots` drops by
 * the gate's recursive `.ts` test instead of the top-level listing it used to
 * carry: the empty-set input has to be gone before it gets here, and the
 * earlier text claimed that as "safe only because nothing reaches it" while a
 * `src/` holding a `README.md` and no `.ts` reached it in one edit
 * (`backlog.md` §2.14 site 2). The reachability is now closed by construction,
 * not by argument: this function's only caller is `evaluatePackages`, which
 * iterates `listPackageRoots`, and the filter at the bottom of THIS function is
 * the same `.ts`-and-not-`.d.ts` predicate over the same recursive
 * `listFiles(src)` walk as the one that admitted the package — so the file list
 * `.every()` runs over holds at least one entry. Measured on a constructed
 * tree in `tests/unit/scripts/packages-build-scope-alignment.test.ts`: such a
 * package is in no bucket at all. An absent `src/` is `false`, through the
 * `catch`.
 *
 * It is still not repaired here, on purpose: a second rule for an empty `src/`
 * would be a rule with no reachable red, and two gates disagreeing one directory
 * at a time. What has to survive is the composition — the filter that gates it
 * is load-bearing, and this paragraph is where the next reader finds that out
 * instead of re-deriving it.
 *
 * @param {string} pkgRoot
 */
function emitIsComplete(pkgRoot) {
  try {
    const built = new Set(listFiles(join(pkgRoot, 'dist')));
    return listFiles(join(pkgRoot, 'src'))
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))
      .every((name) => built.has(name.replace(/\.ts$/, '.js')));
  } catch {
    return false;
  }
}

/**
 * Classify every package. Pure with respect to the tree: it reads, it never
 * builds and never writes.
 *
 * `stale` deliberately covers both the unstamped case and the incomplete-emit
 * case. A `dist/` whose sources cannot be compared to a recorded digest is not
 * proven current, and neither is one that is missing a file the digest says was
 * compiled; reporting either as fresh would be the same silent-green this module
 * exists to remove.
 *
 * @param {string} projectRoot
 * @returns {{ missing: string[], stale: string[], fresh: string[] }}
 */
export function evaluatePackages(projectRoot) {
  const root = resolve(projectRoot);
  const stamps = readStamps(root);
  const missing = [];
  const stale = [];
  const fresh = [];
  for (const pkg of listPackageRoots(root)) {
    if (!hasBuild(pkg.root)) {
      missing.push(pkg.name);
      continue;
    }
    const recorded = stamps === null ? undefined : stamps[pkg.name];
    // Emit first: it is a `readdirSync` where the digest is a read of every
    // source file, and the cheaper half of the claim is the one to fail on.
    if (emitIsComplete(pkg.root) && recorded?.digest === computeSourceDigest(pkg.root).digest) {
      fresh.push(pkg.name);
    } else {
      stale.push(pkg.name);
    }
  }
  return { missing, stale, fresh };
}

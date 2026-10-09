// scripts/packages-build-stamps.mjs
//
// `packages/.dist-stamps.json`: where it lives and why it lives OUTSIDE every package,
// how it is read, how a blocked read is told apart from a merely absent one, and the
// atomic write that records it.
//
// Split out of `scripts/packages-build-prerequisite.mjs` (rid-043). Every line below
// was moved VERBATIM from that file; only this header, the import block, the
// re-export block on the entry, and the `export` keyword on names a sibling imports
// are new.

import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { computeSourceDigest, DIST_STAMP_VERSION } from './dist-freshness.mjs';
import { listPackageRoots } from './packages-build-scope.mjs';

// THE STALENESS SIGNAL IS CONTENT-DERIVED, NOT MTIME — and on this axis it has
// to be, because mtime is not merely weak here, it is unusable:
// `scripts/sync-version.mjs` rewrites
// `packages/peaks-loop-shared/src/version.ts` on EVERY `predev`, `pretest` and
// `build` run (`build` itself invokes it; there is no `prebuild` script). An
// mtime rule would therefore read `peaks-loop-shared` as stale on every single
// run, whether or not the file's content changed at all — measured: the file's
// mtime moved while its sha stayed byte-identical. Mtime also cannot survive a
// checkout, which does not preserve it. So no SOURCE-FRESHNESS decision in this
// module is mtime-based. (The one mtime read is `acquireLock`'s, below, and it
// decides only whether a lock is dead, which is a different question.) What this
// module stands on instead:
//
//   - each package's `packages/<pkg>/src/**/*.ts` is digested with
//     `computeSourceDigest` — the same function and the same
//     `DIST_STAMP_VERSION` the root `dist/` stamp uses, so there is one digest
//     definition in this repository, not two;
//   - the digest is recorded by `writePackageDistStamps` at build time;
//   - a `dist/` with no RECORDED digest is reported STALE, never guessed at.
//     "We cannot prove this was built from these sources" and "it is stale" are
//     not the same sentence, so the refusal separates the two cases that reach
//     it: a stamp path that cannot be READ as a file at all is refused as that,
//     with the message saying the `dist/` may be current, while a `dist/` whose
//     recorded digest disagrees with its `src/` gets the stale sentence.
//
// WHY THE STAMPS LIVE OUTSIDE EVERY PACKAGE (`packages/.dist-stamps.json`)
//
// The root stamp sits inside `dist/` (`scripts/write-dist-stamp.mjs`), which is
// not published only because the root `package.json#files` is an allow-list
// that admits `dist/**/*.js|.d.ts|.md|.sql` and nothing else. A package cannot
// use that trick:
//
//   - `peaks-loop-shared`, `peaks-loop-shared-channel` and `peaks-loop-mut`
//     declare `"files": ["dist/**"]`, so a stamp inside their `dist/` SHIPS.
//     Measured with `npm pack --dry-run`: adding one extra file under the
//     `dist/` of `packages/peaks-loop-shared` took its tarball from 15 dist
//     entries to 16, i.e. the file ships.
//   - `peaks-loop-internal-runtime` declares no `files` field at all. Measured
//     the same way, its tarball is 70 files: its entire `src/`, its
//     `tsconfig.json`, and `dist/`. Giving it a `files` field to exclude one
//     internal file would change what it ships far more than the file does.
//
// So the stamps go in ONE file outside every package. It is never packed
// (each package packs only its own directory), it is gitignored, and
// `scripts/release-pack.mjs` skips a non-directory entry under `packages/`.
// This is the same digest and the same stamp version as the root stamp — an
// aggregate LOCATION, not a parallel mechanism.

/** Relative to the project root. Outside every package, so it is never packed. */
export const PACKAGE_STAMP_RELATIVE_PATH = 'packages/.dist-stamps.json';

/** @param {string} projectRoot */
export function stampPath(projectRoot) {
  return join(resolve(projectRoot), PACKAGE_STAMP_RELATIVE_PATH);
}

/**
 * The recorded digests, or `null` when they cannot be read or are not the shape
 * this version of the module writes. `null` is the "cannot prove it" input to
 * `evaluatePackages`, not an error: a stamp written by an older version is
 * unusable for the same reason a missing one is.
 *
 * @param {string} projectRoot
 * @returns {Record<string, { digest: string }> | null}
 */
export function readStamps(projectRoot) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(stampPath(projectRoot), 'utf8'));
  } catch {
    return null;
  }
  if (parsed?.version !== DIST_STAMP_VERSION) return null;
  if (parsed.packages === null || typeof parsed.packages !== 'object') return null;
  return parsed.packages;
}

/**
 * Is there something at the stamp path that cannot be read AS A FILE?
 *
 * `readStamps` above answers `null` for two situations that are not the same
 * refusal, and the whole point of this function is that the message must not
 * confuse them:
 *
 *   - nothing recorded yet — the ordinary stale tree, whose remedy is a rebuild
 *     and a rebuild clears it;
 *   - something in the way — a directory, a broken link, a permissions problem,
 *     where a rebuild does NOT clear it: the step that writes this very file is
 *     the FOURTH of the eight `&&`-joined steps of `package.json#scripts.build`,
 *     and step 2 wipes the root `dist` and every package `dist/` under
 *     `packages/` while step 3 remakes the packages' dists only — the root
 *     `dist` is remade by step 5's `tsc`, which this chain never reaches — so a
 *     rebuild destroys the artifacts first and only then stops on the same
 *     obstacle.
 *
 * Only the second is reported, and `ENOENT` — the first one, the common case —
 * is explicitly not it. A readable file whose JSON does not parse is also not
 * it: the rebuild truncates that away.
 *
 * The file is read a second time here rather than carried out of `readStamps` on
 * the verdict, because the verdict's shape is what `evaluatePackages`'s callers
 * read and assert as a whole. This runs only on the refusal path, where the
 * guard is about to throw anyway — and it is a 215-byte file.
 *
 * @param {string} projectRoot
 */
export function stampPathBlocked(projectRoot) {
  try {
    readFileSync(stampPath(projectRoot), 'utf8');
    return false;
  } catch (error) {
    return error?.code !== 'ENOENT';
  }
}

/**
 * Record the digest of every package's sources. Called after a build, by
 * `scripts/write-package-dist-stamps.mjs` (wired into `build` and `pretest`)
 * and by `ensurePackagesBuilt` below.
 *
 * The write REPLACES the file — a temp name in the same directory, then
 * `renameSync` — and not by reflex: `writeFileSync` is open-TRUNC + write, so a
 * reader arriving between the two sees a partial file, `readStamps` maps that to
 * `null`, and `null` makes EVERY package `stale`. The rename is atomic within a
 * filesystem, and the temp is in the stamp's own directory so it cannot cross
 * one.
 *
 * That is also why this writer takes NO lock, which is worth stating because
 * `ensurePackagesBuilt` does. The lock is the BUILDER's, held across a build;
 * this function records digests of `src/`, which is a read of the tree. Taking
 * the lock here would turn a 215-byte write into a run that queues up to
 * `LOCK_WAIT_MS` behind an unrelated build, or refuses — a worse failure mode
 * than the race it would be closing. Atomicity is what the race needed: no
 * reader can observe a half-written stamp, and two concurrent writers are
 * last-rename-wins over two COMPLETE files, which is the same verdict either
 * way because both read the same `src/`.
 *
 * THE TRADE THIS MADE, measured 2026-09-25
 * (`rd/repair2-probes/probe-v2-f64-and-open-handle.mjs`; no pnpm participates in
 * this arm, so no pnpm version qualifies the figure): the rename needs DELETE
 * access to the directory entry, so this write fails `EPERM` while another
 * handle holds the stamp open — 20 of 20 writes threw with one reader holding
 * it, against 0 of 20 for the in-place `writeFileSync` it replaced and 0 of 20
 * for this writer while nothing held it open (control). The exposure is
 * EXTERNAL holders only: `readStamps` and `stampPathBlocked` both open and
 * close, and 5 000 read+write pairs of that reader threw 0. It is loud
 * (`FAILED`, exit 1) and a retry clears it. Accepted rather than reverted: the
 * tear it removed was silent and made every package read `stale`.
 *
 * @param {string} projectRoot
 */
export function writePackageDistStamps(projectRoot) {
  const root = resolve(projectRoot);
  /** @type {Record<string, { digest: string, fileCount: number, builtAt: string }>} */
  const packages = {};
  for (const pkg of listPackageRoots(root)) {
    const { digest, fileCount } = computeSourceDigest(pkg.root);
    packages[pkg.name] = { digest, fileCount, builtAt: new Date().toISOString() };
  }
  const target = stampPath(root);
  // Unique to this process, so two writers never share one temp file — sharing
  // it would put the tear back, into a file the rename then promotes.
  const temp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(
      temp,
      `${JSON.stringify({ version: DIST_STAMP_VERSION, packages }, null, 2)}\n`,
      'utf8'
    );
    renameSync(temp, target);
  } catch (error) {
    // The temp is inside `packages/`, whose only gitignore entry is the stamp
    // itself, so one left behind would surface as an untracked file. Best
    // effort: the throw below is the error the caller needs, and this is
    // housekeeping for it.
    try {
      unlinkSync(temp);
    } catch {
      // Either it was never created, or it cannot be removed — nothing to add.
    }
    throw error;
  }
  return packages;
}

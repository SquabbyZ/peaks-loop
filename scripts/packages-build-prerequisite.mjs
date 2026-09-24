// scripts/packages-build-prerequisite.mjs
//
// The build prerequisite of every test entry point: `packages/*/dist` must
// exist, must have been built from the `packages/*/src` on disk, and must
// actually contain that build's output.
//
// WHY THIS EXISTS
//
// `dist/` is gitignored, so a clean checkout has no package build output, and
// all four workspace packages publish ONLY from `dist/` (`main` / `exports`).
// `src/` imports them, and so do the tests: a handful through a module
// specifier for a package, and many more transitively, because a test that
// imports `src/` reaches a package through it. `vitest.config.ts` aliases the
// repo's own `src/`, but the packages are NOT aliased — they resolve through
// `node_modules` to built `dist/`. That asymmetry is deliberate: they are
// separately published artifacts, so their `dist/` IS the product under test.
//
// (No import-count here on purpose. An earlier revision carried
// `190 / 5 / 2 / 6` and `32 files under tests/`. The first was right about the
// first number with the last two swapped — measured, for `from '<pkg>…'` in
// `src/`: shared 190, shared-channel 5, mut 6, internal-runtime 2. Watch the
// pattern if you re-measure: an unanchored `from 'peaks-loop-shared` counts
// `peaks-loop-shared-channel` too and returns 195. The second number reproduces
// under no pattern at all. A permanent comment is reproduced by nobody, so a
// number in one is a claim that rots on the next import.)
//
// The failure that made this a defect is that it does not LOOK like a missing
// build. Measured on this repository, single unit file
// `tests/unit/cli/vendor-detect.test.ts`:
//
//   no `dist/` at all                     -> tests do not even collect
//   `peaks-loop-shared` built only        -> still fails, with this text:
//     Error: Failed to resolve entry for package "peaks-loop-internal-runtime".
//     The package may have incorrect main/module/exports specified in its
//     package.json.
//   all four built                        -> passes
//
// The error text blames `package.json` configuration; the real cause is a
// missing `dist/`. `package.json#scripts.pretest` built ONE of the four
// (`pnpm --filter peaks-loop-shared build`), and there was no hook of any kind
// on `test:unit`, `test:dev`, `test:cli`, `test:workflow`, `test:fast`,
// `test:integration`, `test:ci` or the `test:coverage*` family.
//
// THE POLICY: BUILD WHAT IS MISSING, REFUSE WHAT IS STALE
//
//   missing  No `dist/` at all. Build it once, in workspace dependency order,
//            then proceed. This is not an error: it is the state of every clean
//            checkout, and `pnpm -r --filter "./packages/*" run build` already
//            resolves the topology, so hand-rolling per-package builds would be
//            a second thing to keep in sync. The run LOGS that it built, so a
//            green can never be silent about an implicit build.
//   stale    `dist/` exists but was NOT built from the `src/` on disk, OR it
//            does not hold the emit of that `src/`. THROW, naming the packages
//            and the exact command that fixes it. A silent rebuild here would
//            make the run say something the developer did not ask for, and
//            would test artifacts the developer did not choose; the friction is
//            one directed message, not a hunt.
//   fresh    Proceed silently — and this is a claim about TWO things, because
//            the source side alone is not one. The recorded digest must match
//            the `src/` on disk AND `dist/` must contain the emit of it. With
//            only the first half, this was measured live: `pnpm dev` — whose
//            first step, `sync-version.mjs`, DELETES
//            `packages/peaks-loop-shared/dist/version.js` and its `.d.ts`
//            siblings — leaves a tree that reads `fresh` x4 while the next
//            `test:unit` dies with
//            `Cannot find package 'peaks-loop-shared/version'`. That is a
//            missing artifact wearing a module-resolution error, i.e. the exact
//            shape this module exists to remove.
//
// An incomplete `dist/` is `stale`, not `missing`: `missing` stays what it
// says — no build output at all, the clean checkout, where building is the only
// repair — while a partial emit is a build that did not finish, and the guard
// does not vouch for it. The rule for "complete" is the one
// `scripts/check-build-integrity.mjs` already encodes (every top-level
// `src/*.ts` has its `dist/*.js`) and deliberately not a stricter one: a
// stricter rule here would refuse a tree the build pipeline's own gate calls
// `build-integrity: OK`, and the remediation this module names would then never
// clear it.
//
// THE RULE CHECKS ONE DIRECTION, AND THE OTHER IS RECORDED HERE ON PURPOSE
//
// `emitIsComplete` is a containment test (`src` ⊆ `dist`), so a `dist/` holding
// an artifact whose source is gone — an orphan — still reads `fresh`, where
// `check-build-integrity.mjs` exits 1 on the same tree (its rule 2). Measured
// on this repository: with `packages/peaks-loop-mut/src/zz-rd-emit-probe.ts`
// removed and its `dist/` artifact left in place, `fresh` x4 against
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
// Both walks are also TOP-LEVEL-ONLY, this module's and rule 1's alike — and
// two of the four packages carry nested `src/` trees. Measured: with
// `packages/peaks-loop-mut/dist/services/mut/report-loader.js` deleted and its
// source untouched, this module reads `fresh` and the gate prints
// `build-integrity: OK`. That blind spot is pre-existing in
// `check-build-integrity.mjs`, not introduced here, and it is left alone for the
// reason above: one definition, owned by the gate, and this module deliberately
// does not get ahead of it.
//
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
//     not the same sentence, so the message below says which one it means.
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
//
// CONCURRENCY AND IDEMPOTENCY
//
// More than one entry point can run at once: `test:full` is
// `pnpm -r --include-workspace-root --workspace-concurrency=2 run test`, and
// two terminals are the same shape. Two `globalSetup` runs building into the
// same `dist/` at the same time is duplicate work at best. The mechanism is a
// single exclusive lock file under `os.tmpdir()`, keyed by a digest of the
// resolved project root so two worktrees do not share it:
//
//   - `openSync(lock, 'wx')` is atomic: exactly one process creates it, every
//     other gets EEXIST and waits;
//   - the winner RE-READS the verdict inside the lock, so a loser that queued
//     behind a build observes the finished artifacts and builds nothing —
//     that double-check is what makes a second run idempotent rather than a
//     second build;
//   - a lock older than `LOCK_STALE_MS` is broken, so a killed process cannot
//     wedge every later run;
//   - the lock is released in a `finally`, so a failed build does not leave it.

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { computeSourceDigest, DIST_STAMP_VERSION, REBUILD_COMMAND } from './dist-freshness.mjs';

/**
 * Builds all four packages. `pnpm` resolves the workspace topology, so the
 * order is dependency-correct without this file restating it.
 */
export const PACKAGES_BUILD_COMMAND = 'pnpm -r --filter "./packages/*" run build';

/** Relative to the project root. Outside every package, so it is never packed. */
export const PACKAGE_STAMP_RELATIVE_PATH = 'packages/.dist-stamps.json';

/**
 * How long a run that finds the lock held blocks before refusing.
 *
 * The lock absorbs a CONCURRENT run, and the only command it guards is
 * `PACKAGES_BUILD_COMMAND`, measured at 2.94 s on a warm tree. A minute is
 * ~20x that, so a legitimate holder is never cut off, and past it the run
 * refuses with the lock path and the action rather than blocking on silently.
 * Exported because a bound nobody can read is a bound nobody can hold this
 * module to.
 */
export const LOCK_WAIT_MS = 60_000;

/** One minute in milliseconds — the unit both lock bounds are read in. */
const MINUTE_MS = 60_000;

/** The stale-lock bound, in whole minutes. Kept above `LOCK_WAIT_MS`. */
const LOCK_STALE_MINUTES = 10;

/**
 * The age at which a lock nobody is waiting behind is presumed dead and broken.
 *
 * Deliberately LONGER than `LOCK_WAIT_MS`, and for a different reader: a waiter
 * refuses before it could ever break the lock it was waiting on, so this bound
 * serves the later run that arrives to find a crashed holder's lock already old.
 * A developer is never blocked for it.
 */
export const LOCK_STALE_MS = LOCK_STALE_MINUTES * MINUTE_MS;

const POLL_MS = 200;
const MAX_NAMED = 8;

/** Bytes in the one-element `Int32Array` that `Atomics.wait` needs as a guard. */
const INT32_BYTES = 4;

/** Hex characters of the project-root digest that key this project's lock file. */
const LOCK_KEY_HEX_CHARS = 16;

/**
 * Every package under `packages/` that has a `src/` tree to compile, i.e. every
 * package whose `dist/` this prerequisite is responsible for.
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
        return readdirSync(join(pkg.root, 'src')).length > 0;
      } catch {
        return false;
      }
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** @param {string} projectRoot */
function stampPath(projectRoot) {
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
function readStamps(projectRoot) {
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
 * Record the digest of every package's sources. Called after a build, by
 * `scripts/write-package-dist-stamps.mjs` (wired into `build` and `pretest`)
 * and by `ensurePackagesBuilt` below.
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
  writeFileSync(
    stampPath(root),
    `${JSON.stringify({ version: DIST_STAMP_VERSION, packages }, null, 2)}\n`,
    'utf8'
  );
  return packages;
}

/** Does this package have any built JavaScript at all? */
function hasBuild(pkgRoot) {
  try {
    return readdirSync(join(pkgRoot, 'dist')).some((name) => name.endsWith('.js'));
  } catch {
    return false;
  }
}

/**
 * Does this package's `dist/` hold the EMIT of its `src/`?
 *
 * `hasBuild` above answers a different question — whether there is any build
 * output at all — and a `dist/` with one file missing in it answers that one
 * yes. This is the second half of a `fresh` verdict: the digest proves the
 * SOURCE side, and this proves the artifacts are all there.
 *
 * The rule is `scripts/check-build-integrity.mjs`'s, and deliberately not a
 * stricter one — see the header. Unreadable `src/` or `dist/` counts as
 * incomplete, which is the safe direction (it refuses rather than vouches).
 *
 * @param {string} pkgRoot
 */
function emitIsComplete(pkgRoot) {
  try {
    const built = new Set(readdirSync(join(pkgRoot, 'dist')));
    return readdirSync(join(pkgRoot, 'src'))
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
 * The exclusive lock for one project root. Keyed by the resolved root so two
 * checkouts (or two worktrees) never contend for the same file.
 *
 * @param {string} projectRoot
 */
export function lockPath(projectRoot) {
  const key = createHash('sha256')
    .update(resolve(projectRoot))
    .digest('hex')
    .slice(0, LOCK_KEY_HEX_CHARS);
  return join(tmpdir(), `peaks-packages-build-${key}.lock`);
}

/** `globalSetup` is synchronous, so the poll cannot be a timer. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(INT32_BYTES)), 0, 0, ms);
}

/**
 * A lock failure that is not contention — an unwritable or absent temp
 * directory, most often — said in this module's vocabulary: what failed, which
 * file it was, and what to do. The only path that takes the lock is the one that
 * NEEDS a build, so a fresh container is exactly where this lands, and a raw
 * `ENOENT` there names neither the file nor the fix.
 */
function lockUnavailableError(lock, cause) {
  return new Error(
    [
      '',
      `Cannot create the packages build lock: ${cause?.code ?? 'unknown error'}.`,
      '',
      `  lock file: ${lock}`,
      `  ${cause?.message ?? String(cause)}`,
      '',
      '  The lock lives in the OS temp directory. Make that directory exist and be',
      '  writable (TMPDIR / TMP / TEMP), then re-run.',
      ''
    ].join('\n'),
    { cause }
  );
}

function acquireLock(lock, waitMs, pollMs) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'));
      return;
    } catch (error) {
      // EEXIST is the contended case this loop is for; anything else (ENOENT,
      // EACCES, ENOSPC) is a lock that cannot exist at all.
      if (error?.code !== 'EEXIST') throw lockUnavailableError(lock, error);
    }
    let ageMs;
    try {
      ageMs = Date.now() - statSync(lock).mtimeMs;
    } catch {
      // The holder released it between our `open` and our `stat` — try again.
      continue;
    }
    if (ageMs > LOCK_STALE_MS) {
      try {
        unlinkSync(lock);
      } catch {
        // Another waiter broke it first; the next `open` decides the winner.
      }
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(
        [
          '',
          `Another peaks-loop process holds the packages build lock (age ${Math.round(ageMs / 1000)}s), so this run gave up after ${Math.round(waitMs / 1000)}s.`,
          '',
          `  lock file: ${lock}`,
          '',
          '  If no other test run is active, delete that file and re-run.',
          ''
        ].join('\n')
      );
    }
    sleep(pollMs);
  }
}

function releaseLock(lock) {
  try {
    unlinkSync(lock);
  } catch {
    // Already gone (broken as stale by a waiter) — nothing to release.
  }
}

function defaultRunBuild(projectRoot) {
  // `stdio: 'inherit'` so the build's own output stays visible: an implicit
  // build that prints nothing is the silent behaviour this guard avoids.
  execSync(PACKAGES_BUILD_COMMAND, {
    cwd: projectRoot,
    stdio: 'inherit',
    windowsHide: true
  });
}

/**
 * The prerequisite itself. Throws on stale; builds once when something is
 * missing; returns the verdict that the caller can log.
 *
 * @param {string} projectRoot
 * @param {{
 *   log?: (line: string) => void,
 *   runBuild?: (projectRoot: string) => void,
 *   waitMs?: number,
 *   pollMs?: number,
 *   acquireLock?: (lock: string, waitMs: number, pollMs: number) => void
 * }} [options]
 * @returns {{ built: boolean, missing: string[], stale: string[], fresh: string[] }}
 */
export function ensurePackagesBuilt(projectRoot, options = {}) {
  const root = resolve(projectRoot);
  const log = options.log ?? (() => {});
  const runBuild = options.runBuild ?? defaultRunBuild;
  const waitMs = options.waitMs ?? LOCK_WAIT_MS;
  const pollMs = options.pollMs ?? POLL_MS;
  // The wait for the lock, in place of the real one. It is here because the
  // double-check below is a claim about a state a test cannot otherwise present
  // without a second process: "the run that held the lock finished while we
  // queued". Presenting that state directly is what makes the re-read pinnable
  // by a case, instead of by a race that only sometimes happens to hit it.
  const takeLock = options.acquireLock ?? acquireLock;

  const before = evaluatePackages(root);
  if (before.stale.length > 0) throw new Error(staleMessage(before.stale));
  if (before.missing.length === 0) return { built: false, ...before };

  const lock = lockPath(root);
  takeLock(lock, waitMs, pollMs);
  try {
    // Re-read INSIDE the lock. A process that queued behind another's build
    // sees the finished artifacts here and builds nothing.
    const now = evaluatePackages(root);
    if (now.stale.length > 0) throw new Error(staleMessage(now.stale));
    if (now.missing.length === 0) return { built: false, ...now };

    log(
      `[packages-build] no dist/ for ${now.missing.join(', ')} — building: ${PACKAGES_BUILD_COMMAND}\n`
    );
    runBuild(root);
    writePackageDistStamps(root);
    const after = evaluatePackages(root);
    log(
      `[packages-build] built ${after.fresh.length} package(s); the tests below are running against these artifacts\n`
    );
    return { built: true, ...after };
  } finally {
    releaseLock(lock);
  }
}

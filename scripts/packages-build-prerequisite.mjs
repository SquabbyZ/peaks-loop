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
//            then proceed — after RE-TAKING the verdict and asserting it. The
//            build's exit code is not the claim: `pnpm -r run <script>` SKIPS a
//            package that does not declare that script and still exits 0, so a
//            package whose `build` script is missing, or one whose build did not
//            emit, comes back from a green command with no `dist/`. That is
//            refused, naming the same remedy the other refusals do, because "the
//            tests below are running against these artifacts" is otherwise a
//            sentence about artifacts that do not exist. The run LOGS that it
//            built, so a green can never be silent about an implicit build.
//
//            A verdict that covers NO package is refused as well, and it is the
//            same property one level up: an absent `packages/` reads exactly
//            like a root that is not this repository, and this module cannot
//            tell the two apart. Vouching for either is the silent green.
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
// WHAT `fresh` VOUCHES FOR, AND WHAT IT CANNOT
//
// `fresh` means "the RECORDED digest matches the `src/` on disk, and every
// top-level `src/*.ts` has its `dist/*.js`". It is not provenance. The stamp is
// unauthenticated — nothing links it to the artifacts it describes — so a
// hand-written stamp makes a `dist/` built from OLD `src/` read `fresh`, which
// is the failure this module refuses in the other direction. That is not merely
// expensive to close, it is unclosable here: the writer, the verifier and any key
// between them are files in one checkout written by one principal, so an actor
// able to forge the stamp can forge the artifacts or replace this module
// instead. The stamp is gitignored as well, so a forged or hand-edited one is
// invisible to `git status` and to review. The guard reports the records it read;
// it does not vouch for who wrote them.
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
//   - the lock is created — and its owner token written — by one
//     `writeFileSync(lock, token, { flag: 'wx' })`. The `O_CREAT|O_EXCL` open
//     under it is atomic: exactly one process creates the file, every other
//     gets EEXIST and waits;
//   - the winner RE-READS the verdict inside the lock, so a loser that queued
//     behind a build observes the finished artifacts and builds nothing —
//     that double-check is what makes a second run idempotent rather than a
//     second build;
//   - a lock older than `LOCK_STALE_MS` is broken, so a killed process cannot
//     wedge every later run;
//   - the lock file's CONTENT is its holder's token, and only its holder may
//     unlink it. The break above has no ownership test — it cannot have one, the
//     holder it is breaking is by definition not answering — so without a token
//     a broken-but-still-running holder's `finally` deletes the lock the break's
//     WINNER now holds, and a third run then builds alongside the winner;
//   - the lock is released in a `finally`, so a failed build does not leave it.

import { execSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  readFileSync,
  readdirSync,
  renameSync,
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
 * `PACKAGES_BUILD_COMMAND`. Its cost is host-dependent, and on this repository
 * it was measured five times by two agents on 2026-09-24/25: 8909, 8946 and
 * 9277 ms (`.peaks/_runtime/2026-09-24-session-b714c7/qa/cycle3/build-timings.log`,
 * three runs, all `exit=0`) and 13 731 / 14 178 ms (`.peaks/docs/backlog.md`
 * §2.13). Those five are `pnpm build` runs — the whole
 * `package.json#scripts.build` chain, which INCLUDES the packages build as one
 * of its steps — so they are an upper proxy for the command this lock guards,
 * and the margin quoted below is the conservative one. A minute is 6.7x the
 * FASTEST of those and 4.2x the slowest, so a legitimate holder is never cut
 * off — quoted as the range, because one figure for a command with ~60 % host
 * variance is not a fact about the command.
 *
 * (An earlier revision of this comment said "measured at 2.94 s on a warm tree.
 * A minute is ~20x that" — 20x is right, and so was the measurement: 2.94 s is
 * the guarded command itself, `PACKAGES_BUILD_COMMAND` on a warm tree, recorded
 * in `.peaks/_runtime/2026-09-24-session-b714c7/rd/rid-muf2sasw-handoff.md`. It
 * lies BELOW every value in the range above rather than inside it, so it is not
 * the low outlier of that spread and must not be read as a member of it; the
 * retired sentence was wrong about which set the number belonged to, not about
 * the number. It is corrected here rather than quietly dropped because a comment
 * is a claim, and this one would have outlived the tree that disproved it.)
 *
 * Past the minute the run refuses with the lock path and the action rather than
 * blocking on silently. Exported because a bound nobody can read is a bound
 * nobody can hold this module to.
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
 *
 * WHAT THAT ORDERING COSTS, AND WHY IT IS STILL THE RIGHT ONE. This process is
 * itself a lock source, and it needs no second user and no platform that permits
 * one: a run killed between the `open` in `acquireLock` and the `finally` in
 * `ensurePackagesBuilt` leaves its lock behind, and because this bound sits ten
 * times above `LOCK_WAIT_MS`, the lock is never broken early — every later run
 * pays the full wait and then refuses, until the corpse ages out. Measured
 * 2026-09-24 by an independent review and recorded in `.peaks/docs/backlog.md`
 * §2.15 (not re-measured here): a lock file this process did not create, with a
 * fresh mtime, is waited out and refused — `THREW after 8111ms`, `age 8s`.
 *
 * The window is BOUNDED for every pass that REACHES the checks, and it is not a
 * hang: the mechanism that makes that true is the CHECK ORDER inside
 * `acquireLock` — `LOCK_WAIT_MS` is read before this bound is considered — and
 * every pass that reaches that read either refuses or sleeps a poll. ONE PASS
 * IS NOT COVERED, and it is named rather than left to be found: a `statSync`
 * failure above that read `continue`s with neither the bound read nor a sleep.
 * Its only cause reachable here is the transient release race, which costs one
 * pass rather than a hang; the persistent POSIX route is reasoned and disclosed
 * rather than measured (`.peaks/docs/backlog.md` §2.15, which owns the routing).
 * So a lock that is present and CANNOT be unlinked — a directory at the lock
 * path, a foreign-owned file in a sticky `/tmp` — still ends in the refusal
 * rather than in a spin, and the refusal names the lock file and the action, so
 * the cost is a directed message rather than a hunt. That sentence
 * used to be an assertion instead of a consequence: an unlink that kept failing
 * `continue`d past both this bound and the sleep, so the window had no end. And
 * inverting the two bounds is worse in a way that is not recoverable, because a
 * waiter that outlives this bound would break a lock a LIVE holder still holds,
 * and the command this lock guards sits inside a `pnpm build` measured at
 * 8.9-14.2 s here (see `LOCK_WAIT_MS`) — a cold cache, an `npm`-contended CI box
 * or a loaded host can push it past any bound drawn close to it, and two
 * concurrent builds writing the same `dist/` is exactly what this lock exists to
 * prevent.
 * A wait on a corpse costs a minute; a broken live lock corrupts the artifacts
 * the tests then vouch for.
 */
export const LOCK_STALE_MS = LOCK_STALE_MINUTES * MINUTE_MS;

const POLL_MS = 200;
const MAX_NAMED = 8;

/** Bytes in the one-element `Int32Array` that `Atomics.wait` needs as a guard. */
const INT32_BYTES = 4;

/** Hex characters of the project-root digest that key this project's lock file. */
const LOCK_KEY_HEX_CHARS = 16;

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
function stampPathBlocked(projectRoot) {
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
 * yes. This is the second half of a `fresh` verdict: the digest RECORDS the
 * SOURCE side — records it, it does not vouch for who wrote the record, see the
 * header — and this checks the artifacts are all there.
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
function stampBlockedMessage(root) {
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
function noPackagesMessage(root) {
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
function unbuiltMessage(after) {
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

/**
 * Take the lock, or wait for it, or refuse.
 *
 * Returns the token this run WROTE into the lock file. That token is this run's
 * only claim on the file, and `releaseLock` is the only reader of it, so the
 * acquirer has to carry it back to its own `finally` — it is returned rather
 * than stashed anywhere precisely because there is nowhere in this module that
 * a second run could see.
 *
 * @param {string} lock
 * @param {number} waitMs
 * @param {number} pollMs
 * @returns {string} the owner token now recorded in `lock`
 */
function acquireLock(lock, waitMs, pollMs) {
  const deadline = Date.now() + waitMs;
  // A fresh token per attempt, and written by the same `O_CREAT|O_EXCL` call
  // that creates the file: exactly one process can ever get past that call, so
  // exactly one token can ever be the file's first content.
  const token = randomUUID();
  for (;;) {
    try {
      writeFileSync(lock, token, { flag: 'wx' });
      return token;
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
    // The bound is read BEFORE the stale break, and that order is the whole
    // reason this loop terminates. A lock that is present but cannot be
    // unlinked — a directory at the lock path, a foreign-owned file in a sticky
    // /tmp — takes the branch below on EVERY pass, so a `continue` inside it
    // would skip both this check and the `sleep`, and the loop would spin
    // without ever consulting `waitMs`. It falls through to the `sleep` now, so
    // every pass that REACHES this line either refuses or waits a poll — and the
    // one pass that does not reach it is the `statSync` failure above, whose
    // `continue` skips both this check and the sleep (see `LOCK_STALE_MS`).
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
    if (ageMs > LOCK_STALE_MS) {
      try {
        unlinkSync(lock);
      } catch {
        // Another waiter broke it first; the next `open` decides the winner.
      }
    }
    sleep(pollMs);
  }
}

/**
 * Release the lock — but only the one this run took.
 *
 * The ownership test is the file's content against this run's token, and it is
 * load-bearing rather than defensive. A run whose lock was broken as stale while
 * it was still working reaches this function holding a token the file no longer
 * carries: A holds the lock past `LOCK_STALE_MS` → B breaks it and acquires →
 * A's `finally` unlinks B's lock → C acquires alongside B. An unconditional
 * `unlinkSync` here is that whole sequence; comparing first is what makes the
 * stale-break safe to keep.
 *
 * @param {string} lock
 * @param {string | undefined} token the value `acquireLock` returned, i.e. what
 *   this run wrote into `lock` and the only content it is entitled to delete
 */
function releaseLock(lock, token) {
  let held;
  try {
    held = readFileSync(lock, 'utf8');
  } catch {
    // Already gone (broken as stale by a waiter) — nothing to release.
    return;
  }
  if (held !== token) return; // someone else's lock; breaking it is not ours to do
  try {
    unlinkSync(lock);
  } catch {
    // Raced with a waiter between the read above and this unlink. The next
    // `open` decides the winner either way, so there is nothing to repair.
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
 * missing, and throws again if that build did not satisfy the prerequisite;
 * throws when there is no package to check at all; otherwise returns the
 * verdict that the caller can log.
 *
 * @param {string} projectRoot
 * @param {{
 *   log?: (line: string) => void,
 *   runBuild?: (projectRoot: string) => void,
 *   waitMs?: number,
 *   pollMs?: number,
 *   acquireLock?: (lock: string, waitMs: number, pollMs: number) => string | undefined
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
  // It returns the lock's owner token, and `undefined` is honest for a stub that
  // took no lock: `releaseLock` reads the file before deleting it, so a run that
  // wrote nothing releases nothing.
  const takeLock = options.acquireLock ?? acquireLock;

  const before = evaluatePackages(root);
  refuseUnvouchable(before, root);
  if (before.missing.length === 0) return { built: false, ...before };

  const lock = lockPath(root);
  // The token is what entitles this run to release `lock`, so it comes back
  // from the acquire and goes no further than the `finally` that needs it.
  const token = takeLock(lock, waitMs, pollMs);
  try {
    return buildInsideLock(root, log, runBuild);
  } finally {
    releaseLock(lock, token);
  }
}

/**
 * The verdicts this guard refuses to vouch for, in one place so the pre-lock
 * read and the in-lock re-read cannot disagree about what "not actionable"
 * means. Takes the verdict rather than returning one: a refusal here is a
 * throw, and there is nothing to hand back.
 *
 * The `stale` arm asks one further question — whether the stamps could be read at
 * all — because the answer decides which of the two sentences is TRUE, and both
 * callers reach that question through here.
 *
 * @param {{ missing: readonly string[], stale: readonly string[], fresh: readonly string[] }} verdict
 * @param {string} root
 */
function refuseUnvouchable(verdict, root) {
  if (verdict.stale.length > 0) {
    throw new Error(
      stampPathBlocked(root) ? stampBlockedMessage(root) : staleMessage(verdict.stale)
    );
  }
  // The three buckets are total and disjoint over `listPackageRoots`, so an
  // empty `missing` AND an empty `fresh` is the set itself being empty. Not a
  // green: see `noPackagesMessage`.
  if (verdict.missing.length === 0 && verdict.fresh.length === 0) {
    throw new Error(noPackagesMessage(root));
  }
}

/**
 * The build leg, and the only place a `built: true` verdict is produced.
 *
 * Re-reads INSIDE the lock first: a process that queued behind another's build
 * sees the finished artifacts here and builds nothing. Then it builds once, and
 * then asserts what the build left behind — the build's EXIT CODE is not this
 * guard's evidence, because a skipped package or an unfinished emit comes out
 * of a green command, and the log line below would otherwise be a claim about
 * artifacts that are not there.
 *
 * @param {string} root
 * @param {(line: string) => void} log
 * @param {(projectRoot: string) => void} runBuild
 */
function buildInsideLock(root, log, runBuild) {
  const now = evaluatePackages(root);
  refuseUnvouchable(now, root);
  if (now.missing.length === 0) return { built: false, ...now };

  log(
    `[packages-build] no dist/ for ${now.missing.join(', ')} — building: ${PACKAGES_BUILD_COMMAND}\n`
  );
  runBuild(root);
  writePackageDistStamps(root);
  const after = evaluatePackages(root);
  if (after.missing.length > 0 || after.stale.length > 0) {
    throw new Error(unbuiltMessage(after));
  }
  log(
    `[packages-build] built ${after.fresh.length} package(s); the tests below are running against these artifacts\n`
  );
  return { built: true, ...after };
}

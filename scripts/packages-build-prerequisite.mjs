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
//            the `src/` on disk AND `dist/` must contain the emit of it —
//            recursively, on both sides, and that qualifier is load-bearing:
//            until rid-5b6d975f made both walks recurse, this sentence was
//            FALSE as written, and 51 % of the surface (19 of the 37 sources,
//            `peaks-loop-mut` the extreme at 10 of 11) was compared to
//            nothing. With only the first half, this was measured live:
//            `pnpm dev` — whose first step, `sync-version.mjs`, DELETES
//            `packages/peaks-loop-shared/dist/version.js` and its `.d.ts`
//            siblings — leaves a tree that reads `fresh` x4 while the next
//            `test:unit` dies with
//            `Cannot find package 'peaks-loop-shared/version'`. That is a
//            missing artifact wearing a module-resolution error, i.e. the exact
//            shape this module exists to remove.
//
// WHAT IS HERE, AND WHAT MOVED (rid-043). The entry keeps the three facts nothing
// else can state: the POLICY (above), the build leg, and the two refusals that must
// agree with the pre-lock read and the in-lock re-read. The set rule, the walk, the
// stamps, the verdict, the lock and the four refusal SENTENCES each moved to a
// sibling module, and this file re-exports the same public surface it always did.

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import {
  LOCK_WAIT_MS,
  POLL_MS,
  acquireLock,
  lockPath,
  releaseLock
} from './packages-build-lock.mjs';
import {
  noPackagesMessage,
  staleMessage,
  stampBlockedMessage,
  unbuiltMessage
} from './packages-build-messages.mjs';
import { PACKAGES_BUILD_COMMAND } from './packages-build-scope.mjs';
import { stampPathBlocked, writePackageDistStamps } from './packages-build-stamps.mjs';
import { evaluatePackages } from './packages-build-freshness.mjs';

// THE PUBLIC SURFACE, re-exported unchanged so no importer moves. The names this
// module reads itself are imported above; these re-exports cover the rest.
export { PACKAGES_BUILD_COMMAND };
export { PACKAGE_STAMP_RELATIVE_PATH } from './packages-build-stamps.mjs';
export { LOCK_STALE_MS, LOCK_WAIT_MS } from './packages-build-lock.mjs';
export { lockPath } from './packages-build-lock.mjs';
export { listPackageRoots } from './packages-build-scope.mjs';
export { staleMessage } from './packages-build-messages.mjs';
export { writePackageDistStamps } from './packages-build-stamps.mjs';
export { evaluatePackages } from './packages-build-freshness.mjs';

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

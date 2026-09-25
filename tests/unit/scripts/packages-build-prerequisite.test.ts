// tests/unit/scripts/packages-build-prerequisite.test.ts
//
// The build prerequisite of the test entry points: `packages/*/dist` must
// exist, and must have been built from the `packages/*/src` on disk.
//
// The defect: `dist/` is gitignored, so a clean checkout has no package build
// output; all four workspace packages resolve through `node_modules` to built
// `dist/` and are deliberately NOT aliased to `src/`. The failure does not read
// as a missing build — measured on this tree, one unit file fails with
// `Failed to resolve entry for package "peaks-loop-internal-runtime"`, which
// blames `package.json` configuration. `package.json#scripts.pretest` built ONE
// of the four packages and every other entry point had no hook at all.
//
// WHAT THIS FILE HAS TO PROVE, and why each arm is shaped the way it is:
//
//   missing  -> builds, EXACTLY once. The "exactly once" is measured by the
//               stub the call is given, not by reading the module's own state:
//               the build call is the observable, and a guard that asked the
//               module whether it had built would be agreeing with itself.
//   stale    -> THROWS, and does NOT build. The second half is the load-bearing
//               half: the chosen policy is to refuse, not to rebuild silently,
//               so a regression that "helpfully" rebuilt would still pass a
//               test that only checked for the throw.
//   emit     -> `fresh` is a claim about the ARTIFACTS, not only the sources.
//               The digest proves the `src/` side, and a `dist/` with one
//               emitted file missing answers "is there a build here?" yes. That
//               was measured on this repository: `sync-version.mjs` deletes
//               `peaks-loop-shared/dist/version.js` on every `predev` /
//               `pretest` / `build`, all four packages still read `fresh`, and
//               the next `test:unit` dies with
//               `Cannot find package 'peaks-loop-shared/version'` — a missing
//               artifact presenting as a module-resolution error. Both
//               directions of that rule are pinned, because the second is not
//               its mirror: a top-level `src/*.d.ts` produces no `.js` (so it
//               must not be read as an artifact that is missing), and reading
//               it as one makes the package `stale` forever over a tree
//               `check-build-integrity.mjs` calls OK.
//   content  -> the signal is the SOURCES' content, not their mtimes. Both
//               directions are pinned, because they fail in opposite ways: a
//               `touch` must NOT read as stale, and a content edit that
//               preserves the mtime MUST.
//   re-read  -> the verdict is taken AGAIN inside the lock. The pre-lock early
//               return is a different arm, and deleting the re-read used to
//               leave this whole suite green — so the one property the module's
//               idempotency claim stands on rested on nothing a run could fail.
//   result   -> a build that RAN is held to the verdict it left behind. The
//               command is given and its result is asserted, so a
//               `pnpm -r --filter "./packages/*" run build` that exits 0 over a
//               package it skipped is refused instead of logged as "the tests
//               below are running against these artifacts". The stub has to be
//               a build that does NOT emit: `recordingBuild` satisfies the
//               assertion by emitting, so it can only ever have pinned the
//               stub, never the module's own post-build verdict.
//   root     -> the guard's root is the repository, taken from the setup file's
//               own location, not `process.cwd()`. From a subdirectory a
//               cwd-based root finds no `packages/` at all, and a search that
//               finds nothing is refused rather than reported as a green run
//               that had nothing to check.
//   reach    -> the walk really visited the packages, cross-measured against
//               two enumerations that share no traversal with it: git's index,
//               and the `node_modules` links the tests actually resolve
//               through. A hand-kept list of four names would go stale silently
//               the day a fifth package is added — the same shape as the
//               `pretest` hook this slice replaces.
//
// Omitting nothing: all four dimensions have a `describe` below. `render` is a
// real surface here, not a formality — the module writes the line that tells
// the operator an implicit build happened, which is the answer to "does the
// test runner quietly mask a missing CI build step?".

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import setup from '../../_global-setup/packages-build.js';
import { REBUILD_COMMAND } from '../../../scripts/dist-freshness.mjs';
import {
  ensurePackagesBuilt,
  evaluatePackages,
  listPackageRoots,
  LOCK_STALE_MS,
  LOCK_WAIT_MS,
  lockPath,
  PACKAGES_BUILD_COMMAND,
  PACKAGE_STAMP_RELATIVE_PATH,
  staleMessage,
  writePackageDistStamps
} from '../../../scripts/packages-build-prerequisite.mjs';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  BUILT,
  collectLog,
  fixture,
  packageNamesFromGit,
  packageNamesFromNodeModules,
  recordingBuild,
  REPO_ROOT,
  SOURCE_A,
  SOURCE_B,
  writeBuilt
} from '../_setup/packages-build-fixture.js';

declareDimensions('tests/unit/scripts/packages-build-prerequisite.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

// ── integration: the real tree ───────────────────────────────────────

describe('Scenario: integration — the walk covers the real packages/*', () => {
  const walked = listPackageRoots(REPO_ROOT)
    .map((pkg) => pkg.name)
    .sort();

  it('reaches every package git reports under packages/', () => {
    // Set equality, not a count: a dropped subtree or a narrowed root breaks it,
    // and a NEW PACKAGE does not — both sides see it.
    expect(walked).toEqual(packageNamesFromGit());
  });

  it('reaches every package the tests can actually resolve through node_modules', () => {
    expect(walked).toEqual(packageNamesFromNodeModules());
  });

  it('partitions every package it walked into exactly one bucket', () => {
    // State-independent, deliberately: this file must not pin whether the
    // working tree happens to be built right now. What it pins is that the
    // classification is total and disjoint, so no package can be silently
    // dropped from the verdict.
    const verdict = evaluatePackages(REPO_ROOT);
    const bucketed = [...verdict.missing, ...verdict.stale, ...verdict.fresh].sort();

    expect(bucketed).toEqual(walked);
    expect(new Set(bucketed).size).toBe(bucketed.length);
  });

  it('builds with a recursive filter, so pnpm resolves the dependency order', () => {
    // The defect in `pretest` was `--filter peaks-loop-shared`, i.e. one of
    // four. `-r` plus the workspace glob is what makes the command topology-
    // correct without this slice restating the order; the glob is read from
    // `pnpm-workspace.yaml` rather than typed here, so the two cannot drift.
    const workspace = readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toContain('./packages/*');
    expect(PACKAGES_BUILD_COMMAND).toContain('-r ');
    expect(PACKAGES_BUILD_COMMAND).toContain('./packages/*');
    expect(PACKAGES_BUILD_COMMAND).toContain('run build');
  });

  it('keeps the stamps outside every package, so no tarball can carry them', () => {
    // Measured: `files: ["dist/**"]` ships anything inside `dist/`, and
    // `peaks-loop-internal-runtime` ships its whole `src/` because it declares
    // no `files` field at all. Neither may be given a new published file.
    expect(PACKAGE_STAMP_RELATIVE_PATH.startsWith('packages/')).toBe(true);
    expect(PACKAGE_STAMP_RELATIVE_PATH.split('/')).toHaveLength(2);
  });

  it('guards the repository when the runner is started in a subdirectory, because its root is not the cwd', () => {
    // The recorded failure: `cd tests && vitest run --config ../vitest.config.ts
    // unit/cli/vendor-detect.test.ts` printed `[packages-build] 0 workspace
    // package(s) already built from their current src/` and exited 0, while
    // vitest's own root was the repository (`RUN v4.1.10 D:/peaks-loop`). The
    // setup was passing `process.cwd()` — `tests/` — and `tests/packages` does
    // not exist, so `listPackageRoots` answered `[]`, every verdict array was
    // empty, and the prerequisite checked nothing while reporting success. On a
    // clean checkout that is the un-guarded run the preflight exists to prevent.
    // The mutant this case pins is that one line: hand the setup
    // `process.cwd()` back and the line it writes reports 0 packages from a
    // subdirectory.
    //
    // The setup writes its line straight to `process.stdout` — it has no `io`
    // seam to inject the way the CLI does — so the line is read by capturing it.
    // What is called is the real entry point, not a helper: the property has to
    // hold for the thing vitest actually runs.
    const cwd = process.cwd();
    const captured: string[] = [];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      if (typeof chunk === 'string') captured.push(chunk);
      return true;
    });

    try {
      process.chdir(join(REPO_ROOT, 'tests'));
      expect(() => setup()).not.toThrow();
    } finally {
      stdout.mockRestore();
      process.chdir(cwd);
    }

    // The count is deliberately not pinned: this file must not depend on whether
    // the working tree is built right now, and what is pinned is that the guard
    // found the repository's packages instead of none.
    expect(captured.join('')).not.toContain('0 workspace package(s)');
  });
});

// ── behavior: missing, stale, and idempotency ────────────────────────

describe('Scenario: behavior — a missing dist/ is built, exactly once', () => {
  it('builds every package and reports that it was the builder', () => {
    const root = fixture({ a: SOURCE_A, b: SOURCE_A });
    const calls: string[] = [];
    const { lines, log } = collectLog();

    const result = ensurePackagesBuilt(root, { log, runBuild: recordingBuild(calls) });

    expect(calls).toEqual([root]);
    expect(result.built).toBe(true);
    expect([...result.fresh]).toEqual(['a', 'b']);
    expect(evaluatePackages(root).missing).toEqual([]);
    expect(lines.join('')).toContain(PACKAGES_BUILD_COMMAND);
  });

  it('refuses when the build it ran produced no dist/ at all, instead of reporting the tree as built', () => {
    // `pnpm -r --filter "./packages/*" run build` SKIPS a package that does not
    // declare a `build` script and exits 0 (measured: `None of the selected
    // packages has a "zz-no-such-script" script`, EXIT=0), so a package added
    // with a `src/` and no `build` script gets here with no `dist/` at all. The
    // stub is the shape this case exists for: every other missing-dist case is
    // given `recordingBuild`, which really emits, so those cases only ever pin
    // the STUB's effect. A case about the module's own post-build verdict has to
    // be given a build that does not emit.
    const root = fixture({ 'probe-pkg': SOURCE_A });
    const { lines, log } = collectLog();

    expect(() => ensurePackagesBuilt(root, { runBuild: () => {}, log })).toThrowError(
      /refused to start[\s\S]*packages\/probe-pkg\/dist[\s\S]*pnpm build/
    );

    // The control half: the build leg was really reached — the log line below is
    // written before the build runs — and it left no `dist/` to vouch for.
    expect(lines.join('')).toContain('building:');
    expect(existsSync(join(root, 'packages', 'probe-pkg', 'dist'))).toBe(false);
    // And the sentence that made this a silent green is gone: nothing may claim
    // the tests below run against artifacts that do not exist.
    expect(lines.join('')).not.toContain('running against these artifacts');
  });

  it('refuses when the build leaves an incomplete emit, instead of counting it built', () => {
    // The same assertion, other bucket. `dist/` exists here, so the package is
    // not `missing` — the build simply did not emit everything `src/` requires,
    // which is the shape `scripts/sync-version.mjs` produces on every `predev` /
    // `pretest` / `build` by deleting one emitted file. Exit 0, `stale`
    // non-empty, no assertion, and the suite dies one level in with
    // `Cannot find package …` instead of here.
    const root = fixture({ a: SOURCE_A });
    // Written before the build runs, so the stamps taken afterwards cover it:
    // the only thing wrong with this tree is that the artifact is absent.
    writeFileSync(join(root, 'packages', 'a', 'src', 'extra.ts'), SOURCE_A, 'utf8');

    expect(() =>
      // Emits `index.js` and nothing else — the build did not finish the job.
      ensurePackagesBuilt(root, { runBuild: (stubRoot: string) => writeBuilt(stubRoot, 'a') })
    ).toThrowError(/refused to start[\s\S]*packages\/a\/dist[\s\S]*pnpm build/);

    // Control: the build did emit — so this is not the `missing` bucket — and
    // the absent artifact is the whole difference.
    expect(existsSync(join(root, 'packages', 'a', 'dist', 'index.js'))).toBe(true);
    expect(existsSync(join(root, 'packages', 'a', 'dist', 'extra.js'))).toBe(false);
  });

  it('refuses a root with no package to check, instead of returning a verdict it did not establish', () => {
    // The generalisation, and the amplifier behind the cwd defect below: for ANY
    // absent `packages/` the verdict is all-empty by construction —
    // `listPackageRoots` answers `[]` for a directory it cannot read — and an
    // empty verdict is exactly what a wrong root looks like from inside the
    // module. A no-op that reports success is the class this module exists to
    // remove, so the entry point refuses instead of vouching.
    const root = fixture({});

    // Control half: the CLASSIFIER's answer for this tree is empty, and that is
    // the right answer for a classifier — it reports what it saw. Refusing to
    // vouch for that reading is the entry point's job, so it is pinned there.
    expect(evaluatePackages(root)).toEqual({ missing: [], stale: [], fresh: [] });
    expect(() => ensurePackagesBuilt(root, { runBuild: () => {} })).toThrowError(
      /refused to start[\s\S]*packages/
    );
  });

  it('does not build a second time — the second call sees the first call’s artifacts', () => {
    const root = fixture({ a: SOURCE_A });
    const calls: string[] = [];
    const options = { runBuild: recordingBuild(calls) };

    expect(ensurePackagesBuilt(root, options).built).toBe(true);
    const second = ensurePackagesBuilt(root, options);

    expect(calls).toHaveLength(1);
    expect(second.built).toBe(false);
    expect([...second.fresh]).toEqual(['a']);
  });

  it('refuses a stale dist/ instead of rebuilding it', () => {
    const root = fixture({ a: SOURCE_A });
    writeBuilt(root, 'a');
    writePackageDistStamps(root);
    // The source moves on after the build.
    writeFileSync(join(root, 'packages', 'a', 'src', 'index.ts'), SOURCE_B, 'utf8');

    const calls: string[] = [];
    expect(() => ensurePackagesBuilt(root, { runBuild: recordingBuild(calls) })).toThrowError(
      /refused to start/
    );
    // The policy is "fail fast", not "silently rebuild" — so the build stub must
    // NOT have been called.
    expect(calls).toEqual([]);
  });

  it('treats a dist/ with no recorded digest as stale rather than guessing it is fresh', () => {
    // "We cannot prove this was built from these sources" and "it is fresh" are
    // not the same sentence. This is also the state of every tree built before
    // this prerequisite existed, so it is the first run's real experience.
    const root = fixture({ a: SOURCE_A });
    writeBuilt(root, 'a');

    expect(evaluatePackages(root).stale).toEqual(['a']);
  });

  it('refuses a dist/ that is missing an emitted file, rather than vouching for it', () => {
    // The defect this arm exists for, measured on the real repository:
    // `scripts/sync-version.mjs` deletes `packages/peaks-loop-shared/dist/
    // version.js` on every `predev` / `pretest` / `build`, and because the
    // digest reads `src/` — whose `version.ts` was byte-identical — every
    // package read `fresh` over a tree that could not resolve its own export.
    // A `fresh` verdict has to mean "the artifacts are here", or the suite
    // reports a module-resolution error two minutes later instead of this.
    const root = fixture({ a: SOURCE_A });
    writeBuilt(root, 'a');
    // The source is written BEFORE the digest is taken, so the stamp covers it:
    // the only thing wrong with this tree is that the artifact for it is absent.
    // (Taken in the other order this case passes for the DIGEST's reason, not
    // the artifact's — which is not what it is here to pin.)
    writeFileSync(join(root, 'packages', 'a', 'src', 'version.ts'), SOURCE_A, 'utf8');
    writePackageDistStamps(root);

    // The control half, so the assertion below cannot be about the sources: the
    // same tree WITH the artifact is fresh.
    const artifact = join(root, 'packages', 'a', 'dist', 'version.js');
    writeFileSync(artifact, BUILT, 'utf8');
    expect(evaluatePackages(root).fresh).toEqual(['a']);

    // Now the deletion — the same file, on the same tree, that
    // `scripts/sync-version.mjs` performs on every `predev` / `pretest` /
    // `build`.
    rmSync(artifact, { force: true });

    expect(evaluatePackages(root).fresh).toEqual([]);
    expect(evaluatePackages(root).stale).toEqual(['a']);

    // And the refusal is the one the operator gets: named package, named fix,
    // and no build, so the tree is not repaired behind their back.
    const calls: string[] = [];
    expect(() => ensurePackagesBuilt(root, { runBuild: recordingBuild(calls) })).toThrowError(
      /refused to start/
    );
    expect(calls).toEqual([]);
  });

  it('does not expect a dist artifact for a pure .d.ts source, which tsc emits nothing for', () => {
    // The other half of the rule above, and the half a deleted predicate takes
    // with it. A top-level `src/*.d.ts` is an INPUT to tsc that produces no
    // `.js` of its own — measured on this repository with both probes in
    // `packages/peaks-loop-mut/src` at once, so it cannot be a statement about
    // tsc not having run: the `.ts` probe emitted `.d.ts` + `.d.ts.map` + `.js`,
    // the `.d.ts` probe emitted NOTHING. Read as a source whose artifact is
    // missing, a package holding one is `stale` FOREVER — and because
    // `scripts/check-build-integrity.mjs` applies the same carve-out, it exits
    // 0 on this tree, so the refusal names `pnpm build` as the remedy and no
    // build can ever clear it.
    const root = fixture({ a: SOURCE_A });
    writeBuilt(root, 'a');
    // Written BEFORE the stamp, so the digest covers it: nothing here is stale
    // for the digest's reason, and the only question left is the emit rule.
    writeFileSync(
      join(root, 'packages', 'a', 'src', 'decl-only.d.ts'),
      'declare const d: number;\n',
      'utf8'
    );
    writePackageDistStamps(root);

    expect(evaluatePackages(root)).toEqual({ missing: [], stale: [], fresh: ['a'] });

    // The functional half: the suite proceeds. With the carve-out gone this
    // throws the refusal instead, over a tree the build pipeline calls OK.
    expect(ensurePackagesBuilt(root, { runBuild: recordingBuild([]) }).built).toBe(false);
  });

  it('does not take a stamp written by a different stamp version', () => {
    // The stamp's `version` is the digest's input definition. A stamp from
    // another one is exactly as unusable as no stamp at all, and the verdict may
    // not depend on the file merely existing — that is what would silently
    // vouch for a digest this module no longer computes.
    const root = fixture({ a: SOURCE_A });
    writeBuilt(root, 'a');
    writePackageDistStamps(root);
    expect(evaluatePackages(root).fresh).toEqual(['a']);

    const stampsPath = join(root, PACKAGE_STAMP_RELATIVE_PATH);
    const parsed = JSON.parse(readFileSync(stampsPath, 'utf8')) as { version: number };
    writeFileSync(stampsPath, JSON.stringify({ ...parsed, version: parsed.version + 1 }), 'utf8');

    expect(evaluatePackages(root).stale).toEqual(['a']);
  });

  it('reports a dist/ with no JavaScript as missing, not built', () => {
    // `hasBuild` is the `.js` filter, and it is the whole difference between
    // this verdict and the one above: a `dist/` holding declarations only is not
    // a build. Counting any file there would judge the package on a digest that
    // cannot correspond to an artifact.
    const root = fixture({ a: SOURCE_A });
    const dist = join(root, 'packages', 'a', 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, 'index.d.ts'), 'export declare const a: 1;\n', 'utf8');
    // The digest matches; the emit is what is absent.
    writePackageDistStamps(root);

    expect(evaluatePackages(root)).toEqual({ missing: ['a'], stale: [], fresh: [] });
  });

  it('reports a package with no build output as missing, not stale', () => {
    const root = fixture({ a: SOURCE_A, b: SOURCE_A });
    writeBuilt(root, 'a');
    writePackageDistStamps(root);

    expect(evaluatePackages(root)).toEqual({ missing: ['b'], stale: [], fresh: ['a'] });
  });
});

// ── behavior: content, not mtime ─────────────────────────────────────

describe('Scenario: behavior — the staleness signal is content-derived', () => {
  it('stays fresh when a source is touched but not changed', () => {
    // Why this arm exists at all, and why it is not optional on this axis:
    // `scripts/sync-version.mjs` rewrites
    // `packages/peaks-loop-shared/src/version.ts` on every `pretest`, so an
    // mtime rule would read that package as stale on every single run.
    const root = fixture({ a: SOURCE_A });
    writeBuilt(root, 'a');
    writePackageDistStamps(root);

    const far = Date.now() + 60_000;
    utimesSync(join(root, 'packages', 'a', 'src', 'index.ts'), far / 1000, far / 1000);

    expect(evaluatePackages(root).fresh).toEqual(['a']);
    expect(ensurePackagesBuilt(root, { runBuild: recordingBuild([]) }).built).toBe(false);
  });

  it('is stale when a source changes but its mtime is restored', () => {
    // The case an mtime rule CANNOT see: same length, same mtime, different
    // text. The test makes the contrast explicit rather than asserting it.
    const root = fixture({ a: SOURCE_A });
    writeBuilt(root, 'a');
    writePackageDistStamps(root);

    const source = join(root, 'packages', 'a', 'src', 'index.ts');
    const before = statSync(source);
    expect(SOURCE_A.length).toBe(SOURCE_B.length);
    writeFileSync(source, SOURCE_B, 'utf8');
    utimesSync(source, before.atime, before.mtime);
    expect(Math.abs(statSync(source).mtimeMs - before.mtimeMs)).toBeLessThan(1);

    expect(evaluatePackages(root).stale).toEqual(['a']);
  });

  it('is stale when a package is added after the stamps were written', () => {
    const root = fixture({ a: SOURCE_A });
    writeBuilt(root, 'a');
    writePackageDistStamps(root);
    expect(evaluatePackages(root).fresh).toEqual(['a']);

    const src = join(root, 'packages', 'b', 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'index.ts'), SOURCE_A, 'utf8');

    // `b` has no dist/ yet, so it is missing; `a` is still provably fresh.
    expect(evaluatePackages(root)).toEqual({ missing: ['b'], stale: [], fresh: ['a'] });
  });
});

// ── integration: the lock ────────────────────────────────────────────

describe('Scenario: integration — the build lock', () => {
  it('waits on a held lock and then refuses rather than building alongside it', () => {
    const root = fixture({ a: SOURCE_A });
    const lock = lockPath(root);
    writeFileSync(lock, '', 'utf8');

    const calls: string[] = [];
    let thrown: Error | undefined;
    try {
      ensurePackagesBuilt(root, { runBuild: recordingBuild(calls), waitMs: 60, pollMs: 10 });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown?.message).toContain('holds the packages build lock');
    // The refusal has to be actionable on its own: the file to look at, and the
    // sentence that says what to do about it.
    expect(thrown?.message).toContain(lock);
    expect(thrown?.message).toContain('delete that file');
    expect(calls).toEqual([]);
  });

  it('reports the wait it actually paid, not a constant', () => {
    // The give-up text derives both numbers it prints, and a derivation nobody
    // asserts is one that can quietly become a literal: the message still reads
    // as a sentence, and is then wrong about the run it is describing. 2000 is
    // deliberately NOT a value the module itself holds, so a message printing
    // `LOCK_WAIT_MS` — the realistic regression, and the one a reader would
    // find plausible — is distinguishable from the one that waited.
    const root = fixture({ a: SOURCE_A });
    writeFileSync(lockPath(root), '', 'utf8');

    expect(() =>
      ensurePackagesBuilt(root, { runBuild: recordingBuild([]), waitMs: 2000, pollMs: 10 })
    ).toThrowError(/gave up after 2s/);
  });

  it('reports the age it measured off the lock file, not a constant', () => {
    // The other half of the same sentence. The age is the last `statSync` of the
    // lock, and it is the half that tells the reader whether they are queueing
    // behind a live build or a corpse — a literal there misreports the one thing
    // the message exists to distinguish.
    const root = fixture({ a: SOURCE_A });
    const lock = lockPath(root);
    writeFileSync(lock, '', 'utf8');
    // Held for 30 s: far from every value a literal would plausibly carry, and
    // far below LOCK_STALE_MS, so this lock is contended and not breakable.
    const held = (Date.now() - 30_000) / 1000;
    utimesSync(lock, held, held);

    // `waitMs: 0` so the throw lands on the first pass of the loop: the age
    // reported is then the one read at entry, and the case is not a race.
    expect(() =>
      ensurePackagesBuilt(root, { runBuild: recordingBuild([]), waitMs: 0, pollMs: 1 })
    ).toThrowError(/age 30s/);
  });

  it('re-reads the verdict inside the lock, so a run that queued behind a build builds nothing', () => {
    // This is the half that makes a second run idempotent rather than a second
    // build, and the next test is NOT this arm: that one exercises the pre-lock
    // early return. The re-read only matters when a run queues behind another's
    // build — it has already seen `missing`, and must see the finished
    // artifacts when it finally holds the lock. The wait is injected so that
    // state can be presented rather than raced for.
    const root = fixture({ a: SOURCE_A });
    const calls: string[] = [];

    const result = ensurePackagesBuilt(root, {
      runBuild: recordingBuild(calls),
      acquireLock: () => {
        // "The holder finished while we waited."
        writeBuilt(root, 'a');
        writePackageDistStamps(root);
      }
    });

    expect(calls).toEqual([]);
    expect(result.built).toBe(false);
    expect([...result.fresh]).toEqual(['a']);
  });

  it('breaks a lock left behind by a killed process', () => {
    const root = fixture({ a: SOURCE_A });
    const lock = lockPath(root);
    writeFileSync(lock, '', 'utf8');
    // Older than the module's staleness window, so it cannot be a live build.
    const longAgo = Date.now() - 60 * 60_000;
    utimesSync(lock, longAgo / 1000, longAgo / 1000);

    const calls: string[] = [];
    const result = ensurePackagesBuilt(root, { runBuild: recordingBuild(calls), waitMs: 60 });

    expect(result.built).toBe(true);
    expect(calls).toEqual([root]);
  });

  it('releases the lock, so a later run is not wedged by an earlier one', () => {
    const root = fixture({ a: SOURCE_A });
    expect(ensurePackagesBuilt(root, { runBuild: recordingBuild([]) }).built).toBe(true);

    // The direct observable: nothing of the lock is left on disk.
    expect(existsSync(lockPath(root))).toBe(false);

    // And the functional half — which has to be a run that NEEDS the lock. The
    // earlier shape of this test called with a fresh tree, which early-returns
    // before it ever reaches the lock, so a lock that was never released left it
    // green. Removing the artifact puts the lock back in this call's path.
    rmSync(join(root, 'packages', 'a', 'dist'), { recursive: true, force: true });
    const second = ensurePackagesBuilt(root, {
      runBuild: recordingBuild([]),
      waitMs: 0,
      pollMs: 1
    });

    expect(second.built).toBe(true);
  });

  it('cannot be created at all: that failure comes out in this module’s own vocabulary', () => {
    // The only path that takes the lock is the one that NEEDS a build, so a
    // fresh container is exactly where this lands, and a raw `ENOENT` there
    // names neither the file nor the fix. The lock path is pointed at a
    // directory that does not exist rather than mocked, so this is the real
    // `writeFileSync` failing — the `wx` create that takes the lock.
    const root = fixture({ a: SOURCE_A });
    const previous = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
    let thrown: Error | undefined;
    try {
      const missing = join(root, 'no-such-temp-directory');
      process.env.TMPDIR = missing;
      process.env.TMP = missing;
      process.env.TEMP = missing;

      ensurePackagesBuilt(root, { runBuild: recordingBuild([]) });
    } catch (error) {
      thrown = error as Error;
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown?.message).toContain('Cannot create the packages build lock');
    expect(thrown?.message).toContain('no-such-temp-directory');
    expect(thrown?.message).toMatch(/temp/i);
    // The original failure is kept, not replaced: the code is the detail that
    // says which filesystem condition it was.
    expect((thrown?.cause as NodeJS.ErrnoException)?.code).toBe('ENOENT');
  });

  it('bounds the wait a developer pays below the age a dead lock must reach', () => {
    // These are not the same question, and reading them off each other is how
    // the previous pair went wrong (a 5-minute block against a 10-minute break:
    // the block is what a developer feels, and it is ~100x the work it waits
    // for — `pnpm -r --filter "./packages/*" run build`, measured at 2.94 s).
    expect(LOCK_WAIT_MS).toBeLessThanOrEqual(60_000);
    // The break must stay LONGER than the wait: a waiter refuses before it could
    // ever break the lock it was waiting on, so this bound serves the later run
    // that finds a crashed holder's lock already old — not the queued one.
    expect(LOCK_STALE_MS).toBeGreaterThan(LOCK_WAIT_MS);
  });
});

// ── render: what the operator sees ───────────────────────────────────

describe('Scenario: render — the run states whether it built', () => {
  it('names the packages it is about to build, and the command it runs', () => {
    // This line is the answer to "does an implicit build mask a missing CI
    // build step?" — the run cannot be silent about having built.
    const root = fixture({ a: SOURCE_A, b: SOURCE_A });
    const { lines, log } = collectLog();

    ensurePackagesBuilt(root, { log, runBuild: recordingBuild([]) });

    const text = lines.join('');
    expect(text).toContain('a, b');
    expect(text).toContain(PACKAGES_BUILD_COMMAND);
    expect(text).toContain('the tests below are running against these artifacts');
  });

  it('writes nothing when nothing needed building', () => {
    // The complementary half: a fresh tree produces no build chatter, so the
    // line above means something when it does appear.
    const root = fixture({ a: SOURCE_A });
    ensurePackagesBuilt(root, { runBuild: recordingBuild([]) });
    const { lines, log } = collectLog();

    const result = ensurePackagesBuilt(root, { log, runBuild: recordingBuild([]) });

    expect(result.built).toBe(false);
    expect(lines).toEqual([]);
  });
});

// ── a11y: the refusal ────────────────────────────────────────────────

describe('Scenario: a11y — the refusal names the packages and the exact remedy', () => {
  it('names every stale package and the exact remediation command', () => {
    const message = staleMessage(['peaks-loop-shared', 'peaks-loop-mut']);

    expect(message).toContain('packages/peaks-loop-shared/dist');
    expect(message).toContain('packages/peaks-loop-mut/dist');
    expect(message).toContain(REBUILD_COMMAND);
    expect(message).toContain('refused to start');
  });

  it('says the build is not silent, not that the packages are merely old', () => {
    // The reader has to know the suite did NOT rebuild for them, or the fix
    // reads as optional.
    expect(staleMessage(['peaks-loop-shared'])).toContain('not rebuilt silently');
  });

  it('carries the same text out of a real refusal', () => {
    const root = fixture({ a: SOURCE_A });
    writeBuilt(root, 'a');

    let thrown: Error | undefined;
    try {
      ensurePackagesBuilt(root, { runBuild: recordingBuild([]) });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown?.message).toContain('packages/a/dist');
    expect(thrown?.message).toContain(REBUILD_COMMAND);
  });
});

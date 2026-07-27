import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, afterAll, describe, expect, test } from 'vitest';

// rid-015 — monorepo-wide version synchronization in scripts/bump-version.mjs.
//
// Before rid-015 the script bumped ONLY packages/peaks-loop-shared in
// lockstep with root. Every other publishable workspace package
// (7 more, 8 total today) kept a frozen version, so `pnpm pack`
// rewrote each `workspace:*` dependency to a stale pin — the same
// class of defect as the 4.0.0-beta.35 CLI_VERSION lag, just spread
// across 7 additional tarballs.
//
// Acceptance criteria locked here:
//   AC1 — Every valid publishable package under packages/* receives
//         the patch-bump synchronization when root advances.
//   AC2 — Packages whose version is NOT a clean x.y.z are skipped
//         (preserves the pre-existing fixture-marker escape hatch,
//         e.g. `9.9.9-oldsub`).
//   AC3 — Registry idempotency is preserved: when root already equals
//         `npm view peaks-loop dist-tags.latest`, NOTHING is written.
//   AC4 — Root bump semantics are unchanged (--to / PEAKS_NEXT_MAJOR /
//         default patch policy, and the exit-1 invalid-target gate).
//   AC5 — Repeated bumps keep root and every package advancing in
//         lockstep (no drift, no double-bump).
//
// 4-dimension convention (.peaks/standards/typescript/testing.md):
// only `integration` and `a11y` are present. `render` and `behavior`
// are deliberately omitted because bump-version.mjs is a standalone
// executable script with no importable pure surface — every reachable
// code path crosses the process/fs boundary, so an in-process
// render/behavior case cannot exist without first refactoring the
// production script (out of scope for this slice, Karpathy §3).
//
// Hermetic: no network. `npm view` is shimmed via a fake `npm` on
// PATH; every mutation happens inside a mkdtemp throwaway repo so the
// real worktree manifests are never written.

const projectRoot = resolve(__dirname, '..', '..', '..');
const helperPath = resolve(projectRoot, 'scripts', 'bump-version.mjs');
const realPackagesDir = resolve(projectRoot, 'packages');
const pathSep = process.platform === 'win32' ? ';' : ':';

let fakeBinDir: string;

/** Build a fake `npm` on PATH so registryLatest() never hits the network. */
beforeAll(() => {
  fakeBinDir = mkdtempSync(join(tmpdir(), 'peaks-bump-mono-npm-'));
  const isWin = process.platform === 'win32';
  const shimJs = join(fakeBinDir, 'npm-shim.js');
  writeFileSync(
    join(fakeBinDir, isWin ? 'npm.cmd' : 'npm'),
    isWin ? '@echo off\r\nnode "%~dp0npm-shim.js" %*\r\n' : '#!/bin/sh\nexec node "$(dirname "$0")/npm-shim.js" "$@"\n',
    { encoding: 'utf8', mode: 0o755 },
  );
  writeFileSync(
    shimJs,
    [
      '// Test-only npm shim: deterministic dist-tags.latest, no network.',
      'const args = process.argv.slice(2);',
      'const raw = process.env.PEAKS_TEST_NPM_LATEST || "0.0.0-not-published";',
      'if (args[0] === "view" && args[1] === "peaks-loop" && args[2] === "dist-tags.latest") {',
      '  process.stdout.write(JSON.stringify(raw) + "\\n");',
      '  process.exit(0);',
      '}',
      'process.exit(1);',
    ].join('\n'),
    'utf8',
  );
});

afterAll(() => {
  rmSync(fakeBinDir, { recursive: true, force: true });
});

interface PackageManifest { name?: string; version?: string; private?: boolean }

/** Real publishable workspace packages, discovered dynamically so a
 *  package added (or removed) later is covered without test edits. */
function discoverRealPackages(): { dir: string; manifest: PackageManifest }[] {
  return readdirSync(realPackagesDir)
    .filter((entry) => {
      const full = join(realPackagesDir, entry);
      return statSync(full).isDirectory() && readdirSync(full).includes('package.json');
    })
    .map((dir) => ({
      dir,
      manifest: JSON.parse(readFileSync(join(realPackagesDir, dir, 'package.json'), 'utf8')) as PackageManifest,
    }));
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function readJson(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest;
}

const tempRepos: string[] = [];

/** Throwaway repo containing only what bump-version.mjs reads. */
function createTempRepo(opts: {
  rootVersion: string;
  packages: Record<string, PackageManifest>;
  looseFiles?: string[];
  emptyDirs?: string[];
}): string {
  const repo = mkdtempSync(join(tmpdir(), 'peaks-bump-mono-'));
  tempRepos.push(repo);
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  copyFileSync(helperPath, join(repo, 'scripts', 'bump-version.mjs'));
  writeJson(join(repo, 'package.json'), { name: 'peaks-loop', version: opts.rootVersion });
  mkdirSync(join(repo, 'packages'), { recursive: true });
  for (const [dir, manifest] of Object.entries(opts.packages)) {
    mkdirSync(join(repo, 'packages', dir), { recursive: true });
    writeJson(join(repo, 'packages', dir, 'package.json'), manifest);
  }
  for (const file of opts.looseFiles ?? []) writeFileSync(join(repo, 'packages', file), '', 'utf8');
  for (const dir of opts.emptyDirs ?? []) mkdirSync(join(repo, 'packages', dir), { recursive: true });
  return repo;
}

afterAll(() => {
  for (const repo of tempRepos) rmSync(repo, { recursive: true, force: true });
});

function runBump(
  repo: string,
  opts: { args?: string[]; env?: Record<string, string> } = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [join(repo, 'scripts', 'bump-version.mjs'), ...(opts.args ?? [])], {
    cwd: repo,
    env: {
      ...process.env,
      PATH: `${fakeBinDir}${pathSep}${process.env.PATH ?? ''}`,
      // Neutralize inherited operator overrides so each case controls
      // exactly one input.
      PEAKS_NEXT_VERSION: '',
      PEAKS_NEXT_MAJOR: '',
      ...(opts.env ?? {}),
    },
    stdio: 'pipe',
    shell: false,
  });
  return {
    status: result.status,
    stdout: result.stdout?.toString('utf8') ?? '',
    stderr: result.stderr?.toString('utf8') ?? '',
  };
}

function packageVersion(repo: string, dir: string): string | undefined {
  return readJson(join(repo, 'packages', dir, 'package.json')).version;
}

function rootVersion(repo: string): string | undefined {
  return readJson(join(repo, 'package.json')).version;
}

function patchPlusOne(version: string): string {
  const [major, minor, patch] = version.split('.');
  return `${major}.${minor}.${Number(patch) + 1}`;
}

describe('integration — bump-version.mjs monorepo-wide package synchronization (rid-015)', () => {
  test('AC1 — every publishable package under packages/* is patch-bumped when root advances', () => {
    const real = discoverRealPackages();
    expect(real.length, 'the real repo must expose the publishable package set under packages/*').toBeGreaterThan(1);

    // Mirror the real package directory set so a newly added package is
    // covered without editing this test.
    const fixtures: Record<string, PackageManifest> = {};
    real.forEach(({ dir, manifest }, index) => {
      fixtures[dir] = { name: manifest.name ?? dir, version: `0.0.${index + 1}` };
    });

    const repo = createTempRepo({ rootVersion: '4.0.0-beta.40', packages: fixtures });
    const result = runBump(repo);

    expect(result.status, `bump must exit 0; stderr=${result.stderr}`).toBe(0);
    expect(rootVersion(repo), 'root must advance by the default patch policy').toBe('4.0.0-beta.41');
    for (const [dir, manifest] of Object.entries(fixtures)) {
      expect(packageVersion(repo, dir), `${dir} must be patch-bumped in lockstep with root`).toBe(
        patchPlusOne(manifest.version as string),
      );
    }
  }, 60_000);

  test('AC1 — the real repository package set is entirely eligible for synchronization', () => {
    // Guards the premise of AC1: if a package is introduced with a
    // non-semver or private manifest, this fails loudly instead of the
    // package silently dropping out of the release train.
    for (const { dir, manifest } of discoverRealPackages()) {
      expect(manifest.version, `packages/${dir} must carry a clean x.y.z version`).toMatch(/^\d+\.\d+\.\d+$/);
      expect(manifest.private, `packages/${dir} must be publishable (private must not be true)`).not.toBe(true);
    }
  });

  test('AC2 — a package whose version is not a clean x.y.z is skipped, siblings still bump', () => {
    const repo = createTempRepo({
      rootVersion: '4.0.0-beta.40',
      packages: {
        'peaks-loop-shared': { name: 'peaks-loop-shared', version: '0.0.26' },
        'peaks-loop-fixture': { name: 'peaks-loop-fixture', version: '9.9.9-oldsub' },
        'peaks-loop-nover': { name: 'peaks-loop-nover' },
      },
    });
    const result = runBump(repo);

    expect(result.status, `bump must exit 0; stderr=${result.stderr}`).toBe(0);
    expect(packageVersion(repo, 'peaks-loop-shared'), 'clean semver sibling must still bump').toBe('0.0.27');
    expect(packageVersion(repo, 'peaks-loop-fixture'), 'prerelease fixture marker must be left alone').toBe('9.9.9-oldsub');
    expect(packageVersion(repo, 'peaks-loop-nover'), 'missing version must be left alone').toBeUndefined();
  }, 60_000);

  test('AC2 — a private package is skipped', () => {
    const repo = createTempRepo({
      rootVersion: '4.0.0-beta.40',
      packages: {
        'peaks-loop-shared': { name: 'peaks-loop-shared', version: '0.0.26' },
        'peaks-loop-internal': { name: 'peaks-loop-internal', version: '1.2.3', private: true },
      },
    });
    const result = runBump(repo);

    expect(result.status, `bump must exit 0; stderr=${result.stderr}`).toBe(0);
    expect(packageVersion(repo, 'peaks-loop-shared')).toBe('0.0.27');
    expect(packageVersion(repo, 'peaks-loop-internal'), 'private package must not be bumped').toBe('1.2.3');
  }, 60_000);

  test('AC2 — loose files and package.json-less directories under packages/ are ignored without error', () => {
    const repo = createTempRepo({
      rootVersion: '4.0.0-beta.40',
      packages: { 'peaks-loop-shared': { name: 'peaks-loop-shared', version: '0.0.26' } },
      looseFiles: ['.gitkeep', 'README.md'],
      emptyDirs: ['scratch'],
    });
    const result = runBump(repo);

    expect(result.status, `bump must exit 0; stderr=${result.stderr}`).toBe(0);
    expect(packageVersion(repo, 'peaks-loop-shared')).toBe('0.0.27');
  }, 60_000);

  test('AC3 — registry idempotency: nothing is written when root already equals dist-tags.latest', () => {
    const repo = createTempRepo({
      rootVersion: '4.0.0-beta.40',
      packages: {
        'peaks-loop-shared': { name: 'peaks-loop-shared', version: '0.0.26' },
        'peaks-loop-doctor': { name: 'peaks-loop-doctor', version: '0.0.12' },
      },
    });
    const result = runBump(repo, { env: { PEAKS_TEST_NPM_LATEST: '4.0.0-beta.40' } });

    expect(result.status, `bump must exit 0; stderr=${result.stderr}`).toBe(0);
    expect(rootVersion(repo), 'root must stay put on the idempotency path').toBe('4.0.0-beta.40');
    expect(packageVersion(repo, 'peaks-loop-shared'), 'no package may be bumped on the idempotency path').toBe('0.0.26');
    expect(packageVersion(repo, 'peaks-loop-doctor'), 'no package may be bumped on the idempotency path').toBe('0.0.12');
  }, 60_000);

  test('AC4 — root bump semantics preserved: --to pins root, packages still advance once', () => {
    const repo = createTempRepo({
      rootVersion: '4.0.0-beta.40',
      packages: {
        'peaks-loop-shared': { name: 'peaks-loop-shared', version: '0.0.26' },
        'peaks-loop-mut': { name: 'peaks-loop-mut', version: '0.1.1' },
      },
    });
    const result = runBump(repo, { args: ['--to', '4.0.0'] });

    expect(result.status, `bump must exit 0; stderr=${result.stderr}`).toBe(0);
    expect(rootVersion(repo), '--to must pin root exactly').toBe('4.0.0');
    expect(packageVersion(repo, 'peaks-loop-shared')).toBe('0.0.27');
    expect(packageVersion(repo, 'peaks-loop-mut')).toBe('0.1.2');
  }, 60_000);

  test('AC4 — root bump semantics preserved: PEAKS_NEXT_MAJOR bumps the major bit', () => {
    const repo = createTempRepo({
      rootVersion: '4.0.1',
      packages: { 'peaks-loop-shared': { name: 'peaks-loop-shared', version: '0.0.26' } },
    });
    const result = runBump(repo, { env: { PEAKS_NEXT_MAJOR: '5' } });

    expect(result.status, `bump must exit 0; stderr=${result.stderr}`).toBe(0);
    expect(rootVersion(repo), 'PEAKS_NEXT_MAJOR must bump the major bit').toBe('5.0.0');
    expect(packageVersion(repo, 'peaks-loop-shared'), 'packages keep the patch-bump policy under a major root bump').toBe('0.0.27');
  }, 60_000);

  test('AC5 — three successive bumps keep root and every package advancing in lockstep', () => {
    const repo = createTempRepo({
      rootVersion: '4.0.0-beta.40',
      packages: {
        'peaks-loop-shared': { name: 'peaks-loop-shared', version: '0.0.26' },
        'peaks-loop-doctor': { name: 'peaks-loop-doctor', version: '0.0.12' },
        'peaks-loop-mut': { name: 'peaks-loop-mut', version: '0.1.1' },
      },
    });

    const expected = [
      { root: '4.0.0-beta.41', shared: '0.0.27', doctor: '0.0.13', mut: '0.1.2' },
      { root: '4.0.0-beta.42', shared: '0.0.28', doctor: '0.0.14', mut: '0.1.3' },
      { root: '4.0.0-beta.43', shared: '0.0.29', doctor: '0.0.15', mut: '0.1.4' },
    ];

    for (const [index, want] of expected.entries()) {
      const result = runBump(repo);
      expect(result.status, `bump #${index + 1} must exit 0; stderr=${result.stderr}`).toBe(0);
      expect(rootVersion(repo), `root after bump #${index + 1}`).toBe(want.root);
      expect(packageVersion(repo, 'peaks-loop-shared'), `shared after bump #${index + 1}`).toBe(want.shared);
      expect(packageVersion(repo, 'peaks-loop-doctor'), `doctor after bump #${index + 1}`).toBe(want.doctor);
      expect(packageVersion(repo, 'peaks-loop-mut'), `mut after bump #${index + 1}`).toBe(want.mut);
    }
  }, 90_000);
});

describe('a11y — bump-version.mjs surfaces every per-package decision to the operator', () => {
  test('logs an old -> new line for each bumped package', () => {
    const repo = createTempRepo({
      rootVersion: '4.0.0-beta.40',
      packages: {
        'peaks-loop-shared': { name: 'peaks-loop-shared', version: '0.0.26' },
        'peaks-loop-doctor': { name: 'peaks-loop-doctor', version: '0.0.12' },
      },
    });
    const result = runBump(repo);

    expect(result.status, `bump must exit 0; stderr=${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/peaks-loop-shared 0\.0\.26 -> 0\.0\.27/);
    expect(result.stdout).toMatch(/peaks-loop-doctor 0\.0\.12 -> 0\.0\.13/);
    expect(result.stdout, 'root transition must remain visible').toMatch(/peaks-loop 4\.0\.0-beta\.40 -> 4\.0\.0-beta\.41/);
  }, 60_000);

  test('logs an explicit skip line naming the non-semver package', () => {
    const repo = createTempRepo({
      rootVersion: '4.0.0-beta.40',
      packages: { 'peaks-loop-fixture': { name: 'peaks-loop-fixture', version: '9.9.9-oldsub' } },
    });
    const result = runBump(repo);

    expect(result.status, `bump must exit 0; stderr=${result.stderr}`).toBe(0);
    expect(result.stdout, 'the skip must be attributable to a specific package').toMatch(
      /peaks-loop-fixture version "9\.9\.9-oldsub" is not x\.y\.z; skipping auto-bump/,
    );
  }, 60_000);

  test('exits 1 with a diagnostic when --to is not valid SemVer, and writes nothing', () => {
    const repo = createTempRepo({
      rootVersion: '4.0.0-beta.40',
      packages: { 'peaks-loop-shared': { name: 'peaks-loop-shared', version: '0.0.26' } },
    });
    const result = runBump(repo, { args: ['--to', 'not-a-version'] });

    expect(result.status, 'invalid --to must fail fast').toBe(1);
    expect(result.stderr).toMatch(/is not a valid SemVer/);
    expect(rootVersion(repo), 'the failed run must not mutate root').toBe('4.0.0-beta.40');
    expect(packageVersion(repo, 'peaks-loop-shared'), 'the failed run must not mutate any package').toBe('0.0.26');
  }, 60_000);
});

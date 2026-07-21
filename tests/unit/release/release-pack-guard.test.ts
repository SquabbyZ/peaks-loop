import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  runPnpm,
  toPosixPath,
  verifyTarball,
} from '../../../scripts/_release-shared.mjs';

// TDD regression gate for scripts/release-pack.mjs's verification
// step. Item (3) of the 2026-07-21 review: the test calls the
// production `verifyTarball` from `_release-shared.mjs` directly,
// not a mirrored predicate, so a future refactor of the helper
// that loosens the check surfaces here without any test-side
// drift.

const projectRoot = resolve(__dirname, '..', '..', '..');
const helperPath = resolve(projectRoot, 'scripts', 'release-pack.mjs');

interface Spec { name: string; pkgDir: string; version: string; }

const PACKAGES: { pkgDir: string }[] = [
  { pkgDir: resolve(projectRoot, 'packages', 'peaks-loop-shared') },
  { pkgDir: resolve(projectRoot, 'packages', 'peaks-loop-doctor') },
  { pkgDir: resolve(projectRoot, 'packages', 'peaks-loop-final-review') },
  // Item (5): the root `peaks-loop` tarball must also be green.
  { pkgDir: projectRoot },
];

function readSpec(pkgDir: string): Spec {
  const j = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8')) as { name: string; version: string };
  return { name: j.name, pkgDir, version: j.version };
}

function internalPackageSet(): { name: string; version: string }[] {
  return PACKAGES
    .map((p) => readSpec(p.pkgDir))
    .map((s) => ({ name: s.name, version: s.version }));
}

describe('release-pack.mjs verifyTarball guard (TDD regression gate)', () => {
  let tarballDir: string;
  let doctorTarball: string;
  let finalReviewTarball: string;
  let rootTarball: string | null = null;

  beforeAll(() => {
    // Item (4): tmp dir under os.tmpdir() via mkdtemp; always clean
    // at afterAll. Items (3) and (5): the root peaks-loop tarball
    // is part of the green-path set (PACKAGES), so this test
    // exercises both subpackages and the main peaks-package pack.
    //
    // DO NOT re-run `pnpm run build` here — `clean-dist.mjs` would
    // race with parallel vitest workers (e.g.
    // tests/unit/hook-binary-build-regression.test.ts) that
    // read `dist/cli/commands/*.js`. The CI publish workflow
    // already runs `pnpm run build` upstream; the dist tree is
    // populated by the time this test file is loaded.
    //
    // We DO refresh the workspace symlinks (`pnpm install
    // --frozen-lockfile` does NOT run clean-dist; it just syncs
    // the `node_modules/.pnpm` link tree). On a stale local
    // install, the previous version of `peaks-loop-shared`
    // (e.g. 0.0.5) would be resolved by `pnpm pack` and the
    // verifyTarball pin-check would trip. Refreshing before pack
    // is hermetic and parallel-safe (no `dist/` writes).
    tarballDir = mkdtempSync(join(os.tmpdir(), 'peaks-guard-'));
    // We use `--frozen-lockfile` here so pnpm does NOT silently
    // re-resolve the entire dependency graph and purge the
    // content-addressable store. In CI, the lockfile pins
    // 0.0.4 for every workspace dep, so a frozen install yields
    // the correct symlinks. The local-development case
    // (lockfile lags behind the manifests) is rare — the
    // test will still fail loudly on version drift, which is
    // the desired regression signal.
    runPnpm(['install', '--frozen-lockfile', '--prefer-offline'], { cwd: projectRoot, stdio: 'pipe' });
    for (const { pkgDir } of PACKAGES) {
      runPnpm(['pack', '--pack-destination', tarballDir], { cwd: pkgDir, stdio: 'pipe' });
    }
    doctorTarball = join(tarballDir, `peaks-loop-doctor-${readSpec(PACKAGES[1].pkgDir).version}.tgz`);
    finalReviewTarball = join(tarballDir, `peaks-loop-final-review-${readSpec(PACKAGES[2].pkgDir).version}.tgz`);
    expect(existsSync(doctorTarball), `doctor tarball present at ${doctorTarball}`).toBe(true);
    expect(existsSync(finalReviewTarball), `final-review tarball present at ${finalReviewTarball}`).toBe(true);
  }, 600_000);

  afterAll(() => {
    if (tarballDir && existsSync(tarballDir)) {
      rmSync(tarballDir, { recursive: true, force: true });
    }
  });

  test('production verifyTarball accepts a clean pnpm pack output (green path)', () => {
    const internals = internalPackageSet();
    const allSpecs = PACKAGES.map((p) => readSpec(p.pkgDir));
    for (const target of [doctorTarball, finalReviewTarball]) {
      const spec = allSpecs.find((s) => target.endsWith(`${s.name.replace('@', '').replace(/\//g, '-')}-${s.version}.tgz`));
      expect(spec, `tarball name derivation for ${target}`).toBeDefined();
      const verdict = verifyTarball(target, spec!.name, spec!.version, internals);
      expect(verdict.ok, `errors: ${verdict.errors.join(', ')}`).toBe(true);
      expect(verdict.errors, 'green path must surface zero errors').toHaveLength(0);
    }
  }, 60_000);

  test('root peaks-loop tarball is green and matches version 4.0.0-beta.17', () => {
    // Item (5): exercise the root tarball explicitly. The root is
    // the main package whose install is the user-visible success
    // criterion; if it leaks workspace:*, every consumer install
    // breaks.
    const internals = internalPackageSet();
    const rootName = `peaks-loop-${readSpec(projectRoot).version}.tgz`;
    rootTarball = join(tarballDir, rootName);
    expect(existsSync(rootTarball!), `root tarball present at ${rootTarball}`).toBe(true);
    const verdict = verifyTarball(rootTarball!, 'peaks-loop', '4.0.0-beta.17', internals);
    expect(verdict.ok, `errors: ${verdict.errors.join(', ')}`).toBe(true);
  }, 60_000);

  test('production verifyTarball rejects a tampered tarball that restores workspace:*', () => {
    // Item (3): call the production verifier directly — no
    // mirror. The verdict must be { ok: false, errors: [...] }
    // with at least one error mentioning workspace:.
    const internals = internalPackageSet();
    const tamperedPath = tamperedSpec(doctorTarball);
    expect(existsSync(tamperedPath), `tampered tarball at ${tamperedPath}`).toBe(true);
    const verdict = verifyTarball(tamperedPath, 'peaks-loop-doctor', readSpec(PACKAGES[1].pkgDir).version, internals);
    expect(verdict.ok, 'tampered tarball MUST fail verification').toBe(false);
    expect(
      verdict.errors.join('\n'),
      'verdict.errors must mention workspace: protocol',
    ).toMatch(/workspace:/);
    // Cleanup the tampered tarball immediately to keep the
    // worktree tidy.
    rmSync(tamperedPath, { force: true });
  }, 60_000);

  test('production verifyTarball rejects a tarball with a version-mismatched internal dep', () => {
    // A tampered tarball where `peaks-loop-shared` is pinned to a
    // fictional version (e.g. `0.0.99`) MUST fail verification,
    // because the local internal-package set says
    // `peaks-loop-shared` is at `0.0.4`. This guards against a
    // future regression that would re-introduce the workspace-to-
    // registry drift.
    const internals = internalPackageSet();
    const tamperedPath = tamperedSpec(doctorTarball, '0.0.99');
    expect(existsSync(tamperedPath), `version-drift tarball at ${tamperedPath}`).toBe(true);
    const verdict = verifyTarball(tamperedPath, 'peaks-loop-doctor', readSpec(PACKAGES[1].pkgDir).version, internals);
    expect(verdict.ok, 'version-drift tarball MUST fail verification').toBe(false);
    expect(verdict.errors.join('\n'), 'verdict must mention 0.0.4 drift').toMatch(/0\.0\.4/);
    rmSync(tamperedPath, { force: true });
  }, 60_000);

  test('release-pack.mjs dry-run exits 0 against subpackages', () => {
    // Item (3) cross-check: the integration surface (the script
    // itself) still behaves correctly with the bumped versions.
    // The helper writes tarballs into os.tmpdir() and runs
    // verifyTarball from the same module the test just exercised,
    // so this is a smoke for the public entrypoint.
    const result = spawnSync(process.execPath, [helperPath], {
      env: {
        ...process.env,
        PEAKS_DRY_RUN: '1',
        PEAKS_SKIP: 'root',
      },
      stdio: 'pipe',
    });
    expect(result.status, `helper stderr: ${result.stderr?.toString('utf8') ?? ''}`).toBe(0);
  }, 300_000);
});

/**
 * Build a tampered copy of `sourceTarball` whose packaged
 * `package/package.json` has the literal regex
 * `"peaks-loop-shared": "<restore>"` injected. By default restore
 * = 'workspace:*' (the broken-state surface). Pass any other
 * semver-style string to test the version-drift predicate.
 */
function tamperedSpec(sourceTarball: string, restore: string = 'workspace:*'): string {
  const destDir = mkdtempSync(join(os.tmpdir(), 'peaks-tamper-'));
  const extracted = join(destDir, 'package-extracted');
  mkdirSync(extracted, { recursive: true });
  execFileSync('tar', ['-xzf', toPosixPath(sourceTarball), '-C', toPosixPath(extracted)]);
  const manifestPath = join(extracted, 'package', 'package.json');
  const original = readFileSync(manifestPath, 'utf8');
  const tampered = original.replace(/"peaks-loop-shared"\s*:\s*"[^"]*"/, `"peaks-loop-shared": "${restore}"`);
  if (tampered === original) {
    throw new Error(`failed to inject '${restore}' into ${manifestPath}`);
  }
  writeFileSync(manifestPath, tampered);
  const tamperedTarball = join(destDir, 'shared-tampered.tgz');
  execFileSync('tar', ['-czf', toPosixPath(tamperedTarball), '-C', toPosixPath(extracted), 'package']);
  return tamperedTarball;
}

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

import { runPnpm } from '../../../scripts/_release-shared.mjs';

const projectRoot = resolve(__dirname, '..', '..', '..');
const packagesRoot = resolve(projectRoot, 'packages');
const tmpRoot = resolve(projectRoot, '.pack-cache', 'release-tarball-test');

interface PackageSpec { name: string; dir: string; version: string; }

// Subpackage list mirrors scripts/release-pack.mjs. Kept here to
// avoid importing the helper directly (which would force the
// shared module re-export surface to leak into test types).
const SUBPACKAGE_DIRS = [
  'peaks-loop-shared',
  'peaks-loop-shared-channel',
  'peaks-loop-job-snapshot',
  'peaks-loop-mut',
  'peaks-loop-doctor',
  'peaks-loop-crystallization',
  'peaks-loop-final-review',
  'peaks-loop-audit-independent',
] as const;

function readPackageSpec(pkgDir: string): PackageSpec {
  const json = JSON.parse(readFileSync(resolve(packagesRoot, pkgDir, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
  };
  return { name: json.name, dir: pkgDir, version: json.version };
}

function listSpecs(): PackageSpec[] {
  return SUBPACKAGE_DIRS.map((d) => readPackageSpec(d));
}

function toPosix(p: string): string {
  return process.platform === 'win32'
    ? p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_full, drive: string) => `/${drive.toLowerCase()}`)
    : p;
}

function packPackage(spec: PackageSpec, dest: string): string {
  const pkgDir = resolve(packagesRoot, spec.dir);
  runPnpm(['pack', '--config.ignore-scripts=true', '--pack-destination', dest], {
    cwd: pkgDir,
    stdio: 'pipe',
  });
  const expected = `${spec.name.replace('@', '').replace(/\//g, '-')}-${spec.version}.tgz`;
  return join(dest, expected);
}

function npmPackPackage(spec: PackageSpec, dest: string): string {
  const pkgDir = resolve(packagesRoot, spec.dir);
  execFileSync('npm', ['pack', '--pack-destination', dest], {
    cwd: pkgDir,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
  const expected = `${spec.name.replace('@', '').replace(/\//g, '-')}-${spec.version}.tgz`;
  return join(dest, expected);
}

describe('workspace publish tarball integrity (TDD regression gate)', () => {
  beforeAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(tmpRoot, { recursive: true });
  });

  test('every workspace package tarball contains zero workspace: protocol strings', () => {
    const specs = listSpecs();
    expect(specs.length).toBeGreaterThan(0);

    for (const spec of specs) {
      const tarball = packPackage(spec, tmpRoot);
      expect(existsSync(tarball), `pnpm pack produced ${tarball}`).toBe(true);
      const raw = execFileSync('tar', ['-xOf', toPosix(tarball), 'package/package.json'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      }).toString('utf8');
      expect(
        raw,
        `${spec.name} tarball leaked workspace: protocol`,
      ).not.toMatch(/workspace:/);
    }
  }, 120_000);

  test('TDD regression: npm pack leaks workspace:* (proves the failing baseline)', () => {
    // npm pack on a workspace package directory preserves workspace:*
    // verbatim — this is the failure mode the un-patched
    // `.github/workflows/publish.yml` produced.
    const doctorSpec = readPackageSpec('peaks-loop-doctor');
    const brokenDir = resolve(tmpRoot, 'broken-npm-pack');
    mkdirSync(brokenDir, { recursive: true });
    const brokenTarball = npmPackPackage(doctorSpec, brokenDir);
    expect(existsSync(brokenTarball), `npm pack produced ${brokenTarball}`).toBe(true);
    const brokenRaw = execFileSync('tar', ['-xOf', toPosix(brokenTarball), 'package/package.json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8');
    expect(brokenRaw, 'npm pack on a workspace package directory MUST keep workspace:* literally').toMatch(/workspace:/);

    const greenDir = resolve(tmpRoot, 'green-pnpm-pack');
    mkdirSync(greenDir, { recursive: true });
    const greenTarball = packPackage(doctorSpec, greenDir);
    expect(existsSync(greenTarball), `pnpm pack produced ${greenTarball}`).toBe(true);
    const greenRaw = execFileSync('tar', ['-xOf', toPosix(greenTarball), 'package/package.json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8');
    expect(greenRaw, 'pnpm pack on the same workspace package MUST rewrite workspace:* to an exact semver pin').not.toMatch(/workspace:/);
  }, 120_000);

  test('each package tarball resolves internal workspace deps to exact registry-safe versions', () => {
    const specs = listSpecs();
    const versions = new Map<string, string>();
    for (const spec of specs) versions.set(spec.name, spec.version);
    const rootPkg = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as { version: string };
    versions.set('peaks-loop', rootPkg.version);

    for (const spec of specs) {
      const tarball = packPackage(spec, tmpRoot);
      const raw = execFileSync('tar', ['-xOf', toPosix(tarball), 'package/package.json'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      }).toString('utf8');
      const manifest = JSON.parse(raw) as {
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      const combined = { ...(manifest.dependencies ?? {}), ...(manifest.optionalDependencies ?? {}) };
      const internalNames = new Set(versions.keys());
      for (const [depName, depRange] of Object.entries(combined)) {
        if (!internalNames.has(depName)) continue;
        expect(
          depRange,
          `${spec.name} -> ${depName} non-semver: ${depRange}`,
        ).toMatch(/^[~^]?\d+\.\d+\.\d+([-+].+)?$/);
        const localVersion = versions.get(depName);
        expect(localVersion, `${spec.name} -> unknown ${depName}`).toBeDefined();
        if (depRange.startsWith('^') || depRange.startsWith('~')) {
          const localMajor = Number(localVersion!.split('.')[0]);
          const depMajor = Number(depRange.replace(/^[~^]/, '').split('.')[0]);
          expect(depMajor, `${spec.name} -> ${depName} ${depRange} excludes local ${localVersion}`).toBe(localMajor);
        } else {
          expect(depRange, `${spec.name} -> ${depName} must equal local ${localVersion}`).toBe(localVersion);
        }
      }
    }
  }, 120_000);

  test('every package version equals the published manifest on disk (version-agnostic regression)', () => {
    // Bug-03 follow-up (ice-cola surface check 2026-07-22): earlier
    // versions of this test hard-coded an `EXPECTED_SUB_VERSIONS`
    // table that drifted on every bump. Each release had to be
    // followed by a hand-edit to the table. Item (6) from the
    // 2026-07-21 review is preserved (we still tighten version
    // assertions, not use lenient accepts) by instead demanding
    // that every subpackage's `package.json` is a SemVer string
    // and that the version asserted in `verifyTarball` matches
    // the on-disk version, plus the subpackage's own CHANGELOG.md
    // references that exact version in its top entry.
    //
    // Why that combination: the registry-repair contract is "the
    // published tarball must equal the manifest". A future
    // regression that re-publishes a different version than the
    // committed manifest claims would diverge here.
    const specs = listSpecs();
    for (const spec of specs) {
      const pkg = readPackageSpec(spec.dir);
      // SemVer shape (with optional pre-release / build metadata).
      expect(pkg.version, `${spec.name} version "${pkg.version}" must be SemVer`).toMatch(/^\d+\.\d+\.\d+([-+].+)?$/);
      // The CHANGELOG top entry must include the same version string.
      const changelogPath = resolve(spec.dir, 'CHANGELOG.md');
      if (existsSync(changelogPath)) {
        const changelog = readFileSync(changelogPath, 'utf8');
        // Look for `## <version>` within the first 20 lines.
        const head = changelog.split('\n').slice(0, 30).join('\n');
        expect(
          head.includes(`## ${pkg.version}`),
          `${spec.name} CHANGELOG.md top must reference ## ${pkg.version} (current on-disk version)`,
        ).toBe(true);
      }
    }
    // Root peaks-loop: read its version from disk; previous regression
    // was the hard-coded '4.0.0-beta.17' literal that started failing
    // the moment root bumped to .20. The shape assertion still
    // guards against a future regression where root drifts away from
    // the project's monotonic SemVer shape (e.g., drops 4.x and goes
    // to 3.x accidentally).
    const rootPkg = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as { version: string };
    expect(rootPkg.version, 'root peaks-loop SemVer shape').toMatch(/^\d+\.\d+\.\d+([-+].+)?$/);
    // CHANGELOG-driven regression: the root CHANGELOG.md must include
    // a `## <root-version>` heading in its top entry.
    const rootChangelog = readFileSync(resolve(projectRoot, 'CHANGELOG.md'), 'utf8');
    const rootChangelogHead = rootChangelog.split('\n').slice(0, 30).join('\n');
    expect(
      rootChangelogHead.includes(`## ${rootPkg.version}`),
      `root CHANGELOG.md top must reference ## ${rootPkg.version}`,
    ).toBe(true);
  });
});

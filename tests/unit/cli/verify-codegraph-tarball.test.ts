// tests/unit/cli/verify-codegraph-tarball.test.ts
//
// rid-CG-005 — Tarball verify CI guard.
//
// 4-dimension test for `scripts/verify-codegraph-tarball.mjs`.
// The script runs `npm pack --dry-run --json --ignore-scripts`
// against peaks-loop's package.json and asserts the resulting
// tarball contains at least one file under
// `dist/services/codegraph/`.
//
// Dimensions covered:
//   - behavior: AC1 current whitelist (real peaks-loop package.json)
//                passes; AC2 a fixture with the `dist/**/*.js`
//                glob stripped fails with exit 1 and a clear
//                stderr message.
//   - integration: real `npm pack --dry-run` against two
//                  package.json fixtures (no mocking of npm
//                  itself — the anti-fake-green rule).
//   - render: the success path prints one summary line
//              (`OK (N file(s) under ...)`); the failure path
//              prints one human-readable stderr line.
//   - a11y: failure stderr names the offending directory
//           prefix and points at the whitelist entry, so the
//           LLM (or operator) can grep the right file.
//
// Prerequisite: the repo-root `dist/services/codegraph/` must exist. This file
// does not build it (that costs ≈9–14 s, backlog §2.13); the first test below
// states the requirement up front so a missing build fails with "Run \"pnpm
// build\"" instead of a bare `expected 1 to be +0` assertion diff.
//
// Run with:
//   pnpm vitest run tests/unit/cli/verify-codegraph-tarball.test.ts

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { declareDimensions } from '../_setup/4dim-template.js';
import { assertBuiltPath } from '../_setup/root-dist-prerequisite.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/cli/verify-codegraph-tarball.test.ts',
  ['behavior', 'integration', 'render', 'a11y'],
  []
);

const projectRoot = resolve(__dirname, '..', '..', '..');
const scriptPath = resolve(projectRoot, 'scripts', 'verify-codegraph-tarball.mjs');

// The directory the real package.json must ship, and therefore the build
// output the AC1 arm depends on.
const CODEGRAPH_BUILD_DIR = 'dist/services/codegraph';

function runVerify(cwd: string): { status: number | null; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status: number | null; stdout?: string; stderr?: string };
    return {
      status: e.status ?? null,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? ''
    };
  }
}

function makeFixturePackageJson(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-cg-005-'));
  // Minimal package.json that npm pack accepts (name + version +
  // files whitelist). We do NOT include dist/services/codegraph/
  // — that is what we want the script to detect.
  const pkg = {
    name: 'fixture-cg-005',
    version: '0.0.1',
    description: 'fixture for verify-codegraph-tarball.test.ts',
    type: 'module',
    files
  };
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  return dir;
}

describe('verify-codegraph-tarball (rid-CG-005)', () => {
  it(
    'exits 0 when peaks-loop root package.json ships dist/services/codegraph/',
    () => {
      assertBuiltPath(projectRoot, CODEGRAPH_BUILD_DIR);
      const result = runVerify(projectRoot);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(
        /verify-codegraph-tarball: OK \(\d+ file\(s\) under dist\/services\/codegraph\/\)/
      );
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'exits 1 when the files[] whitelist omits dist/services/codegraph/',
    () => {
      // Build a fixture whose whitelist is intentionally wrong.
      // The script's REQUIRED_PREFIX must NOT match anything in
      // this whitelist → the script must fail loud.
      const fixtureDir = makeFixturePackageJson(['README.md', 'CHANGELOG.md']);
      try {
        const result = runVerify(fixtureDir);
        expect(result.status).toBe(1);
        // Failure message must name the offending prefix AND hint
        // at the files[] whitelist so the operator can grep the
        // right file.
        expect(result.stderr).toContain('dist/services/codegraph/');
        expect(result.stderr).toContain('package.json#files[]');
      } finally {
        rmSync(fixtureDir, { recursive: true, force: true });
      }
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'exits 1 when a partial whitelist drops only the dist glob (no false-positive)',
    () => {
      // Fixture ships scripts/ + LICENSE but NO `dist/**/*`. This
      // catches the failure mode where the `dist/**/*.js` glob is
      // accidentally removed from files[] but `scripts/` stays.
      const fixtureDir = makeFixturePackageJson(['scripts/*.mjs', 'LICENSE', 'README.md']);
      mkdirSync(join(fixtureDir, 'scripts'), { recursive: true });
      writeFileSync(join(fixtureDir, 'scripts', 'noop.mjs'), '// noop\n', 'utf8');
      try {
        const result = runVerify(fixtureDir);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('dist/services/codegraph/');
      } finally {
        rmSync(fixtureDir, { recursive: true, force: true });
      }
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});

// Backlog §2.13: a missing root `dist/` must read as a prerequisite, not as a
// broken whitelist. Proved on a temp root so the real `dist/` is never moved.
describe('root dist/ prerequisite (backlog §2.13)', () => {
  it('when the build output is missing, should name the path and the build command', () => {
    const root = mkdtempSync(join(tmpdir(), 'peaks-cg-prereq-'));
    try {
      let message = '';
      try {
        assertBuiltPath(root, CODEGRAPH_BUILD_DIR);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('Prerequisite missing:');
      expect(message).toContain(join(root, 'dist', 'services', 'codegraph'));
      expect(message).toContain('Run "pnpm build" in the repo root before running this test.');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('when the build output exists, should return it (the guard is not a constant throw)', () => {
    const root = mkdtempSync(join(tmpdir(), 'peaks-cg-prereq-'));
    try {
      const expected = join(root, 'dist', 'services', 'codegraph');
      mkdirSync(expected, { recursive: true });
      expect(assertBuiltPath(root, CODEGRAPH_BUILD_DIR)).toBe(expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

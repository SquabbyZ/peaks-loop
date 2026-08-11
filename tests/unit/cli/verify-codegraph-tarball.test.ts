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
// Run with:
//   pnpm vitest run tests/unit/cli/verify-codegraph-tarball.test.ts

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/cli/verify-codegraph-tarball.test.ts',
  ['behavior', 'integration', 'render', 'a11y'],
  []
);

const projectRoot = resolve(__dirname, '..', '..', '..');
const scriptPath = resolve(projectRoot, 'scripts', 'verify-codegraph-tarball.mjs');

function runVerify(cwd: string): { status: number | null; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status: number | null; stdout?: string; stderr?: string };
    return {
      status: e.status ?? null,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
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
    files,
  };
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  return dir;
}

describe('verify-codegraph-tarball (rid-CG-005)', () => {
  it('exits 0 when peaks-loop root package.json ships dist/services/codegraph/', () => {
    const result = runVerify(projectRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/verify-codegraph-tarball: OK \(\d+ file\(s\) under dist\/services\/codegraph\/\)/);
  }, 120_000);

  it('exits 1 when the files[] whitelist omits dist/services/codegraph/', () => {
    // Build a fixture whose whitelist is intentionally wrong.
    // The script's REQUIRED_PREFIX must NOT match anything in
    // this whitelist → the script must fail loud.
    const fixtureDir = makeFixturePackageJson([
      'README.md',
      'CHANGELOG.md'
    ]);
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
  }, 120_000);

  it('exits 1 when a partial whitelist drops only the dist glob (no false-positive)', () => {
    // Fixture ships scripts/ + LICENSE but NO `dist/**/*`. This
    // catches the failure mode where the `dist/**/*.js` glob is
    // accidentally removed from files[] but `scripts/` stays.
    const fixtureDir = makeFixturePackageJson([
      'scripts/*.mjs',
      'LICENSE',
      'README.md'
    ]);
    mkdirSync(join(fixtureDir, 'scripts'), { recursive: true });
    writeFileSync(join(fixtureDir, 'scripts', 'noop.mjs'), '// noop\n', 'utf8');
    try {
      const result = runVerify(fixtureDir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('dist/services/codegraph/');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  }, 120_000);
});

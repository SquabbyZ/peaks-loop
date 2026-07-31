// tests/unit/release/bump-version-ac7.test.ts
//
// 4-dimension unit test for the AC7 idempotency guard in
// `scripts/bump-version.mjs`.
//
// Why this test file exists:
//   Pre-fix, the AC7 guard at scripts/bump-version.mjs:184 unconditionally
//   short-circuited when `latestOnRegistry === current`. The check ran AFTER
//   parseArgs() but BEFORE `next` was computed, so an explicit `--to <x.y.z>`
//   from the operator was silently swallowed in the (common) case where the
//   root version and the registry's latest tag had already converged (the
//   2026-07-31 Mac-auto-compact-B-route 4.0.4 cutover scenario: root=4.0.3
//   / registry=4.0.3 / operator needs to publish 4.0.4 to ship the fix).
//
// The fix (1-line surgical change to scripts/bump-version.mjs:184) adds
// `&& to === undefined` so the no-op path only fires when the operator did
// NOT pass an explicit target. AC7's original intent — stop publish.yml from
// re-running the auto-bump on a re-pushed tag — is preserved: publish.yml
// does not pass `--to` (it relies on default policy), so a redundant publish
// still no-ops.
//
// Dimensions covered:
//   - render:    child-process stdout / stderr shape (no-op log line vs.
//                bump log line)
//   - behavior:  exit code 0/1; on-disk package.json#version after run
//   - integration: subprocess spawn + fake-npm on PATH (the real
//                  `npm view peaks-loop dist-tags.latest` would hit the
//                  network and is environment-flaky in CI)
//   - a11y:      human-readable no-op / bump messages are surfaced on stdout

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, delimiter, isAbsolute } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/release/bump-version-ac7.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
);

// ---- harness ---------------------------------------------------------------

interface Harness {
  cwd: string;
  fakeBinDir: string;
}

let active: Harness | null = null;

function writeFakeNpm(binDir: string, fakeLatest: string): void {
  // The bump-version script runs `npm view peaks-loop dist-tags.latest --json`
  // via execFileSync with shell: true on win32. We write a tiny npm.cmd (and
  // a bash npm) that ALWAYS prints the configured `fakeLatest` as JSON, so
  // every test can pin the registry value without touching the network.
  const cmdBody =
    `@echo off\r\n` +
    `echo ${JSON.stringify(fakeLatest)}\r\n`;
  writeFileSync(join(binDir, 'npm.cmd'), cmdBody, 'utf8');
  const shBody = `#!/usr/bin/env bash\necho '${JSON.stringify(fakeLatest)}'\n`;
  const shPath = join(binDir, 'npm');
  writeFileSync(shPath, shBody, 'utf8');
  if (process.platform !== 'win32') {
    chmodSync(shPath, 0o755);
  }
}

function writeFakePackage(cwd: string, version: string): void {
  writeFileSync(
    join(cwd, 'package.json'),
    JSON.stringify(
      { name: 'peaks-loop', version, description: 'test fixture', author: 'SquabbyZ' },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}

function setupHarness(version: string, registryLatest: string): Harness {
  const cwd = mkdtempSync(join(tmpdir(), 'peaks-bump-ac7-'));
  const fakeBinDir = join(cwd, 'fake-bin');
  mkdirSync(fakeBinDir, { recursive: true });
  writeFakeNpm(fakeBinDir, registryLatest);
  writeFakePackage(cwd, version);
  active = { cwd, fakeBinDir };
  return active;
}

function runBumpVersion(args: string[]): { status: number | null; stdout: string; stderr: string } {
  if (!active) throw new Error('runBumpVersion called without active harness');
  const scriptPath = resolve(__dirname, '..', '..', '..', 'scripts', 'bump-version.mjs');
  if (!existsSync(scriptPath)) {
    throw new Error(`bump-version.mjs not found at ${scriptPath}`);
  }
  // Prepend the fake-npm bin dir to PATH so the script's `execFileSync('npm.cmd', …)`
  // resolves to our fake. Use delimiter constant rather than literal `;` /
  // `:` to stay cross-platform.
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Delete (not set-to-empty-string) PEAKS_NEXT_VERSION / PEAKS_NEXT_MAJOR
  // so the script's `to ?? process.env.PEAKS_NEXT_VERSION` evaluates to
  // undefined for the AC7 default-behavior tests. Setting them to ''
  // would still make `to` truthy (via `?? ''`) and break the no-op path.
  delete env.PEAKS_NEXT_VERSION;
  delete env.PEAKS_NEXT_MAJOR;
  env.PATH = `${active.fakeBinDir}${delimiter}${env.PATH ?? ''}`;
  const r = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: active.cwd,
    env,
    encoding: 'utf8',
    shell: false,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

afterEach(() => {
  active = null;
});

// ---- render dimension ------------------------------------------------------

describe('(render) — no-op vs bump stdout lines are distinguishable', () => {
  it('no-op path prints "no-op: <current> already on registry as latest"', () => {
    setupHarness('4.0.3', '4.0.3');
    const r = runBumpVersion([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[bump-version] no-op: 4.0.3 already on registry as latest');
    expect(r.stdout).toContain('skipping bump');
  });

  it('explicit --to prints the lockstep bump log line, not the no-op line', () => {
    setupHarness('4.0.3', '4.0.3');
    const r = runBumpVersion(['--to', '4.0.4']);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('no-op');
    expect(r.stdout).toContain('[bump-version] peaks-loop 4.0.3 -> 4.0.4');
  });
});

// ---- behavior dimension ----------------------------------------------------

describe('(behavior) — explicit --to is honored even when registry === current', () => {
  it('--to 4.0.4 + root=4.0.3 + registry=4.0.3 bumps root to 4.0.4 (was the regression)', () => {
    setupHarness('4.0.3', '4.0.3');
    const r = runBumpVersion(['--to', '4.0.4']);
    expect(r.status).toBe(0);
    const onDisk = JSON.parse(readFileSync(join(active!.cwd, 'package.json'), 'utf8'));
    expect(onDisk.version).toBe('4.0.4');
  });

  it('no --to + root=4.0.3 + registry=4.0.3 leaves root at 4.0.3 (AC7 default behavior preserved)', () => {
    setupHarness('4.0.3', '4.0.3');
    const r = runBumpVersion([]);
    expect(r.status).toBe(0);
    const onDisk = JSON.parse(readFileSync(join(active!.cwd, 'package.json'), 'utf8'));
    expect(onDisk.version).toBe('4.0.3');
  });

  it('--to 5.0.0 + root=4.0.3 + registry=4.0.3 bumps root to 5.0.0 (major escape hatch also honored)', () => {
    setupHarness('4.0.3', '4.0.3');
    const r = runBumpVersion(['--to', '5.0.0']);
    expect(r.status).toBe(0);
    const onDisk = JSON.parse(readFileSync(join(active!.cwd, 'package.json'), 'utf8'));
    expect(onDisk.version).toBe('5.0.0');
  });
});

// ---- integration dimension -------------------------------------------------

describe('(integration) — fake-npm on PATH replaces the real `npm view` call', () => {
  it('does not require network: harness returns deterministic JSON from a stub binary', () => {
    // Sanity check that the fake-npm setup actually replaces the real one.
    // If PATH ordering were wrong, spawnSync would hit registry.npmjs.org
    // and either time out or return a different version string.
    setupHarness('4.0.3', '9.9.9-unreachable-from-real-npm');
    const r = runBumpVersion([]);
    expect(r.status).toBe(0);
    // The stub says latest = 9.9.9 which != 4.0.3, so the script MUST NOT
    // short-circuit; it should fall through to default policy (4.0.3 -> 4.0.4).
    expect(r.stdout).not.toContain('no-op');
    const onDisk = JSON.parse(readFileSync(join(active!.cwd, 'package.json'), 'utf8'));
    expect(onDisk.version).toBe('4.0.4');
  });
});

// ---- a11y dimension --------------------------------------------------------

describe('(a11y) — human-visible messages name the version and the operator intent', () => {
  it('no-op log line names both the current version and the registry match', () => {
    setupHarness('4.0.3', '4.0.3');
    const r = runBumpVersion([]);
    expect(r.stdout).toMatch(/no-op:\s*4\.0\.3\s*already on registry/);
  });

  it('bump log line shows both source and target versions on a single line', () => {
    setupHarness('4.0.3', '4.0.3');
    const r = runBumpVersion(['--to', '4.0.4']);
    expect(r.stdout).toMatch(/peaks-loop\s+4\.0\.3\s+->\s+4\.0\.4/);
  });
});

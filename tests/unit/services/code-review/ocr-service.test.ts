/**
 * TDD coverage for the ocr (open-code-review) integration.
 *
 * Tests cover the 5 detect states + the run wrapper. Uses a
 * stub SubprocessRunner and stub HOME/cwd dirs — no real ocr
 * binary needed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  detectOcr,
  detectOcrConfig,
  resolveOcrLauncher,
  runOcrReview,
  type SubprocessRunner,
} from '../../../../src/services/code-review/ocr-service.js';

const IS_WINDOWS = process.platform === 'win32';
const BINARY_NAME = IS_WINDOWS ? 'opencodereview.exe' : 'opencodereview';

let tmpHome: string;
let tmpRoot: string;
let tmpCwd: string;

function makeOcrPackage(root: string, opts: { withBinary: boolean }): string {
  const binDir = join(root, 'node_modules', '@alibaba-group', 'open-code-review', 'bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, 'ocr.js'), '#!/usr/bin/env node\n// stub launcher\n', 'utf8');
  if (opts.withBinary) {
    writeFileSync(join(binDir, BINARY_NAME), 'stub binary', 'utf8');
  }
  return join(binDir, 'ocr.js');
}

function makeOcrConfig(home: string, opts: { valid: boolean; partial?: boolean; malformed?: boolean }): void {
  const ocrDir = join(home, '.opencodereview');
  mkdirSync(ocrDir, { recursive: true });
  const path = join(ocrDir, 'config.json');
  if (opts.malformed === true) {
    writeFileSync(path, '{not valid json', 'utf8');
    return;
  }
  if (opts.partial === true) {
    writeFileSync(path, JSON.stringify({ llm: { url: 'https://api.example.com' } }), 'utf8');
    return;
  }
  if (opts.valid) {
    writeFileSync(
      path,
      JSON.stringify({
        llm: {
          url: 'https://api.example.com',
          auth_token: 'stub-token',
          model: 'claude-stub',
        },
      }),
      'utf8'
    );
  }
}

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'peaks-ocr-home-'));
  tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-ocr-root-'));
  tmpCwd = mkdtempSync(join(tmpdir(), 'peaks-ocr-cwd-'));
});

afterEach(() => {
  try { rmSync(tmpHome, { recursive: true, force: true }); } catch {}
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  try { rmSync(tmpCwd, { recursive: true, force: true }); } catch {}
});

describe('resolveOcrLauncher', () => {
  test('returns the launcher path when package is present in the first root', () => {
    const expectedPath = makeOcrPackage(tmpRoot, { withBinary: true });
    const got = resolveOcrLauncher([tmpRoot, tmpCwd]);
    expect(got).toBe(expectedPath);
  });

  test('returns null when no root has the package', () => {
    expect(resolveOcrLauncher([tmpRoot, tmpCwd])).toBeNull();
  });

  test('falls through to second root when first is empty', () => {
    const expectedPath = makeOcrPackage(tmpCwd, { withBinary: true });
    const got = resolveOcrLauncher([tmpRoot, tmpCwd]);
    expect(got).toBe(expectedPath);
  });
});

describe('detectOcrConfig', () => {
  test('reports valid when config.json has all 3 required keys', () => {
    makeOcrConfig(tmpHome, { valid: true });
    const r = detectOcrConfig(tmpHome);
    expect(r.valid).toBe(true);
    expect(r.missingKeys).toEqual([]);
  });

  test('reports invalid when config.json is missing entirely', () => {
    const r = detectOcrConfig(tmpHome);
    expect(r.valid).toBe(false);
    expect(r.missingKeys[0]).toContain('does not exist');
  });

  test('reports invalid with the specific missing keys', () => {
    makeOcrConfig(tmpHome, { valid: false, partial: true });
    const r = detectOcrConfig(tmpHome);
    expect(r.valid).toBe(false);
    expect(r.missingKeys).toContain('llm.auth_token');
    expect(r.missingKeys).toContain('llm.model');
    expect(r.missingKeys).not.toContain('llm.url');
  });

  test('reports invalid on malformed JSON (does not throw)', () => {
    makeOcrConfig(tmpHome, { valid: false, malformed: true });
    expect(() => detectOcrConfig(tmpHome)).not.toThrow();
    const r = detectOcrConfig(tmpHome);
    expect(r.valid).toBe(false);
    expect(r.missingKeys[0]).toContain('not valid JSON');
  });
});

describe('detectOcr', () => {
  const stubRunner: SubprocessRunner = {
    run: () => ({ status: 0, stdout: 'opencodereview version 1.3.1\n', stderr: '' }),
  };

  test('state=package-missing when ocr npm package is absent', () => {
    const r = detectOcr({ cwd: tmpCwd, homeDir: tmpHome, searchRoots: [tmpRoot], runner: stubRunner });
    expect(r.state).toBe('package-missing');
    expect(r.packageInstalled).toBe(false);
    expect(r.binaryPath).toBeNull();
    expect(r.version).toBeNull();
    expect(r.nextActions[1]).toContain('npm i -g @alibaba-group/open-code-review');
  });

  test('state=binary-missing when launcher exists but platform binary did not download', () => {
    makeOcrPackage(tmpRoot, { withBinary: false });
    const r = detectOcr({ cwd: tmpCwd, homeDir: tmpHome, searchRoots: [tmpRoot], runner: stubRunner });
    expect(r.state).toBe('binary-missing');
    expect(r.packageInstalled).toBe(true);
    expect(r.binaryPath).toBeNull();
    expect(r.nextActions[0]).toContain('approve-builds');
    expect(r.nextActions[2]).toContain('Network-blocked');
  });

  test('state=config-missing when binary is present but ~/.opencodereview/config.json is incomplete', () => {
    makeOcrPackage(tmpRoot, { withBinary: true });
    // No config file
    const r = detectOcr({ cwd: tmpCwd, homeDir: tmpHome, searchRoots: [tmpRoot], runner: stubRunner });
    expect(r.state).toBe('config-missing');
    expect(r.packageInstalled).toBe(true);
    expect(r.binaryPath).not.toBeNull();
    expect(r.configValid).toBe(false);
    expect(r.nextActions[0]).toContain('ocr config set');
  });

  test('state=ready when package + binary + config are all healthy', () => {
    makeOcrPackage(tmpRoot, { withBinary: true });
    makeOcrConfig(tmpHome, { valid: true });
    const r = detectOcr({ cwd: tmpCwd, homeDir: tmpHome, searchRoots: [tmpRoot], runner: stubRunner });
    expect(r.state).toBe('ready');
    expect(r.packageInstalled).toBe(true);
    expect(r.binaryPath).not.toBeNull();
    expect(r.version).toBe('1.3.1');
    expect(r.configValid).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r.nextActions).toEqual([]);
  });

  test('records partial version when probe stdout is non-empty but does not match semver', () => {
    makeOcrPackage(tmpRoot, { withBinary: true });
    makeOcrConfig(tmpHome, { valid: true });
    const oddRunner: SubprocessRunner = {
      run: () => ({ status: 0, stdout: 'unexpected-build-string', stderr: '' }),
    };
    const r = detectOcr({ cwd: tmpCwd, homeDir: tmpHome, searchRoots: [tmpRoot], runner: oddRunner });
    expect(r.state).toBe('ready');
    expect(r.version).toBe('unexpected-build-string');
  });
});

describe('runOcrReview', () => {
  test('soft-fails (spawned=false) when ocr is in package-missing state', () => {
    const r = runOcrReview({
      cwd: tmpCwd,
      homeDir: tmpHome,
      searchRoots: [tmpRoot],
      input: { projectRoot: tmpCwd },
    });
    expect(r.spawned).toBe(false);
    expect(r.state).toBe('package-missing');
    expect(r.exitCode).toBeNull();
    expect(r.parsed).toBeNull();
    expect(r.nextActions.length).toBeGreaterThan(0);
  });

  test('soft-fails when binary is missing', () => {
    makeOcrPackage(tmpRoot, { withBinary: false });
    const r = runOcrReview({
      cwd: tmpCwd,
      homeDir: tmpHome,
      searchRoots: [tmpRoot],
      input: { projectRoot: tmpCwd },
    });
    expect(r.spawned).toBe(false);
    expect(r.state).toBe('binary-missing');
  });

  test('soft-fails when config is invalid', () => {
    makeOcrPackage(tmpRoot, { withBinary: true });
    const r = runOcrReview({
      cwd: tmpCwd,
      homeDir: tmpHome,
      searchRoots: [tmpRoot],
      input: { projectRoot: tmpCwd },
    });
    expect(r.spawned).toBe(false);
    expect(r.state).toBe('config-missing');
  });

  test('spawned=true + parsed JSON when ocr is ready and subprocess returns valid JSON', () => {
    makeOcrPackage(tmpRoot, { withBinary: true });
    makeOcrConfig(tmpHome, { valid: true });
    const reviewRunner: SubprocessRunner = {
      run: (_cmd, args) => {
        // detect-version probe vs the real review call
        if (args[1] === 'version') return { status: 0, stdout: '1.3.1\n', stderr: '' };
        return {
          status: 0,
          stdout: JSON.stringify({ findings: [{ file: 'a.ts', line: 10, severity: 'minor', message: 'stub' }] }),
          stderr: '',
        };
      },
    };
    const r = runOcrReview({
      cwd: tmpCwd,
      homeDir: tmpHome,
      searchRoots: [tmpRoot],
      runner: reviewRunner,
      input: { projectRoot: tmpCwd, from: 'main', to: 'HEAD' },
    });
    expect(r.spawned).toBe(true);
    expect(r.state).toBe('ready');
    expect(r.exitCode).toBe(0);
    expect(r.parsed).toEqual({ findings: [{ file: 'a.ts', line: 10, severity: 'minor', message: 'stub' }] });
    expect(r.warnings).toEqual([]);
  });

  test('reports warnings + nextActions when subprocess exits non-zero', () => {
    makeOcrPackage(tmpRoot, { withBinary: true });
    makeOcrConfig(tmpHome, { valid: true });
    const failingRunner: SubprocessRunner = {
      run: (_cmd, args) => {
        if (args[1] === 'version') return { status: 0, stdout: '1.3.1\n', stderr: '' };
        return { status: 1, stdout: '', stderr: 'auth failed' };
      },
    };
    const r = runOcrReview({
      cwd: tmpCwd,
      homeDir: tmpHome,
      searchRoots: [tmpRoot],
      runner: failingRunner,
      input: { projectRoot: tmpCwd },
    });
    expect(r.spawned).toBe(true);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toBe('auth failed');
    expect(r.warnings[0]).toContain('exited with status 1');
    expect(r.nextActions[0]).toContain('Inspect stderr');
  });

  test('passes --from / --to / --commit when provided', () => {
    makeOcrPackage(tmpRoot, { withBinary: true });
    makeOcrConfig(tmpHome, { valid: true });
    let capturedArgs: readonly string[] = [];
    const argCapturingRunner: SubprocessRunner = {
      run: (_cmd, args) => {
        if (args[1] === 'version') return { status: 0, stdout: '1.3.1\n', stderr: '' };
        capturedArgs = args;
        return { status: 0, stdout: '{}', stderr: '' };
      },
    };
    runOcrReview({
      cwd: tmpCwd,
      homeDir: tmpHome,
      searchRoots: [tmpRoot],
      runner: argCapturingRunner,
      input: { projectRoot: tmpCwd, from: 'main', to: 'feature', commit: 'abc123' },
    });
    expect(capturedArgs).toContain('--from');
    expect(capturedArgs).toContain('main');
    expect(capturedArgs).toContain('--to');
    expect(capturedArgs).toContain('feature');
    expect(capturedArgs).toContain('--commit');
    expect(capturedArgs).toContain('abc123');
    expect(capturedArgs).toContain('--format');
    expect(capturedArgs).toContain('json');
  });
});

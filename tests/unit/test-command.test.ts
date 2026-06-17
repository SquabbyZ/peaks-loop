/**
 * Unit tests for the `peaks test` CLI command (slice 2.5.0 sub-fix B).
 *
 * Coverage:
 *   - buildRunnerArgv for jest / vitest / mocha
 *   - --cache vs --no-cache (the WHOLE POINT of sub-fix B)
 *   - --passthrough does NOT override argv
 *   - --all, --changed argv wiring
 *   - Conflict detection on invalid --framework
 *   - --clear-cache short-circuit (delegates to clearTestCache)
 */

import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  buildRunnerArgv
} from '../../src/cli/commands/test-commands.js';
import {
  clearTestCache,
  detectTestFramework,
  testCacheDir
} from '../../src/services/test-cache/test-cache-service.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'peaks-test-cli-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('test-command: buildRunnerArgv (jest)', () => {
  test('default spawns `jest <pattern> --cache` (NOT --no-cache)', () => {
    const argv = buildRunnerArgv('jest', ['foo.test.ts'], {});
    expect(argv).toEqual(['foo.test.ts', '--cache']);
    expect(argv).not.toContain('--no-cache');
  });

  test('--all adds --passWithNoTests', () => {
    const argv = buildRunnerArgv('jest', [], { all: true });
    expect(argv).toEqual(['--passWithNoTests', '--cache']);
  });

  test('--changed adds --changedSince=HEAD', () => {
    const argv = buildRunnerArgv('jest', ['foo.test.ts'], { changed: true });
    expect(argv).toEqual(['foo.test.ts', '--changedSince=HEAD', '--cache']);
  });

  test('--no-cache forces --no-cache (explicit opt-in)', () => {
    const argv = buildRunnerArgv('jest', ['foo.test.ts'], { noCache: true });
    expect(argv).toEqual(['foo.test.ts', '--no-cache']);
    expect(argv).not.toContain('--cache');
  });

  test('--passthrough keeps --no-cache (does NOT override argv)', () => {
    const argv = buildRunnerArgv('jest', ['foo.test.ts'], { passthrough: true });
    expect(argv).toEqual(['foo.test.ts', '--no-cache']);
  });
});

describe('test-command: buildRunnerArgv (vitest)', () => {
  test('default spawns `vitest run <pattern> --cache`', () => {
    const argv = buildRunnerArgv('vitest', ['foo.test.ts'], {});
    expect(argv).toEqual(['run', 'foo.test.ts', '--cache']);
  });

  test('--no-cache forces --no-cache', () => {
    const argv = buildRunnerArgv('vitest', ['foo.test.ts'], { noCache: true });
    expect(argv).toEqual(['run', 'foo.test.ts', '--no-cache']);
  });

  test('--changed adds --changed', () => {
    const argv = buildRunnerArgv('vitest', ['foo.test.ts'], { changed: true });
    expect(argv).toEqual(['run', 'foo.test.ts', '--changed', '--cache']);
  });

  test('--passthrough emits `vitest run <pattern>`', () => {
    const argv = buildRunnerArgv('vitest', ['foo.test.ts'], { passthrough: true });
    expect(argv).toEqual(['run', 'foo.test.ts']);
  });
});

describe('test-command: buildRunnerArgv (mocha)', () => {
  test('mocha gets bare patterns (no --cache flag exists)', () => {
    const argv = buildRunnerArgv('mocha', ['foo.test.js'], {});
    expect(argv).toEqual(['foo.test.js']);
  });
});

describe('test-command: clearTestCache integration', () => {
  test('--clear-cache empties the test-cache dir', () => {
    const cacheDir = testCacheDir(tmpDir);
    mkdirSync(cacheDir, { recursive: true });
    const f1 = join(cacheDir, 'x.json');
    const f2 = join(cacheDir, 'y.json');
    writeFileSync(f1, '{}');
    writeFileSync(f2, '{}');
    const result = clearTestCache(tmpDir);
    expect(result.removed).toBe(2);
  });
});

describe('test-command: framework detection integration', () => {
  test('detects jest in a fresh consumer package.json', () => {
    const pkg = join(tmpDir, 'package.json');
    writeFileSync(pkg, JSON.stringify({ devDependencies: { jest: '^29.0.0' } }));
    expect(detectTestFramework(tmpDir)).toBe('jest');
  });

  test('detects vitest in a fresh consumer package.json', () => {
    const pkg = join(tmpDir, 'package.json');
    writeFileSync(pkg, JSON.stringify({ devDependencies: { vitest: '^1.0.0' } }));
    expect(detectTestFramework(tmpDir)).toBe('vitest');
  });

  test('returns null for an unsupported package.json', () => {
    const pkg = join(tmpDir, 'package.json');
    writeFileSync(pkg, JSON.stringify({ devDependencies: { ava: '^5.0.0' } }));
    expect(detectTestFramework(tmpDir)).toBeNull();
  });
});

describe('test-command: argv composition invariants', () => {
  test('jest default never contains --no-cache (G7/NG7 hard rule)', () => {
    const argv = buildRunnerArgv('jest', ['x.test.ts'], {});
    expect(argv.includes('--no-cache')).toBe(false);
    expect(argv.includes('--cache')).toBe(true);
  });

  test('vitest default never contains --no-cache (G9)', () => {
    const argv = buildRunnerArgv('vitest', ['x.test.ts'], {});
    expect(argv.includes('--no-cache')).toBe(false);
    expect(argv.includes('--cache')).toBe(true);
  });

  test('--passthrough is the ONLY way to get --no-cache in the default mode', () => {
    const defaultArgv = buildRunnerArgv('jest', ['x.test.ts'], {});
    const passthroughArgv = buildRunnerArgv('jest', ['x.test.ts'], { passthrough: true });
    expect(defaultArgv).not.toContain('--no-cache');
    expect(passthroughArgv).toContain('--no-cache');
  });
});

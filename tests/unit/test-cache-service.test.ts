/**
 * Unit tests for the per-test fingerprint cache (slice 2.5.0 sub-fix B).
 *
 * Coverage targets (>=80%):
 *   - read / write round-trip
 *   - sha256 stability (re-read same file → same hash)
 *   - mtime + sha256 mismatch → cache miss
 *   - clearTestCache
 *   - detectTestFramework for jest / vitest / mocha / none
 */

import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  clearTestCache,
  detectTestFramework,
  isCacheable,
  mtimeOfFile,
  readTestCache,
  recordTestResult,
  sha256OfFile,
  testCacheDir,
  testCachePath,
  writeTestCache,
  type TestCacheFile
} from '../../src/services/test-cache/test-cache-service.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'peaks-test-cache-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('test-cache-service: sha256 + mtime', () => {
  test('sha256OfFile returns stable hex digest', () => {
    const file = join(tmpDir, 'a.txt');
    writeFileSync(file, 'hello world');
    const h1 = sha256OfFile(file);
    const h2 = sha256OfFile(file);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  test('sha256OfFile differs for different content', () => {
    const f1 = join(tmpDir, 'a.txt');
    const f2 = join(tmpDir, 'b.txt');
    writeFileSync(f1, 'aaa');
    writeFileSync(f2, 'bbb');
    expect(sha256OfFile(f1)).not.toBe(sha256OfFile(f2));
  });

  test('mtimeOfFile returns numeric mtime', () => {
    const file = join(tmpDir, 'a.txt');
    writeFileSync(file, 'x');
    const m = mtimeOfFile(file);
    expect(typeof m).toBe('number');
    expect(m).toBeGreaterThan(0);
  });
});

describe('test-cache-service: read/write round-trip', () => {
  test('writeTestCache + readTestCache round-trips data', () => {
    const file = join(tmpDir, 'test.test.ts');
    writeFileSync(file, 'test("x", () => {});');
    const cache: TestCacheFile = {
      filePath: file,
      fileMtime: mtimeOfFile(file),
      fileSha256: sha256OfFile(file),
      framework: 'jest',
      tests: [
        { testName: 'x', status: 'passed', durationMs: 12, lastRun: '2026-06-17T00:00:00.000Z' }
      ],
      lastRunAt: '2026-06-17T00:00:00.000Z'
    };
    writeTestCache(tmpDir, cache);
    const back = readTestCache(tmpDir, file);
    expect(back).not.toBeNull();
    expect(back?.filePath).toBe(file);
    expect(back?.framework).toBe('jest');
    expect(back?.tests).toHaveLength(1);
    expect(back?.tests[0]?.testName).toBe('x');
    expect(back?.tests[0]?.status).toBe('passed');
  });

  test('readTestCache returns null when no cache file', () => {
    const file = join(tmpDir, 'nope.test.ts');
    expect(readTestCache(tmpDir, file)).toBeNull();
  });

  test('testCachePath is stable per file path', () => {
    const file = join(tmpDir, 'same.test.ts');
    const p1 = testCachePath(tmpDir, file);
    const p2 = testCachePath(tmpDir, file);
    expect(p1).toBe(p2);
    expect(p1.startsWith(testCacheDir(tmpDir))).toBe(true);
  });
});

describe('test-cache-service: isCacheable (skip logic)', () => {
  test('returns hit=true when (mtime, sha) unchanged AND status was passed', () => {
    const file = join(tmpDir, 'pass.test.ts');
    writeFileSync(file, 'test("a", () => expect(1).toBe(1));');
    const mtime = mtimeOfFile(file);
    const sha = sha256OfFile(file);
    recordTestResult(tmpDir, file, 'jest', {
      testName: 'a',
      status: 'passed',
      durationMs: 5,
      lastRun: '2026-06-17T00:00:00.000Z'
    });
    // Round-trip preserves the mtime/sha we captured.
    const cache = readTestCache(tmpDir, file);
    expect(cache?.fileMtime).toBe(mtime);
    expect(cache?.fileSha256).toBe(sha);
    const lookup = isCacheable(tmpDir, file, 'a');
    expect(lookup.hit).toBe(true);
    expect(lookup.cached?.status).toBe('passed');
  });

  test('returns hit=false when file content changes (sha mismatch)', () => {
    const file = join(tmpDir, 'changed.test.ts');
    writeFileSync(file, 'v1');
    recordTestResult(tmpDir, file, 'jest', {
      testName: 'a',
      status: 'passed',
      durationMs: 1,
      lastRun: '2026-06-17T00:00:00.000Z'
    });
    // Mutate the file (new sha; mtime also advances because writeFile
    // bumps it).
    writeFileSync(file, 'v2');
    const lookup = isCacheable(tmpDir, file, 'a');
    expect(lookup.hit).toBe(false);
    expect(lookup.reason === 'sha-changed' || lookup.reason === 'mtime-changed').toBe(true);
  });

  test('returns hit=false when previous status was failed', () => {
    const file = join(tmpDir, 'failed.test.ts');
    writeFileSync(file, 'x');
    recordTestResult(tmpDir, file, 'vitest', {
      testName: 'a',
      status: 'failed',
      durationMs: 1,
      lastRun: '2026-06-17T00:00:00.000Z'
    });
    const lookup = isCacheable(tmpDir, file, 'a');
    expect(lookup.hit).toBe(false);
    expect(lookup.reason).toBe('previous-failed');
  });

  test('returns hit=false when no cache file exists', () => {
    const file = join(tmpDir, 'never.test.ts');
    writeFileSync(file, 'x');
    const lookup = isCacheable(tmpDir, file, 'a');
    expect(lookup.hit).toBe(false);
    expect(lookup.reason).toBe('no-cache');
  });
});

describe('test-cache-service: clearTestCache', () => {
  test('removes all .json files from the cache dir', () => {
    mkdirSync(testCacheDir(tmpDir), { recursive: true });
    const f1 = join(testCacheDir(tmpDir), 'aaa.json');
    const f2 = join(testCacheDir(tmpDir), 'bbb.json');
    writeFileSync(f1, '{}');
    writeFileSync(f2, '{}');
    const result = clearTestCache(tmpDir);
    expect(result.removed).toBe(2);
  });

  test('returns 0 when no cache dir exists', () => {
    const result = clearTestCache(tmpDir);
    expect(result.removed).toBe(0);
  });
});

describe('test-cache-service: detectTestFramework', () => {
  test('detects jest in devDependencies', () => {
    const pkg = join(tmpDir, 'package.json');
    writeFileSync(pkg, JSON.stringify({ devDependencies: { jest: '^29.0.0' } }));
    expect(detectTestFramework(tmpDir)).toBe('jest');
  });

  test('detects vitest in dependencies', () => {
    const pkg = join(tmpDir, 'package.json');
    writeFileSync(pkg, JSON.stringify({ dependencies: { vitest: '^1.0.0' } }));
    expect(detectTestFramework(tmpDir)).toBe('vitest');
  });

  test('detects mocha in devDependencies', () => {
    const pkg = join(tmpDir, 'package.json');
    writeFileSync(pkg, JSON.stringify({ devDependencies: { mocha: '^10.0.0' } }));
    expect(detectTestFramework(tmpDir)).toBe('mocha');
  });

  test('returns null when no supported framework is present', () => {
    const pkg = join(tmpDir, 'package.json');
    writeFileSync(pkg, JSON.stringify({ devDependencies: { tape: '^5.0.0' } }));
    expect(detectTestFramework(tmpDir)).toBeNull();
  });

  test('returns null when package.json does not exist', () => {
    expect(detectTestFramework(tmpDir)).toBeNull();
  });

  test('picks jest when multiple are present (priority order)', () => {
    const pkg = join(tmpDir, 'package.json');
    writeFileSync(pkg, JSON.stringify({ devDependencies: { mocha: '^10.0.0', vitest: '^1.0.0', jest: '^29.0.0' } }));
    expect(detectTestFramework(tmpDir)).toBe('jest');
  });

  test('handles malformed package.json gracefully', () => {
    const pkg = join(tmpDir, 'package.json');
    writeFileSync(pkg, '{ not valid json');
    expect(detectTestFramework(tmpDir)).toBeNull();
  });
});

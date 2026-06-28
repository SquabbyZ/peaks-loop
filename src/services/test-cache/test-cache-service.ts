/**
 * `peaks test` per-test fingerprint cache (slice 2.5.0 sub-fix B).
 *
 * Persists per-test results keyed by (file, testName) so a re-run can
 * skip tests where the file's mtime + sha256 are unchanged AND the
 * previous run status was "passed". The cache lives at
 * `<projectRoot>/.peaks/_runtime/test-cache/<hash>.json` and is
 * session-bound runtime state (gitignored via the existing
 * `.peaks/_runtime/` rule).
 *
 * Schema (per file):
 *   {
 *     filePath: string;            // absolute path to the test file
 *     fileMtime: number;           // mtime in ms
 *     fileSha256: string;          // hex sha256
 *     framework: 'jest' | 'vitest' | 'mocha';
 *     tests: Array<{
 *       testName: string;
 *       status: 'passed' | 'failed' | 'skipped';
 *       durationMs: number;
 *       lastRun: string;           // ISO timestamp
 *     }>;
 *     lastRunAt: string;
 *   }
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

export type TestFramework = 'jest' | 'vitest' | 'mocha';

export type TestStatus = 'passed' | 'failed' | 'skipped';

export interface TestRecord {
  testName: string;
  status: TestStatus;
  durationMs: number;
  lastRun: string;
}

export interface TestCacheFile {
  filePath: string;
  fileMtime: number;
  fileSha256: string;
  framework: TestFramework;
  tests: TestRecord[];
  lastRunAt: string;
}

export const TEST_CACHE_DIR = 'test-cache';

export function testCacheDir(projectRoot: string): string {
  return join(projectRoot, '.peaks', '_runtime', TEST_CACHE_DIR);
}

export function testCachePath(projectRoot: string, filePath: string): string {
  const abs = resolve(filePath);
  const hash = createHash('sha256').update(abs).digest('hex').slice(0, 16);
  return join(testCacheDir(projectRoot), `${hash}.json`);
}

export function sha256OfFile(filePath: string): string {
  const buf = readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

export function mtimeOfFile(filePath: string): number {
  return statSync(filePath).mtimeMs;
}

export function readTestCache(projectRoot: string, filePath: string): TestCacheFile | null {
  const path = testCachePath(projectRoot, filePath);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as TestCacheFile;
    return parsed;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

export function writeTestCache(projectRoot: string, cache: TestCacheFile): void {
  const path = testCachePath(projectRoot, cache.filePath);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(cache, null, 2) + '\n', 'utf8');
}

export function clearTestCache(projectRoot: string): { removed: number } {
  const dir = testCacheDir(projectRoot);
  if (!existsSync(dir)) return { removed: 0 };
  let removed = 0;
  for (const entry of readdirSync(dir)) {
    if (entry.endsWith('.json')) {
      unlinkSync(join(dir, entry));
      removed += 1;
    }
  }
  return { removed };
}

export interface CacheLookup {
  hit: boolean;
  reason?: 'no-cache' | 'mtime-changed' | 'sha-changed' | 'previous-failed' | 'previous-skipped';
  cached?: TestRecord;
}

/**
 * Decide whether a test is cacheable (i.e. can be skipped on a re-run).
 * Returns hit=true if the cache record shows passed AND both
 * (fileMtime, fileSha256) match the current file state.
 */
export function isCacheable(
  projectRoot: string,
  filePath: string,
  testName: string
): CacheLookup {
  const cache = readTestCache(projectRoot, filePath);
  if (!cache) return { hit: false, reason: 'no-cache' };
  if (!existsSync(filePath)) {
    return { hit: false, reason: 'mtime-changed' };
  }
  const currentMtime = mtimeOfFile(filePath);
  const currentSha = sha256OfFile(filePath);
  if (cache.fileMtime !== currentMtime) {
    return { hit: false, reason: 'mtime-changed' };
  }
  if (cache.fileSha256 !== currentSha) {
    return { hit: false, reason: 'sha-changed' };
  }
  const record = cache.tests.find((t) => t.testName === testName);
  if (!record) return { hit: false, reason: 'no-cache' };
  if (record.status !== 'passed') {
    return { hit: false, reason: record.status === 'failed' ? 'previous-failed' : 'previous-skipped' };
  }
  return { hit: true, cached: record };
}

export function recordTestResult(
  projectRoot: string,
  filePath: string,
  framework: TestFramework,
  record: TestRecord
): void {
  const abs = resolve(filePath);
  let cache = readTestCache(projectRoot, abs);
  const mtime = existsSync(abs) ? mtimeOfFile(abs) : Date.now();
  const sha = existsSync(abs) ? sha256OfFile(abs) : '';
  if (!cache) {
    cache = {
      filePath: abs,
      fileMtime: mtime,
      fileSha256: sha,
      framework,
      tests: [],
      lastRunAt: new Date().toISOString()
    };
  } else {
    cache.fileMtime = mtime;
    cache.fileSha256 = sha;
    cache.framework = framework;
    cache.lastRunAt = new Date().toISOString();
  }
  const idx = cache.tests.findIndex((t) => t.testName === record.testName);
  if (idx >= 0) {
    cache.tests[idx] = record;
  } else {
    cache.tests.push(record);
  }
  writeTestCache(projectRoot, cache);
}

/**
 * Detect the consumer project's test framework by reading
 * package.json devDependencies / dependencies. Picks the dominant
 * one (most-installed). Returns null if no supported framework
 * is found.
 */
export function detectTestFramework(projectRoot: string): TestFramework | null {
  const pkgPath = join(projectRoot, 'package.json');
  if (!existsSync(pkgPath)) return null;
  let pkg: { devDependencies?: Record<string, string>; dependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as typeof pkg;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
  const all: Record<string, string> = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {})
  };
  const present: TestFramework[] = [];
  if (all['jest'] || all['@jest/core']) present.push('jest');
  if (all['vitest']) present.push('vitest');
  if (all['mocha']) present.push('mocha');
  if (present.length === 0) return null;
  // Deterministic order: jest > vitest > mocha (no "dominant" metric
  // in package.json; we use the most-common-2.x convention).
  const order: TestFramework[] = ['jest', 'vitest', 'mocha'];
  for (const fw of order) {
    if (present.includes(fw)) return fw;
  }
  return present[0] ?? null;
}

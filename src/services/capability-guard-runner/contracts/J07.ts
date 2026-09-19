import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TEST_CACHE_DIR,
  isCacheable,
  mtimeOfFile,
  readTestCache,
  recordTestResult,
  sha256OfFile,
  testCacheDir,
  writeTestCache
} from '../../test-cache/test-cache-service.js';
import type { GuardContext, GuardRunResult } from '../types.js';
import {
  combineProbes,
  fail,
  missingSourceFiles,
  pass,
  probe,
  requireBaselineRow
} from './_shared.js';

const TEST_NAME = 'fingerprint probe';

/** Highest vitest major the frozen baseline allows ("MUST NOT be locked at 5.x"). */
const MAX_VITEST_MAJOR = 4;

function vitestMajor(projectRoot: string): number | null {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const raw = pkg.devDependencies?.['vitest'] ?? pkg.dependencies?.['vitest'];
    if (typeof raw !== 'string') return null;
    const major = /(\d+)/.exec(raw);
    return major === null ? null : Number(major[1]);
  } catch {
    return null;
  }
}

/**
 * Behavioural probe of the (mtime, sha256) gate.
 *
 * A cache entry is written for a passing test, then the file's CONTENT is
 * changed while its mtime is restored to the original value. If the gate ever
 * degraded to an mtime-only (or filename-only) check, the cache would report a
 * hit for a file whose bytes changed — exactly the fake-green the invariant
 * forbids. The mtime-only and status gates are probed the same way.
 */
export async function runJ07Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const row = requireBaselineRow(ctx);
  const missing = missingSourceFiles(ctx, row);

  const root = mkdtempSync(join(tmpdir(), 'cbl-J07-'));
  const file = join(root, 'probe.test.ts');
  try {
    writeFileSync(file, 'export const a = 1;\n');
    recordTestResult(root, file, 'vitest', {
      testName: TEST_NAME,
      status: 'passed',
      durationMs: 1,
      lastRun: new Date().toISOString()
    });
    const baseline = isCacheable(root, file, TEST_NAME);
    const cached = readTestCache(root, file);

    // Gate 1, isolated: the file's bytes change but the recorded mtime is
    // up-to-date, so ONLY the sha check can catch it. If the gate degraded to
    // an mtime-only check this reports a hit for a file nobody verified.
    writeFileSync(file, 'export const a = 2;\n');
    writeTestCache(root, { ...cached!, fileMtime: mtimeOfFile(file) });
    const afterSilentEdit = isCacheable(root, file, TEST_NAME);

    // Gate 2, isolated: the sha is up-to-date but the recorded mtime is stale.
    writeTestCache(root, {
      ...cached!,
      fileSha256: sha256OfFile(file),
      fileMtime: cached!.fileMtime - 5_000
    });
    const afterTouch = isCacheable(root, file, TEST_NAME);

    // A non-passing status must never be served as a hit.
    recordTestResult(root, file, 'vitest', {
      testName: 'skipped probe',
      status: 'skipped',
      durationMs: 0,
      lastRun: new Date().toISOString()
    });
    const skipped = isCacheable(root, file, 'skipped probe');
    const unknown = isCacheable(root, file, 'never recorded');

    const major = vitestMajor(ctx.projectRoot);

    const result = combineProbes([
      probe(missing.length === 0, `baseline sourceFiles present (${row.sourceFiles.length})`),
      probe(
        baseline.hit,
        `an unchanged passing test is a cache hit (reason=${String(baseline.reason)})`
      ),
      probe(
        !afterSilentEdit.hit && afterSilentEdit.reason === 'sha-changed',
        `a same-mtime content edit is NOT a hit (hit=${String(afterSilentEdit.hit)} reason=${String(afterSilentEdit.reason)})`
      ),
      probe(
        !afterTouch.hit && afterTouch.reason === 'mtime-changed',
        `a touched file is NOT a hit (hit=${String(afterTouch.hit)} reason=${String(afterTouch.reason)})`
      ),
      probe(
        !skipped.hit && skipped.reason === 'previous-skipped',
        `a previously skipped test is NOT a hit (hit=${String(skipped.hit)} reason=${String(skipped.reason)})`
      ),
      probe(
        !unknown.hit && unknown.reason === 'no-cache',
        `an unrecorded test is NOT a hit (reason=${String(unknown.reason)})`
      ),
      probe(
        testCacheDir(ctx.projectRoot)
          .replace(/\\/g, '/')
          .endsWith(`.peaks/_runtime/${TEST_CACHE_DIR}`),
        `the cache writes under .peaks/_runtime/${TEST_CACHE_DIR} (got ${testCacheDir(ctx.projectRoot)})`
      ),
      probe(
        major !== null && major <= MAX_VITEST_MAJOR,
        `vitest major is <= ${String(MAX_VITEST_MAJOR)} (saw ${String(major)})`
      )
    ]);

    const artifact = row.sourceFiles[1] ?? 'src/services/test-cache/test-cache-service.ts';
    if (result.ok) return pass(ctx, artifact);
    return fail(
      ctx,
      artifact,
      'the per-test fingerprint cache only serves a hit for a file whose mtime AND sha256 are unchanged and whose last status passed',
      result.detail,
      'J07 invariant broken: the fingerprint cache can return passed for an unverified file'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

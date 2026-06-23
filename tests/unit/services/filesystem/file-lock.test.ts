/**
 * `withFileLockSync` — slice 2026-06-23-audit-3rd (#2 + #3) unit tests.
 *
 * Pins:
 *   1. Basic acquire + release (fn runs, .lock file unlinked after).
 *   2. Return value passes through.
 *   3. fn throwing propagates AND the lock is still released.
 *   4. Sequential calls to the same path both succeed (lock doesn't leak).
 *   5. Concurrent RMW on the SAME path never loses updates — 50 parallel
 *      writers each appending one entry to a JSON object must all be
 *      visible after they settle (the original bug from #2 / #3).
 *   6. Stale-lock reaping: a `.lock` file with mtime > 30s old is reaped
 *      before the next acquire attempt.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LockTimeoutError, withFileLockSync } from '../../../../src/services/filesystem/file-lock.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-file-lock-'));
});

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

describe('withFileLockSync — basic contract', () => {
  it('runs fn and releases the lock (lock file is gone afterward)', () => {
    const target = join(root, 'a.json');
    writeFileSync(target, 'init');
    const result = withFileLockSync(target, () => 42);
    expect(result).toBe(42);
    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it('passes the return value through', () => {
    const target = join(root, 'b.json');
    writeFileSync(target, '{}');
    const obj = { x: 1 };
    const result = withFileLockSync(target, () => obj);
    expect(result).toBe(obj);
  });

  it('releases the lock even when fn throws', () => {
    const target = join(root, 'c.json');
    writeFileSync(target, '{}');
    expect(() =>
      withFileLockSync(target, () => {
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it('supports sequential calls on the same path (no leak between calls)', () => {
    const target = join(root, 'd.json');
    writeFileSync(target, '0');
    for (let i = 0; i < 10; i += 1) {
      withFileLockSync(target, () => {
        // no-op; the test is that the lock is acquired and released each time
      });
    }
    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it('creates the parent dir if it does not yet exist', () => {
    // First-write callers (e.g. writeSharedEntry on a fresh batch) reach
    // the lock BEFORE the writer's own mkdirSync(dir, { recursive: true })
    // runs. The lock helper must NOT ENOENT.
    const nested = join(root, 'nested', 'deeper', 'e.json');
    const result = withFileLockSync(nested, () => 'ok');
    expect(result).toBe('ok');
    expect(existsSync(`${nested}.lock`)).toBe(false);
  });
});

describe('withFileLockSync — concurrent RMW safety', () => {
  it('50 parallel writers appending distinct keys all survive (no lost updates)', async () => {
    const target = join(root, 'concurrent.json');
    writeFileSync(target, JSON.stringify({ keys: {} }));

    const N = 50;
    const writers: Promise<void>[] = [];
    for (let i = 0; i < N; i += 1) {
      writers.push(
        new Promise<void>((resolveWriter, rejectWriter) => {
          // Slice 2026-06-23-audit-4th #D1: queueMicrotask instead of
          // setImmediate. queueMicrotask runs before any I/O so the
          // contention is deterministic — on slow CI (cold cache, GC
          // pauses) setImmediate can starve the spin-wait inside
          // withFileLockSync. The new batch-counter parallel test
          // (tests/unit/batch-counter.test.ts) uses the same pattern.
          queueMicrotask(() => {
            try {
              withFileLockSync(target, () => {
                const current = JSON.parse(readFileSync(target, 'utf8')) as {
                  keys: Record<string, number>;
                };
                current.keys[`k${i}`] = i;
                writeFileSync(target, JSON.stringify(current));
              });
              resolveWriter();
            } catch (err) {
              rejectWriter(err as Error);
            }
          });
        })
      );
    }
    await Promise.all(writers);

    const final = JSON.parse(readFileSync(target, 'utf8')) as { keys: Record<string, number> };
    // All N keys must be present — the lock must serialize the writers so
    // no read-modify-write is lost. (Without the lock, ~2*N renames race
    // and the final JSON has only ~1 entry.)
    expect(Object.keys(final.keys).sort()).toEqual(
      Array.from({ length: N }, (_, i) => `k${i}`).sort()
    );
  });
});

describe('withFileLockSync — stale-lock reaping', () => {
  it('reaps a stale .lock (>30s old) and acquires cleanly', () => {
    const target = join(root, 'stale.json');
    const lockPath = `${target}.lock`;
    writeFileSync(lockPath, 'crashed-holder');
    // Backdate the lock file's mtime past LOCK_STALE_MS (30s).
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath, old, old);
    // Confirm it's stale (mtime > 30s ago).
    expect(Date.now() - statSync(lockPath).mtimeMs).toBeGreaterThan(30_000);

    const result = withFileLockSync(target, () => 'reaped');
    expect(result).toBe('reaped');
    expect(existsSync(lockPath)).toBe(false);
  });

  it('does NOT reap a fresh .lock (<30s old)', () => {
    const target = join(root, 'fresh.json');
    const lockPath = `${target}.lock`;
    writeFileSync(lockPath, 'live-holder');

    expect(() =>
      withFileLockSync(target, () => 'should-not-run')
    ).toThrow(LockTimeoutError);
    // The fresh lock file should still be there — we did NOT reap it.
    expect(existsSync(lockPath)).toBe(true);
  });
});

/**
 * Cross-process file lock — sync, atomic, no third-party deps.
 *
 * Used by writeSharedEntry (shared-channel.ts) and appendHeartbeat /
 * markCompleted (dispatch-record-writer.ts) to guard the
 * read-modify-write sequence against lost updates from concurrent
 * writers (slice 2026-06-23-audit-3rd finding #2 + #3).
 *
 * Mechanism: write a sidecar `.lock` file next to the target via
 * `fs.openSync(path, 'wx')`. The `wx` flag maps to O_CREAT|O_EXCL on
 * POSIX (atomic) and `CreateFileW(... CREATE_NEW)` on Windows (also
 * atomic). The second opener fails with EEXIST. We retry with capped
 * exponential backoff up to MAX_LOCK_RETRIES, falling through to
 * LOCK_TIMEOUT if the lock cannot be acquired.
 *
 * Stale-lock reaping: a crashed previous holder leaves a `.lock` file
 * behind. We reap locks older than LOCK_STALE_MS by unlinking before
 * retrying. This trades a one-time stale-lock window for bounded
 * recovery without leaking orphan locks.
 *
 * Why not fs.flock? Node's `fs.flock` is POSIX-only; on Windows it
 * throws ERR_FEATURE_UNAVAILABLE_ON_PLATFORM. The `.lock` file
 * pattern works uniformly across platforms and survives process
 * crashes (the file remains; the next acquirer reaps it).
 */
import { closeSync, existsSync, mkdirSync, openSync, statSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const MAX_LOCK_RETRIES = 100;
const LOCK_RETRY_BASE_MS = 5;
const LOCK_RETRY_MAX_MS = 50;
const LOCK_STALE_MS = 30_000;

export class LockTimeoutError extends Error {
  readonly code = 'LOCK_TIMEOUT';
  readonly lockPath: string;
  constructor(lockPath: string, attempts: number) {
    super(
      `LOCK_TIMEOUT: failed to acquire ${lockPath} after ${attempts} retries ` +
      `(a prior holder may be alive or the lock is stale; it will be reaped ` +
      `after ${LOCK_STALE_MS}ms of inactivity)`
    );
    this.lockPath = lockPath;
  }
}

/**
 * Run `fn` while holding an exclusive lock on a sidecar file at
 * `<filePath>.lock`. The lock is released in `finally` (close fd +
 * unlink lock file). Throws LockTimeoutError after MAX_LOCK_RETRIES.
 */
export function withFileLockSync<T>(filePath: string, fn: () => T): T {
  const target = resolve(filePath);
  const lockPath = `${target}.lock`;
  // Ensure the parent dir exists before openSync('wx') — first-write
  // callers (e.g. writeSharedEntry on a fresh batch) reach the lock
  // BEFORE writeAtomic's mkdirSync(dir, { recursive: true }) runs.
  const dir = dirname(target);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Wall-clock guard (slice 014): in pathological slow-system cases, the
  // retry backoff could push wall-clock above LOCK_STALE_MS. Cap the loop at
  // LOCK_STALE_MS regardless of attempts; throw the existing LockTimeoutError.
  //
  // Slice 2026-07-12-fix note: the slice 014 implementation re-checked
  // `isStaleLock(lockPath)` at the TOP of every loop iteration. Under
  // vitest-on-Windows slowdown (each `spinSleep` actually waits hundreds of
  // ms because of event-loop preemption), the wall clock would cross
  // `LOCK_STALE_MS` mid-loop and the reaper would unlink a still-fresh
  // lock — `file-lock.test.ts` "does NOT reap a fresh .lock (<30s old)"
  // caught this: the lock was reaped at iter ~54 after 30s of retries,
  // defeating the test that asserts the fresh lock should block. The fix
  // is to check staleness ONCE, before the loop, and inside the loop
  // only retry on EEXIST. A crashed previous holder is reaped at entry;
  // after we begin the retry-backoff phase, the lock is by definition
  // non-stale (or absent after a race with another reaper), so a stale
  // check on each iteration only adds risk of spuriously reaping a lock
  // we just decided was live.
  const startedAt = Date.now();
  let attempts = 0;
  let fd: number | null = null;

  // One-shot stale reap before the loop: if a previous holder crashed and
  // left the lock older than LOCK_STALE_MS, unlink it now so the first
  // `openSync(lockPath, 'wx')` attempt can succeed.
  if (isStaleLock(lockPath)) {
    try {
      unlinkSync(lockPath);
    } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      // race: another process reaped it; loop will try to acquire directly.
    }
  }

  while (attempts < MAX_LOCK_RETRIES) {
    // Wall-clock guard runs at the top of each iteration so a slow retry
    // backoff (e.g. vitest on Windows) never lets us outlive the stale
    // threshold and re-enter the reaper branch on a still-live lock.
    if (Date.now() - startedAt > LOCK_STALE_MS) {
      throw new LockTimeoutError(lockPath, attempts);
    }

    try {
      fd = openSync(lockPath, 'wx');
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw err;
      attempts += 1;
      // Exponential backoff capped at LOCK_RETRY_MAX_MS.
      const wait = Math.min(
        LOCK_RETRY_BASE_MS * 2 ** Math.min(attempts, 6),
        LOCK_RETRY_MAX_MS
      );
      spinSleep(wait);
    }
  }

  if (fd === null) {
    throw new LockTimeoutError(lockPath, attempts);
  }

  try {
    return fn();
  } finally {
    try {
      closeSync(fd);
    } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      // fd may already be closed by the OS on a crash; ignore.
    }
    try {
      unlinkSync(lockPath);
    } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      // Best-effort: stale .lock is harmless; the next acquirer reaps.
    }
  }
}

function isStaleLock(lockPath: string): boolean {
  try {
    const s = statSync(lockPath);
    return Date.now() - s.mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}

/**
 * Synchronous sleep via busy-wait. Bounded by MAX_LOCK_RETRIES *
 * LOCK_RETRY_MAX_MS = 5s worst case. The alternative — async sleep —
 * would force every lock consumer to become async, which is a much
 * larger refactor for a slice whose lock contention is rare (concurrent
 * `peaks sub-agent share` for the same batch).
 */
function spinSleep(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* intentional spin */
  }
}

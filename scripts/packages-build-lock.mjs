// scripts/packages-build-lock.mjs
//
// One exclusive lock file per resolved project root, its two bounds, and the sleep
// that is not a timer because `globalSetup` is synchronous. Everything here is about
// the lock and nothing here reads the tree.
//
// Split out of `scripts/packages-build-prerequisite.mjs` (rid-043). Every line below
// was moved VERBATIM from that file; only this header, the import block, the
// re-export block on the entry, and the `export` keyword on names a sibling imports
// are new.

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// CONCURRENCY AND IDEMPOTENCY
//
// More than one entry point can run at once: `test:full` is
// `pnpm -r --include-workspace-root --workspace-concurrency=2 run test`, and
// two terminals are the same shape. Two `globalSetup` runs building into the
// same `dist/` at the same time is duplicate work at best. The mechanism is a
// single exclusive lock file under `os.tmpdir()`, keyed by a digest of the
// resolved project root so two worktrees do not share it:
//
//   - the lock is created — and its owner token written — by one
//     `writeFileSync(lock, token, { flag: 'wx' })`. The `O_CREAT|O_EXCL` open
//     under it is atomic: exactly one process creates the file, every other
//     gets EEXIST and waits;
//   - the winner RE-READS the verdict inside the lock, so a loser that queued
//     behind a build observes the finished artifacts and builds nothing —
//     that double-check is what makes a second run idempotent rather than a
//     second build;
//   - a lock older than `LOCK_STALE_MS` is broken, so a killed process cannot
//     wedge every later run;
//   - the lock file's CONTENT is its holder's token, and only its holder may
//     unlink it. The break above has no ownership test — it cannot have one, the
//     holder it is breaking is by definition not answering — so without a token
//     a broken-but-still-running holder's `finally` deletes the lock the break's
//     WINNER now holds, and a third run then builds alongside the winner;
//   - the lock is released in a `finally`, so a failed build does not leave it.

/**
 * How long a run that finds the lock held blocks before refusing.
 *
 * The lock absorbs a CONCURRENT run, and the only command it guards is
 * `PACKAGES_BUILD_COMMAND`. Its cost is host-dependent, and on this repository
 * it was measured five times by two agents on 2026-09-24/25: 8909, 8946 and
 * 9277 ms (`.peaks/_runtime/2026-09-24-session-b714c7/qa/cycle3/build-timings.log`,
 * three runs, all `exit=0`) and 13 731 / 14 178 ms (`.peaks/docs/backlog.md`
 * §2.13). Those five are `pnpm build` runs — the whole
 * `package.json#scripts.build` chain, which INCLUDES the packages build as one
 * of its steps — so they are an upper proxy for the command this lock guards,
 * and the margin quoted below is the conservative one. A minute is 6.7x the
 * FASTEST of those and 4.2x the slowest, so a legitimate holder is never cut
 * off — quoted as the range, because one figure for a command with ~60 % host
 * variance is not a fact about the command.
 *
 * (An earlier revision of this comment said "measured at 2.94 s on a warm tree.
 * A minute is ~20x that" — 20x is right, and so was the measurement: 2.94 s is
 * the guarded command itself, `PACKAGES_BUILD_COMMAND` on a warm tree, recorded
 * in `.peaks/_runtime/2026-09-24-session-b714c7/rd/rid-muf2sasw-handoff.md`. It
 * lies BELOW every value in the range above rather than inside it, so it is not
 * the low outlier of that spread and must not be read as a member of it; the
 * retired sentence was wrong about which set the number belonged to, not about
 * the number. It is corrected here rather than quietly dropped because a comment
 * is a claim, and this one would have outlived the tree that disproved it.)
 *
 * Past the minute the run refuses with the lock path and the action rather than
 * blocking on silently. Exported because a bound nobody can read is a bound
 * nobody can hold this module to.
 */
export const LOCK_WAIT_MS = 60_000;

/** One minute in milliseconds — the unit both lock bounds are read in. */
const MINUTE_MS = 60_000;

/** The stale-lock bound, in whole minutes. Kept above `LOCK_WAIT_MS`. */
const LOCK_STALE_MINUTES = 10;

/**
 * The age at which a lock nobody is waiting behind is presumed dead and broken.
 *
 * Deliberately LONGER than `LOCK_WAIT_MS`, and for a different reader: a waiter
 * refuses before it could ever break the lock it was waiting on, so this bound
 * serves the later run that arrives to find a crashed holder's lock already old.
 * A developer is never blocked for it.
 *
 * WHAT THAT ORDERING COSTS, AND WHY IT IS STILL THE RIGHT ONE. This process is
 * itself a lock source, and it needs no second user and no platform that permits
 * one: a run killed between the `open` in `acquireLock` and the `finally` in
 * `ensurePackagesBuilt` leaves its lock behind, and because this bound sits ten
 * times above `LOCK_WAIT_MS`, the lock is never broken early — every later run
 * pays the full wait and then refuses, until the corpse ages out. Measured
 * 2026-09-24 by an independent review and recorded in `.peaks/docs/backlog.md`
 * §2.15 (not re-measured here): a lock file this process did not create, with a
 * fresh mtime, is waited out and refused — `THREW after 8111ms`, `age 8s`.
 *
 * The window is BOUNDED for every pass that REACHES the checks, and it is not a
 * hang: the mechanism that makes that true is the CHECK ORDER inside
 * `acquireLock` — `LOCK_WAIT_MS` is read before this bound is considered — and
 * every pass that reaches that read either refuses or sleeps a poll. ONE PASS
 * IS NOT COVERED, and it is named rather than left to be found: a `statSync`
 * failure above that read `continue`s with neither the bound read nor a sleep.
 * Its only cause reachable here is the transient release race, which costs one
 * pass rather than a hang; the persistent POSIX route is reasoned and disclosed
 * rather than measured (`.peaks/docs/backlog.md` §2.15, which owns the routing).
 * So a lock that is present and CANNOT be unlinked — a directory at the lock
 * path, a foreign-owned file in a sticky `/tmp` — still ends in the refusal
 * rather than in a spin, and the refusal names the lock file and the action, so
 * the cost is a directed message rather than a hunt. That sentence
 * used to be an assertion instead of a consequence: an unlink that kept failing
 * `continue`d past both this bound and the sleep, so the window had no end. And
 * inverting the two bounds is worse in a way that is not recoverable, because a
 * waiter that outlives this bound would break a lock a LIVE holder still holds,
 * and the command this lock guards sits inside a `pnpm build` measured at
 * 8.9-14.2 s here (see `LOCK_WAIT_MS`) — a cold cache, an `npm`-contended CI box
 * or a loaded host can push it past any bound drawn close to it, and two
 * concurrent builds writing the same `dist/` is exactly what this lock exists to
 * prevent.
 * A wait on a corpse costs a minute; a broken live lock corrupts the artifacts
 * the tests then vouch for.
 */
export const LOCK_STALE_MS = LOCK_STALE_MINUTES * MINUTE_MS;

export const POLL_MS = 200;

/** Bytes in the one-element `Int32Array` that `Atomics.wait` needs as a guard. */
const INT32_BYTES = 4;

/** Hex characters of the project-root digest that key this project's lock file. */
const LOCK_KEY_HEX_CHARS = 16;

/**
 * The exclusive lock for one project root. Keyed by the resolved root so two
 * checkouts (or two worktrees) never contend for the same file.
 *
 * @param {string} projectRoot
 */
export function lockPath(projectRoot) {
  const key = createHash('sha256')
    .update(resolve(projectRoot))
    .digest('hex')
    .slice(0, LOCK_KEY_HEX_CHARS);
  return join(tmpdir(), `peaks-packages-build-${key}.lock`);
}

/** `globalSetup` is synchronous, so the poll cannot be a timer. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(INT32_BYTES)), 0, 0, ms);
}

/**
 * A lock failure that is not contention — an unwritable or absent temp
 * directory, most often — said in this module's vocabulary: what failed, which
 * file it was, and what to do. The only path that takes the lock is the one that
 * NEEDS a build, so a fresh container is exactly where this lands, and a raw
 * `ENOENT` there names neither the file nor the fix.
 */
function lockUnavailableError(lock, cause) {
  return new Error(
    [
      '',
      `Cannot create the packages build lock: ${cause?.code ?? 'unknown error'}.`,
      '',
      `  lock file: ${lock}`,
      `  ${cause?.message ?? String(cause)}`,
      '',
      '  The lock lives in the OS temp directory. Make that directory exist and be',
      '  writable (TMPDIR / TMP / TEMP), then re-run.',
      ''
    ].join('\n'),
    { cause }
  );
}

/**
 * Take the lock, or wait for it, or refuse.
 *
 * Returns the token this run WROTE into the lock file. That token is this run's
 * only claim on the file, and `releaseLock` is the only reader of it, so the
 * acquirer has to carry it back to its own `finally` — it is returned rather
 * than stashed anywhere precisely because there is nowhere in this module that
 * a second run could see.
 *
 * @param {string} lock
 * @param {number} waitMs
 * @param {number} pollMs
 * @returns {string} the owner token now recorded in `lock`
 */
export function acquireLock(lock, waitMs, pollMs) {
  const deadline = Date.now() + waitMs;
  // A fresh token per attempt, and written by the same `O_CREAT|O_EXCL` call
  // that creates the file: exactly one process can ever get past that call, so
  // exactly one token can ever be the file's first content.
  const token = randomUUID();
  for (;;) {
    try {
      writeFileSync(lock, token, { flag: 'wx' });
      return token;
    } catch (error) {
      // EEXIST is the contended case this loop is for; anything else (ENOENT,
      // EACCES, ENOSPC) is a lock that cannot exist at all.
      if (error?.code !== 'EEXIST') throw lockUnavailableError(lock, error);
    }
    let ageMs;
    try {
      ageMs = Date.now() - statSync(lock).mtimeMs;
    } catch {
      // The holder released it between our `open` and our `stat` — try again.
      continue;
    }
    // The bound is read BEFORE the stale break, and that order is the whole
    // reason this loop terminates. A lock that is present but cannot be
    // unlinked — a directory at the lock path, a foreign-owned file in a sticky
    // /tmp — takes the branch below on EVERY pass, so a `continue` inside it
    // would skip both this check and the `sleep`, and the loop would spin
    // without ever consulting `waitMs`. It falls through to the `sleep` now, so
    // every pass that REACHES this line either refuses or waits a poll — and the
    // one pass that does not reach it is the `statSync` failure above, whose
    // `continue` skips both this check and the sleep (see `LOCK_STALE_MS`).
    if (Date.now() > deadline) {
      throw new Error(
        [
          '',
          `Another peaks-loop process holds the packages build lock (age ${Math.round(ageMs / 1000)}s), so this run gave up after ${Math.round(waitMs / 1000)}s.`,
          '',
          `  lock file: ${lock}`,
          '',
          '  If no other test run is active, delete that file and re-run.',
          ''
        ].join('\n')
      );
    }
    if (ageMs > LOCK_STALE_MS) {
      try {
        unlinkSync(lock);
      } catch {
        // Another waiter broke it first; the next `open` decides the winner.
      }
    }
    sleep(pollMs);
  }
}

/**
 * Release the lock — but only the one this run took.
 *
 * The ownership test is the file's content against this run's token, and it is
 * load-bearing rather than defensive. A run whose lock was broken as stale while
 * it was still working reaches this function holding a token the file no longer
 * carries: A holds the lock past `LOCK_STALE_MS` → B breaks it and acquires →
 * A's `finally` unlinks B's lock → C acquires alongside B. An unconditional
 * `unlinkSync` here is that whole sequence; comparing first is what makes the
 * stale-break safe to keep.
 *
 * @param {string} lock
 * @param {string | undefined} token the value `acquireLock` returned, i.e. what
 *   this run wrote into `lock` and the only content it is entitled to delete
 */
export function releaseLock(lock, token) {
  let held;
  try {
    held = readFileSync(lock, 'utf8');
  } catch {
    // Already gone (broken as stale by a waiter) — nothing to release.
    return;
  }
  if (held !== token) return; // someone else's lock; breaking it is not ours to do
  try {
    unlinkSync(lock);
  } catch {
    // Raced with a waiter between the read above and this unlink. The next
    // `open` decides the winner either way, so there is nothing to repair.
  }
}

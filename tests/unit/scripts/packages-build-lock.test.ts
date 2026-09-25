// tests/unit/scripts/packages-build-lock.test.ts
//
// The OWNERSHIP half of the packages build lock: who may delete the lock file,
// and who may not. The lock's other properties — the wait, the refusal text, the
// stale break on a lock that CAN be broken, the re-read inside the lock — are
// pinned in `tests/unit/scripts/packages-build-prerequisite.test.ts` and are not
// restated here. The one exception is the `unbroke` case below: a lock whose
// stale break keeps FAILING needs a bound outside the process that spins, which
// is why the sibling file cannot pin it, and why it lives here. This file exists
// because that one had 17 code lines left under the 400-line ceiling, and
// because these cases are one property each rather than neighbours.
//
// THE DEFECT (F4, measured 2026-09-24 by an independent review and recorded in
// `.peaks/docs/backlog.md` §2.15 — not re-measured here). The lock file was
// empty, so nothing in it said whose it was. `acquireLock` breaks a lock older
// than `LOCK_STALE_MS` without any ownership test — it cannot test ownership, the
// holder it is breaking has by definition stopped answering — and `releaseLock`
// unlinked unconditionally inside a `finally`. So: A holds the lock past
// `LOCK_STALE_MS` → B breaks it as stale and acquires → A's `finally` unlinks
// B's lock → C acquires alongside B. No collision, no attacker, no second user:
// just a long build. The fix is a token written at acquire time and compared at
// release time.
//
// WHAT EACH CASE PINS, and the mutation that reddens it:
//
//   ABA     → a run whose lock was broken past it deletes NOTHING. The state is
//             PRESENTED (a different owner's token is written into the file
//             while the first run is inside its build leg) rather than raced
//             for, because a 10-minute hold is not a state a test can enter.
//             MUTATION: make `releaseLock` unlink unconditionally again — the
//             file is gone and this goes red.
//   release → the SAME `releaseLock`, with nothing interfering, does delete its
//             own lock. Without this half the case above is satisfied by a
//             `releaseLock` that never deletes anything, which is a worse bug
//             than the one being fixed (the lock would never be released at
//             all). MUTATION: make `releaseLock` a no-op — this goes red.
//   corpse  → a lock left by a killed run is still BROKEN. F4's fix must not be
//             read as "only delete a lock whose token is ours": that reading
//             makes a corpse unbreakable and wedges every later run forever,
//             which is the `:182` property this slice is required to keep.
//             MUTATION: require the stale break to match our own token — the
//             corpse survives, the wait expires, and this throws instead.
//   unbroke → a stale lock whose break keeps FAILING is still bounded. The stale
//             branch's `continue` used to fire before the deadline check and
//             before the `sleep`, so a lock path that cannot be unlinked — a
//             directory there, measurably: `EEXIST` from the `wx` create and
//             `EPERM` from the unlink, both re-measured on this host — spun with
//             no deadline and no refusal at all. MUTATION: the pre-fix route,
//             i.e. the `continue` back AND the bound read only on a pass that did
//             not take the branch — just the `continue` is NOT enough, because
//             the bound above it still ends the loop. `r1` in
//             `rd/repair1-mutations.mjs` is that route, read out of git; it
//             reddens this in 61 s, killed at the parent's bound with no output.
//             WHAT IT CANNOT SEE, so that the name is not read for more than it
//             asserts: a bounded-but-busy spin. With the bound still above the
//             branch and the `continue` back, this case stays GREEN (measured
//             2026-09-25), so "instead of spinning" here means "instead of never
//             refusing at all". The CPU property that separates a poll from a
//             spin is pinned by the A/B probe
//             (`rd/repair1-probes/busy-vs-poll-probe.mjs`), not by this suite.
//   untoken → an injected `acquireLock` that returns `undefined` (no token at
//             all) releases NOTHING, even with a foreign lock present. The
//             sibling's stub leaves no lock file, so it never presents a
//             token-less release against a lock that exists. MUTATION: make
//             `releaseLock` unlink unconditionally — the foreign lock is gone.
//
// Dimensions covered:
//   - behavior:    the ownership decision on release, and the break it must not
//                  disable
//   - integration: the real lock file in `os.tmpdir()`, taken and released by
//                  the real entry point, and refused by a real child process
//                  when it cannot be broken
//   - render:      OMITTED — the lock renders nothing, and the build line this
//                  module writes is pinned by the sibling test file
//   - a11y:        OMITTED — no new operator-facing text; the refusals and their
//                  remedy text are unchanged by this slice

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ensurePackagesBuilt, lockPath } from '../../../scripts/packages-build-prerequisite.mjs';
import { declareDimensions } from '../_setup/4dim-template.js';
import { fixture, recordingBuild, REPO_ROOT, SOURCE_A } from '../_setup/packages-build-fixture.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

/**
 * The module the child below imports, resolved from THIS file's repository so
 * the child runs the working tree and not a copy of it.
 */
const MODULE_URL = pathToFileURL(
  resolve(REPO_ROOT, 'scripts', 'packages-build-prerequisite.mjs')
).href;

/**
 * The `unbroke` case's subject, run in its own process.
 *
 * It has to be a process: the pre-fix loop is SYNCHRONOUS, so a bound written in
 * this one — a wall-clock assertion, or vitest's own timeout, which is a timer on
 * this event loop — cannot run while it spins. The parent bounds the child
 * instead, which is the only place a bound can live. The child takes the fixture
 * root from `argv[1]` and reports; every assertion stays in the parent.
 */
const WEDGE_CHILD = `
import { ensurePackagesBuilt } from ${JSON.stringify(MODULE_URL)};
const started = Date.now();
let refused = false;
let message = '';
try {
  ensurePackagesBuilt(process.argv[1], { runBuild: () => {}, waitMs: 1000, pollMs: 5 });
} catch (error) {
  refused = true;
  message = String(error && error.message);
}
console.log('refused=' + refused + ' elapsedMs=' + (Date.now() - started));
console.log('message=' + message);
`;

declareDimensions(
  'tests/unit/scripts/packages-build-lock.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason:
        'the lock renders nothing; the build line this module writes is pinned in the sibling test file'
    },
    {
      dim: 'a11y',
      reason:
        'no new operator-facing text — the refusals and their remedy are unchanged by this slice'
    }
  ]
);

describe('Scenario: behavior — only the lock’s holder may delete it', () => {
  it('when a run’s lock was broken as stale and the breaker has taken it, should leave the breaker’s lock in place', () => {
    // given: a run that holds the real lock and is inside its build leg
    const root = fixture({ a: SOURCE_A });
    const lock = lockPath(root);
    const calls: string[] = [];
    let ownToken = '';
    let breakerToken = '';

    // when: its lock is broken as stale while it works — the ten minutes of
    //       holding replaced by the state they produce. The breaker's two
    //       syscalls are `acquireLock`'s own, in order: unlink the stale lock,
    //       then create the file with its token — and the broken run then
    //       leaves through its `finally`
    ensurePackagesBuilt(root, {
      runBuild: (buildRoot: string) => {
        ownToken = readFileSync(lock, 'utf8');
        breakerToken = `${ownToken}-breaker`;
        rmSync(lock, { force: true });
        writeFileSync(lock, breakerToken, { flag: 'wx' });
        recordingBuild(calls)(buildRoot);
      }
    });

    // then: the breaker's lock is still there — a run that no longer owns the
    //       lock deletes nothing — and the run it belonged to had written a
    //       token of its own, which is what the comparison is against
    expect(ownToken.length).toBeGreaterThan(0);
    expect(readFileSync(lock, 'utf8')).toBe(breakerToken);
  });

  it('when a run takes the lock and nothing interferes, should delete its own lock', () => {
    // given: a tree with nothing built, so the run has to take the real lock.
    //        The pair is deliberate — the case above passes for a `releaseLock`
    //        that deletes nothing at all, and this is what that would break.
    const root = fixture({ a: SOURCE_A });
    const lock = lockPath(root);
    const calls: string[] = [];

    // when: it acquires, builds and exits
    const result = ensurePackagesBuilt(root, { runBuild: recordingBuild(calls) });

    // then: it built, and the lock it took is gone
    expect(result.built).toBe(true);
    expect(calls).toEqual([root]);
    expect(existsSync(lock)).toBe(false);
  });

  it('when a lock is left behind by a killed run, should still break it and build', () => {
    // given: a corpse — a lock whose holder is gone, older than the stale
    //        bound, carrying the dead run's token rather than ours
    const root = fixture({ a: SOURCE_A });
    const lock = lockPath(root);
    writeFileSync(lock, 'the-token-of-the-run-that-died', 'utf8');
    const longAgo = (Date.now() - 60 * 60_000) / 1000;
    utimesSync(lock, longAgo, longAgo);

    // when: a later run needs the lock
    const calls: string[] = [];
    const result = ensurePackagesBuilt(root, {
      runBuild: recordingBuild(calls),
      waitMs: 60,
      pollMs: 1
    });

    // then: it broke the corpse and built. The ownership rule governs RELEASE;
    //       read as "only a token we wrote may be deleted" it would make a
    //       corpse unbreakable and refuse here instead
    expect(result.built).toBe(true);
    expect(calls).toEqual([root]);
  });

  it('when the wait took no lock and a foreign lock is present, should leave that lock in place', () => {
    // given: a run whose acquisition is injected and returns `undefined` — the
    //        no-token arm the injection point's own signature allows — with a
    //        lock file on disk that this run did not write
    const root = fixture({ a: SOURCE_A });
    const lock = lockPath(root);
    const foreign = 'the-token-of-a-run-that-is-not-this-one';
    writeFileSync(lock, foreign, 'utf8');
    const calls: string[] = [];

    // when: it reaches its `finally` and releases
    const result = ensurePackagesBuilt(root, {
      runBuild: recordingBuild(calls),
      acquireLock: () => undefined
    });

    // then: it built, and the foreign lock is untouched. `readFileSync` cannot
    //       return `undefined`, so a run holding no token can never match a
    //       file's content and deletes nothing but its own lock
    expect(result.built).toBe(true);
    expect(calls).toEqual([root]);
    expect(readFileSync(lock, 'utf8')).toBe(foreign);
  });
});

describe('Scenario: integration — the bound holds when the lock cannot be unlinked', () => {
  it(
    'when the lock path holds a directory, should refuse at the wait bound instead of spinning',
    () => {
      // given: a run that needs the lock, and a DIRECTORY at the lock path aged
      //        past the stale bound — a lock that is present on every pass and can
      //        never be unlinked (`EEXIST` from the `wx` create, `EPERM` from the
      //        unlink; both measured on this host, and the same shape the OS
      //        produces for a foreign-owned file in a sticky `/tmp`)
      const root = fixture({ a: SOURCE_A });
      const lock = lockPath(root);
      mkdirSync(lock, { recursive: true });
      const longAgo = (Date.now() - 60 * 60_000) / 1000;
      utimesSync(lock, longAgo, longAgo);

      // when: the run is made in a child process, because the loop it must not
      //       spin in is synchronous — no assertion and no vitest timeout in this
      //       process could ever run against it
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', WEDGE_CHILD, root], {
        encoding: 'utf8',
        // The parent's own bound. A regression to the spin is killed here and
        // FAILS this case instead of hanging the suite, which is the whole reason
        // the call is spawned rather than made in-process.
        timeout: 60_000,
        windowsHide: true
      });

      // then: it refused, in the module's own words, naming the file and the wait
      //       it paid. The two spawn assertions are the falsifiable half: a spin
      //       is killed at the bound above, so `error` carries `ETIMEDOUT` and the
      //       exit status is null with EMPTY output — no assertion below can then
      //       be satisfied by it
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      expect(child.stdout).toContain('refused=true');
      expect(child.stdout).toContain('gave up after 1s');
      expect(child.stdout).toContain(lock);
      // And the refusal came out of the WAIT rather than out of the loop's own
      // retry: `waitMs` is 1000, so a bound that is read at all is read here.
      expect(Number(/elapsedMs=(\d+)/.exec(child.stdout)?.[1])).toBeLessThan(5_000);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});

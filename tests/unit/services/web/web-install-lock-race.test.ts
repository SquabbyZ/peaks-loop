// tests/unit/services/web/web-install-lock-race.test.ts
//
// The reclaim race the single-threaded lock tests structurally cannot see (R15).
//
// `acquireInstallLock` is synchronous, so two PROCESSES cannot be raced from one
// test body. What can be reproduced deterministically is the interleaving that
// matters, by running caller A's whole reclaim at the exact instant B is between
// its read of the stale body and its removal of the file:
//
//   A unlink → A create (A holds) → B unlink (A's FRESH lock) → B create (B holds)
//
// `node:fs` is mocked in this file only, to fire that hook on whichever
// mutation the implementation uses (an unlink on the old code, a rename on the
// repaired one), so the SAME test drives both: it is refused on the repaired
// code and takes the lock on the old one. That is the whole point — a test that
// cannot fail against the bug is not a test.
//
// Dimensions covered:
//   - behavior:    exclusivity holds across an interleaved reclaim
//   - integration: real lock files, real rename/unlink on disk
//   - a11y:        not applicable (no user-facing surface)
//   - render:      not applicable (returns a boolean, prints nothing)

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/services/web/web-install-lock-race.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'a11y', reason: 'lock acquisition has no user-facing surface' },
    { dim: 'render', reason: 'it returns a boolean and prints nothing' }
  ],
);

/** The real `node:fs`, kept reachable so the hook can act without re-entering itself. */
const fsRef = vi.hoisted(() => ({ actual: null as null | typeof import('node:fs') }));

/** Fires once, immediately before the implementation's first mutation of the lock. */
const hook = vi.hoisted(() => ({
  armed: false,
  fired: false,
  racer: null as null | (() => void)
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  fsRef.actual = actual;
  const beforeMutation = (target: unknown): void => {
    if (!hook.armed || hook.fired || typeof target !== 'string' || !target.endsWith('install.lock')) {
      return;
    }
    hook.fired = true;
    hook.racer?.();
  };
  return {
    ...actual,
    unlinkSync: (path: Parameters<typeof actual.unlinkSync>[0]) => {
      beforeMutation(path);
      return actual.unlinkSync(path);
    },
    renameSync: (from: Parameters<typeof actual.renameSync>[0], to: Parameters<typeof actual.renameSync>[1]) => {
      beforeMutation(from);
      return actual.renameSync(from, to);
    }
  };
});

import { webInstallLockPath } from '../../../../src/services/web/web-artifact-paths.js';
import { acquireInstallLock } from '../../../../src/services/web/web-install-service.js';

const ws = withTmpWorkspacePerTest('peaks-web-lock-race-');
const HOME_KEYS = ['HOME', 'USERPROFILE'] as const;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of HOME_KEYS) {
    savedEnv.set(key, process.env[key]);
    process.env[key] = ws().path;
  }
  hook.armed = false;
  hook.fired = false;
  hook.racer = null;
  const lock = webInstallLockPath();
  mkdirSync(dirname(lock), { recursive: true });
  // A stale lock: its owner is a pid that cannot exist.
  writeFileSync(lock, JSON.stringify({ pid: 2_147_483_646, startedAt: new Date().toISOString() }), 'utf8');
});

afterEach(() => {
  for (const key of HOME_KEYS) {
    const previous = savedEnv.get(key);
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
  savedEnv.clear();
});

/** Caller A's reclaim, start to finish, performed with the real `node:fs`. */
function racerTakesTheLock(): void {
  const fs = fsRef.actual;
  if (fs === null) {
    throw new Error('the fs mock never captured the real module');
  }
  const lock = webInstallLockPath();
  fs.renameSync(lock, `${lock}.a-claim`);
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'utf8');
}

describe('behavior — the stale-lock reclaim', () => {
  it('when a racer completes its reclaim mid-reclaim, should refuse the second caller', () => {
    // given: a stale lock, and a racer that wins its own reclaim at exactly the
    //        moment between this caller's read of the stale body and its removal
    hook.racer = racerTakesTheLock;
    hook.armed = true;
    // when:  this caller reclaims
    const acquired = acquireInstallLock();
    // then:  it is REFUSED. On the unlink-based code this returns true and both
    //        callers download into one cache — the corrupt-cache outcome the
    //        lock exists to prevent.
    expect(hook.fired).toBe(true);
    expect(acquired).toBe(false);
    // ...and the racer's fresh lock is still on disk, still naming the racer:
    // the repair puts back what it moved rather than deleting it.
    const body = JSON.parse(fsRef.actual!.readFileSync(webInstallLockPath(), 'utf8')) as {
      pid: number;
    };
    expect(body.pid).toBe(process.pid);
  });

  it('when nothing races the reclaim, should still take a stale lock', () => {
    // given: the same stale lock and no racer
    hook.armed = false;
    // when:  the lock is acquired
    // then:  the ordinary reclaim path is untouched by the fix
    expect(acquireInstallLock()).toBe(true);
  });
});

// tests/unit/services/web/web-daemon-race.test.ts
//
// The R3 / Q8 concurrency integration test: two callers cold-starting the same
// `(projectRoot, sessionId)` at the same moment must produce EXACTLY ONE daemon.
//
// Why a real subprocess race and not two in-process calls: Q10 lets the
// orchestrator and a sub-agent (`peaks` processes) call `peaks web`
// simultaneously, and `acquireSpawnLock` proves ownership with a pid. Two callers
// in one process share that pid, so the cross-process case — the one the lock
// exists for — is the one that has to be measured. `ensure-daemon-racer.ts` is
// that caller, launched with `tsx` because the daemon entry in this tree is
// TypeScript.
//
// What is asserted:
//   - both callers reach the SAME daemon (pid and port), i.e. the loser waits for
//     the winner instead of spawning its own;
//   - exactly ONE daemon booted, counted from `daemon.log` — the boot line is
//     the only surviving record of a second daemon, because `daemon.json` is
//     overwritten by the last writer;
//   - a later caller REUSES that daemon (no second boot, same pid), which is the
//     warm path QA's AC3 false-pass row is written against.
//
// Chromium itself is not asserted here: it is launched lazily by the daemon, so
// "one daemon" is the browser-count invariant at this layer. Counting real
// chromium processes is the parent session's E2E job.
//
// Dimensions covered:
//   - behavior:    the cold-start/warm-path decision (one spawn, then reuse)
//   - integration: two real processes, a real lock file, a real HTTP daemon

import { readFileSync, existsSync, mkdirSync, watch, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/services/web/web-daemon-race.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'no user-visible text: the callers are processes, not commands' },
    { dim: 'a11y', reason: 'no CLI envelope or exit code is produced at this layer' },
  ],
);

import {
  isProcessAlive,
  readDaemonInfo
} from '../../../../src/services/web/daemon-registry.js';
import {
  interpreterArgs,
  stopDaemon,
  type StopDaemonResult
} from '../../../../src/services/web/daemon-supervisor.js';
import { webDaemonInfoPath, webLogPath, webSpawnLockPath } from '../../../../src/services/web/web-artifact-paths.js';
import { WebDaemonClient } from '../../../../src/services/web/web-client.js';

const SESSION_ID = '2026-09-10-session-race01';
const RACER = resolve(__dirname, '..', '..', '..', 'fixtures', 'web', 'ensure-daemon-racer.ts');
/** A cold start pays npx + tsx + boot; the readiness budget inside is 20 s. */
const RACE_TIMEOUT_MS = 90_000;

/**
 * How long to wait for the winner to take the cold-start lock before giving up
 * and letting the test proceed (a stuck caller must fail on its own timeout,
 * not hang the suite).
 */
const LOCK_WAIT_TIMEOUT_MS = 20_000;

/**
 * How long after the winner takes the lock the second caller is released.
 *
 * The window to aim at is [the winner has spawned, a daemon is reachable]. Its
 * floor is a few milliseconds (spawn returns immediately) and its ceiling is
 * npx + node + boot — hundreds of milliseconds at the very least. 150 ms sits
 * near the floor and far under the ceiling on every machine, which is what
 * makes this a test rather than a coin toss.
 */
const SECOND_CALLER_DELAY_MS = 150;

const ws = withTmpWorkspacePerTest('peaks-web-race-');
const cleanups: Array<() => Promise<StopDaemonResult>> = [];
const roots: string[] = [];
/** Every caller process this file started, so a failed test cannot leave one brooding. */
const racers: ChildProcess[] = [];

/**
 * A best-effort safety net, deliberately WITHOUT the zero-survivor assertion.
 *
 * The proof itself runs inside each test body (`reapDaemons`), because here it
 * would depend on this hook running before `withTmpWorkspacePerTest`'s — vitest
 * 4's undocumented `sequence.hooks: 'stack'` default is what makes that true
 * today, and if it ever changed the log would already be deleted, `daemonPids`
 * would read `[]`, and `expect([]).toEqual([])` would pass having reaped
 * nothing. An assertion that can pass vacuously is worse than no assertion.
 */
afterEach(async () => {
  for (const child of racers.splice(0)) {
    killProcess(child.pid);
  }
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
  for (const projectRoot of roots.splice(0)) {
    for (const pid of daemonPids(projectRoot)) {
      killProcess(pid);
    }
  }
});

/** SIGKILL, because a teardown-aware SIGTERM is what this file is testing. */
function killProcess(pid: number | undefined): void {
  if (pid === undefined || !isProcessAlive(pid)) {
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // It exited between the probe and the signal.
  }
}

/**
 * Stop everything one test started, then PROVE zero survivors — inside the test
 * body, before any `afterEach` can delete the log that is the only record of a
 * double spawn's loser, and after every racer is dead so nothing can boot a
 * fresh daemon behind the sweep.
 */
async function reapDaemons(projectRoot: string): Promise<void> {
  for (const child of racers.splice(0)) {
    killProcess(child.pid);
  }
  // A daemon spawned a moment ago may not have written its boot line yet, and
  // the boot line is the only handle on a losing daemon of a double spawn.
  await waitForQuiet(projectRoot);
  for (const pid of daemonPids(projectRoot)) {
    killProcess(pid);
  }
  await waitUntil(() => daemonPids(projectRoot).every((pid) => !isProcessAlive(pid)));
  expect(daemonPids(projectRoot).filter((pid) => isProcessAlive(pid))).toEqual([]);
}

interface Reached {
  readonly pid: number;
  readonly port: number;
}

/** Run one caller as a real process; the daemon it reached, or a rejection. */
function raceCaller(projectRoot: string, trigger?: { ready: string; fire: string }): Promise<Reached> {
  return new Promise<Reached>((settle, reject) => {
    // The same interpreter shape the daemon itself is launched with, so this
    // process has no grandchild escaping our windowsHide (see interpreterArgs).
    const child = spawn(
      process.execPath,
      [
        ...interpreterArgs(RACER),
        projectRoot,
        SESSION_ID,
        ...(trigger === undefined ? [] : [trigger.ready, trigger.fire])
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      }
    );
    // Kept, not dropped: a caller that fails or times out is still alive and can
    // spawn a daemon AFTER the survivor sweep, which is how the suite leaked the
    // very processes it exists to detect.
    racers.push(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`racer exited ${String(code)}: ${stderr.trim()}`));
        return;
      }
      settle(JSON.parse(stdout.trim()) as Reached);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resume) => {
    setTimeout(resume, ms);
  });
}

/**
 * Resolve as soon as the winner has created the cold-start lock, so the second
 * caller can be launched inside the window the lock is supposed to cover.
 *
 * Event-driven (`fs.watch`) rather than polled: the pre-repair lock lived for
 * only a few milliseconds, and a poll would step over it — taking the
 * demonstration's ability to discriminate with it. The interval poll is a
 * backstop for a watch that misses.
 */
async function waitForSpawnLock(projectRoot: string): Promise<void> {
  const lockPath = webSpawnLockPath(projectRoot, SESSION_ID);
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  // The winner creates this directory just before it takes the lock; creating
  // it here as well (an idempotent `mkdir -p`) is what makes it watchable before
  // that happens.
  mkdirSync(dirname(lockPath), { recursive: true });
  const watcher = watch(dirname(lockPath));
  let changed = false;
  watcher.on('change', () => {
    changed = true;
  });
  try {
    while (Date.now() < deadline) {
      if (existsSync(lockPath)) {
        return;
      }
      if (!changed) {
        await delay(5);
      }
      changed = false;
    }
  } finally {
    watcher.close();
  }
}

/** How many daemons have ever booted for this session. One line per boot. */
function bootCount(projectRoot: string): number {
  const log = webLogPath(projectRoot, SESSION_ID);
  if (!existsSync(log)) {
    return 0;
  }
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line.includes('daemon listening on')).length;
}

/**
 * Every daemon pid that has booted for this session, from the boot lines. It is
 * the only place a losing daemon of a double spawn is still visible.
 */
function daemonPids(projectRoot: string): number[] {
  const log = webLogPath(projectRoot, SESSION_ID);
  if (!existsSync(log)) {
    return [];
  }
  return [...readFileSync(log, 'utf8').matchAll(/daemon listening on \S+ \(pid (\d+)/g)].map(
    (match) => Number(match[1])
  );
}

async function waitUntil(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !predicate()) {
    await delay(50);
  }
}

async function waitForFile(path: string, timeoutMs = LOCK_WAIT_TIMEOUT_MS): Promise<void> {
  await waitUntil(() => existsSync(path), timeoutMs);
}

/** Resolve once no new daemon has booted for `quietMs`, or at `totalMs`. */
async function waitForQuiet(projectRoot: string, quietMs = 1_500, totalMs = 10_000): Promise<void> {
  const deadline = Date.now() + totalMs;
  let seen = daemonPids(projectRoot).length;
  let lastChange = Date.now();
  while (Date.now() < deadline) {
    const now = daemonPids(projectRoot).length;
    if (now !== seen) {
      seen = now;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= quietMs) {
      return;
    }
    await delay(100);
  }
}

describe('behavior — two callers, one session', () => {
  it(
    'when two callers cold-start the same session at once, should start exactly one daemon',
    async () => {
      // given: a project root with no daemon for this session
      // when: both callers run concurrently
      // then: both reach the same single daemon
      await withReapedDaemons(async (projectRoot) => {
        const [first, second] = await Promise.all([
          raceCaller(projectRoot),
          raceCaller(projectRoot)
        ]);
        expect(first.pid).toBe(second.pid);
        expect(first.port).toBe(second.port);
        expect(bootCount(projectRoot)).toBe(1);
        expect(isProcessAlive(first.pid)).toBe(true);
        const info = readDaemonInfo(projectRoot, SESSION_ID);
        expect(info?.pid).toBe(first.pid);
        expect(await new WebDaemonClient(info!).health()).toBe(true);
        // and: the cold-start lock was released by the winner
        expect(existsSync(webSpawnLockPath(projectRoot, SESSION_ID))).toBe(false);
      });
    },
    RACE_TIMEOUT_MS
  );

  it(
    'when a second caller starts inside the first cold start window, should still start only one daemon',
    async () => {
      // given: a second caller loaded and waiting for its start signal, so its
      // arrival is not blurred by ~300 ms of `node` + `tsx` + import
      // when: the first caller takes the cold-start lock and the second is fired
      // a fixed moment later — after the winner has spawned and far before any
      // daemon could be reachable, which is the window the lock has to cover
      // then: the late caller waits for the winner's daemon rather than starting one
      await withReapedDaemons(async (projectRoot) => {
        const ready = join(projectRoot, 'racer-ready');
        const fire = join(projectRoot, 'racer-fire');
        const lateCall = raceCaller(projectRoot, { ready, fire });
        await waitForFile(ready);
        const firstCall = raceCaller(projectRoot);
        await waitForSpawnLock(projectRoot);
        await delay(SECOND_CALLER_DELAY_MS);
        writeFileSync(fire, 'go', 'utf8');
        const [second, first] = await Promise.all([lateCall, firstCall]);
        expect(second.pid).toBe(first.pid);
        expect(second.port).toBe(first.port);
        expect(bootCount(projectRoot)).toBe(1);
      });
    },
    RACE_TIMEOUT_MS
  );

  it(
    'when a session already has a daemon, should reuse it instead of spawning a second',
    async () => {
      // given: a session whose daemon is already up
      // when: another caller asks for the daemon
      // then: it is the same daemon, and no second one booted
      await withReapedDaemons(async (projectRoot) => {
        const cold = await raceCaller(projectRoot);
        const warm = await raceCaller(projectRoot);
        expect(warm.pid).toBe(cold.pid);
        expect(warm.port).toBe(cold.port);
        expect(bootCount(projectRoot)).toBe(1);
        expect(existsSync(webDaemonInfoPath(projectRoot, SESSION_ID))).toBe(true);
      });
    },
    RACE_TIMEOUT_MS
  );
});

/**
 * Register this root and its `stop` cleanup, run the body, then reap and PROVE
 * zero survivors before the body returns — i.e. before any `afterEach`, and
 * while the tmp workspace's log file certainly still exists.
 */
async function withReapedDaemons(body: (projectRoot: string) => Promise<void>): Promise<void> {
  const projectRoot = ws().path;
  roots.push(projectRoot);
  cleanups.push(() => stopDaemon(projectRoot, SESSION_ID));
  try {
    await body(projectRoot);
  } finally {
    await reapDaemons(projectRoot);
  }
}

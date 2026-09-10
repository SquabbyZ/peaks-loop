/**
 * CLI-side daemon lifecycle: reuse, cold start, stop (slice S1, file 8).
 *
 * The CLI process is short-lived; the daemon is not. `ensureDaemon` is the
 * whole cold-start/warm path from tech-doc §1.4. The lock exists because Q10
 * lets the orchestrator and a sub-agent call `peaks web` concurrently in the
 * same session — without it, two daemons would race into the same session key
 * and Q8 ("one browser process per session") would be violated.
 */
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getErrorMessage } from 'peaks-loop-shared/result';

import { resolveNpxInvocation } from '../lint/npx-resolver.js';
import {
  acquireSpawnLock,
  isProcessAlive,
  readDaemonInfo,
  releaseSpawnLock,
  removeDaemonInfo
} from './daemon-registry.js';
import { PLAYWRIGHT_VERSION_PIN } from './playwright-loader.js';
import { webDir, webLogPath } from './web-artifact-paths.js';
import { WebDaemonClient } from './web-client.js';
import type { WebDaemonInfo } from './web-protocol.js';

const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 250;

export interface StopDaemonResult {
  readonly stopped: number;
  readonly pids: readonly number[];
}

/**
 * The installed peaks package root, derived from the RUNNING entry
 * (`process.argv[1]`). Both entries this module resolves — `<root>/cli/index.js`
 * and `<root>/services/web/daemon-entry.js` — sit exactly two levels below it,
 * so the root is unambiguous whichever of the two is running.
 */
function packageRoot(): string {
  const entry = process.argv[1];
  if (entry === undefined || entry.length === 0) {
    throw new Error('WEB_DAEMON_ENTRY_UNRESOLVED: process.argv[1] is empty');
  }
  return resolve(dirname(entry), '..', '..');
}

/**
 * Absolute path of the daemon entry, PATH-independent and identical in dev and
 * in the packaged bin. Called from a CLI process (via `spawnDaemon`), where
 * `argv[1]` is `<root>/cli/index.js`.
 */
export function daemonEntryPath(): string {
  return resolve(packageRoot(), 'services', 'web', 'daemon-entry.js');
}

/**
 * Absolute path of the peaks CLI entry.
 *
 * NOT `process.argv[1]`: the caller of `registerWithParent` is the DAEMON, whose
 * `argv[1]` is `services/web/daemon-entry.js`, so spawning `argv[1]` with CLI
 * arguments boots a second daemon-entry instead of registering anything (R8).
 * `<root>/cli/index.js` is the entry that actually owns
 * `sub-agent shutdown register`.
 */
export function cliEntryPath(): string {
  return resolve(packageRoot(), 'cli', 'index.js');
}

/**
 * Spawn the detached daemon. Both stdio pipes are redirected to
 * `web/daemon/daemon.log` — a daemon that inherited our stdout, or wrote to
 * `cwd`, would be the sneakiest way to break AC1 (tech-doc §7.2 rule 6).
 */
export function spawnDaemon(projectRoot: string, sessionId: string): { pid: number | undefined } {
  const entry = daemonEntryPath();
  const invocation = resolveNpxInvocation([
    '--yes',
    '--package',
    `playwright@${PLAYWRIGHT_VERSION_PIN}`,
    '--',
    'node',
    entry
  ]);
  const logPath = webLogPath(projectRoot, sessionId);
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, 'a');
  try {
    const child = spawn(invocation.command, [...invocation.args], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PEAKS_WEB_PROJECT_ROOT: projectRoot,
        PEAKS_WEB_SESSION_ID: sessionId,
        PEAKS_WEB_ARTIFACT_DIR: webDir(projectRoot, sessionId),
        PEAKS_DISPATCH_ID: process.env['PEAKS_DISPATCH_ID'] ?? 'current'
      },
      stdio: ['ignore', logFd, logFd],
      detached: true
    });
    child.unref();
    return { pid: child.pid };
  } finally {
    closeSync(logFd);
  }
}

/**
 * Return a healthy daemon for this `(projectRoot, sessionId)`, spawning one if
 * none answers. Reuse is by `/health`, not by the presence of `daemon.json`, so
 * a dead-or-wedged file left over from a SIGKILLed parent is replaced rather
 * than trusted (R3).
 *
 * Cold start is **double-checked locking**: `daemon.json` and `/health` are
 * re-read AFTER the lock is acquired, and the lock is held across the spawn AND
 * the readiness wait. Q10 lets the orchestrator and a sub-agent call
 * `peaks web` at the same moment, and `spawnDaemon` returns as soon as `spawn()`
 * does, so releasing the lock there left the whole ~20 s startup window
 * unprotected: both callers would see no daemon, take the lock in turn, and
 * launch a browser each — two processes per session in violation of Q8, one of
 * them unreachable by `peaks web stop`. With the lock held, the loser waits for
 * the winner's daemon instead of spawning its own.
 */
export async function ensureDaemon(projectRoot: string, sessionId: string): Promise<WebDaemonInfo> {
  const existing = await readHealthyDaemon(projectRoot, sessionId);
  if (existing !== null) {
    return existing;
  }

  const holdsLock = acquireSpawnLock(projectRoot, sessionId);
  try {
    // Double check under the lock: the winner may have started a daemon while
    // this caller was waiting to acquire it.
    const late = await readHealthyDaemon(projectRoot, sessionId);
    if (late !== null) {
      return late;
    }
    if (holdsLock) {
      removeDaemonInfo(projectRoot, sessionId);
      spawnDaemon(projectRoot, sessionId);
    }

    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const info = await readHealthyDaemon(projectRoot, sessionId);
      if (info !== null) {
        return info;
      }
      await delay(READY_POLL_MS);
    }
    throw new Error(
      `WEB_DAEMON_TIMEOUT: no healthy peaks web daemon for session ${sessionId} within ${READY_TIMEOUT_MS} ms`
    );
  } finally {
    if (holdsLock) {
      releaseSpawnLock(projectRoot, sessionId);
    }
  }
}

/** The recorded daemon, but only when it actually answers `/health`. */
async function readHealthyDaemon(
  projectRoot: string,
  sessionId: string
): Promise<WebDaemonInfo | null> {
  const info = readDaemonInfo(projectRoot, sessionId);
  if (info === null || !(await new WebDaemonClient(info).health())) {
    return null;
  }
  return info;
}

/**
 * Stop this session's daemon and clear its records. Scoped to
 * `(projectRoot, sessionId)` by construction — another worktree's daemon is
 * untouched (design §10.2).
 *
 * Ownership is proven before signalling (R6): on Windows `SIGTERM` is
 * `TerminateProcess`, so a planted `daemon.json` naming an unrelated pid would
 * otherwise make `peaks web stop` kill a process the caller does not own. The
 * endpoint must answer `/health` — which requires both the recorded port and
 * the recorded bearer token — for the pid to be signalled at all. Reaping a
 * daemon that is alive but not answering `/health` needs a stronger identity
 * check and is left to S2.
 */
export async function stopDaemon(projectRoot: string, sessionId: string): Promise<StopDaemonResult> {
  const info = readDaemonInfo(projectRoot, sessionId);
  const pids: number[] = [];
  if (info !== null && isProcessAlive(info.pid) && (await new WebDaemonClient(info).health())) {
    try {
      process.kill(info.pid, 'SIGTERM');
      pids.push(info.pid);
    } catch {
      // The daemon exited between the probe and the signal.
    }
  }
  removeDaemonInfo(projectRoot, sessionId);
  releaseSpawnLock(projectRoot, sessionId);
  return { stopped: pids.length, pids };
}

/**
 * Best-effort registration with the existing sub-agent shutdown registry
 * (Q7 / tech-doc §7.3).
 *
 * The entry point is `cliEntryPath()`, not `process.argv[1]`: this is called by
 * the daemon, whose `argv[1]` is the daemon entry, so using it spawned a second
 * daemon-entry with CLI arguments instead of registering anything (R8).
 *
 * Registration failing is non-fatal — the caller keeps running — but it must
 * not be silent: the daemon's stderr is `web/daemon/daemon.log`
 * (see `spawnDaemon`), so a spawn failure is written there. A detached child
 * whose `error` event has no listener would otherwise crash the daemon.
 */
export function registerWithParent(daemonPid: number, dispatchId: string): void {
  const report = (reason: string): void => {
    process.stderr.write(`peaks web: parent shutdown registration failed: ${reason}\n`);
  };
  let entry: string;
  try {
    entry = cliEntryPath();
  } catch (error) {
    report(getErrorMessage(error));
    return;
  }
  try {
    const child = spawn(
      process.execPath,
      [
        entry,
        'sub-agent',
        'shutdown',
        'register',
        '--pid',
        String(daemonPid),
        '--name',
        'peaks-web-daemon',
        '--dispatch-id',
        dispatchId
      ],
      { stdio: 'ignore', detached: true }
    );
    child.on('error', (error) => {
      report(getErrorMessage(error));
    });
    child.unref();
  } catch (error) {
    report(getErrorMessage(error));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

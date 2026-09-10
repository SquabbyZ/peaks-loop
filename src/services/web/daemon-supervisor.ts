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
import { closeSync, existsSync, mkdirSync, openSync, statSync } from 'node:fs';
import { delimiter, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getErrorMessage } from 'peaks-loop-shared/result';

import {
  acquireSpawnLock,
  DAEMON_DIR_MODE,
  isProcessAlive,
  readDaemonInfo,
  releaseSpawnLock,
  removeDaemonInfo
} from './daemon-registry.js';
import { resolvePlaywrightModule } from './playwright-loader.js';
import { webDir, webLogPath } from './web-artifact-paths.js';
import { WebDaemonClient } from './web-client.js';
import type { WebDaemonInfo } from './web-protocol.js';

const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 250;

/**
 * `daemon.log` is append-only and nothing reaps it, so a cold start truncates
 * it once it passes this. One boot line per start plus Playwright's own output
 * means the cap is reached in months of normal use and never in a test run —
 * the point is that the file has a bound at all.
 */
const MAX_LOG_BYTES = 1_048_576;

/** How long the daemon gets to answer the stop op / leave the process table. */
const STOP_REQUEST_TIMEOUT_MS = 5_000;
const STOP_EXIT_TIMEOUT_MS = 10_000;
const STOP_POLL_MS = 100;

export interface StopDaemonResult {
  /** Daemons confirmed GONE at return — not merely asked to stop. */
  readonly stopped: number;
  /** Every pid we asked to stop (gracefully or by signal). */
  readonly pids: readonly number[];
  /** Alive but not answering `/health`: recorded, deliberately not signalled. */
  readonly orphanedPids: readonly number[];
}

/**
 * This module's own directory — `<root>/src/services/web` or
 * `<root>/dist/services/web`.
 *
 * NOT `process.argv[1]`. The anchor has to be the running module, because
 * `argv[1]` is a different file in each of the three ways this code is entered:
 * `bin/peaks.js` for the packaged bin, `src/cli/index.ts` under `tsx`, and
 * `dist/cli/index.js` when the entry is invoked directly (R8's root cause).
 * The module's own location is the one fact that is always true.
 */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** `<root>/src` or `<root>/dist` — the tree this code was loaded from. */
const TREE_DIR = resolve(MODULE_DIR, '..', '..');

/** Compiled trees run `.js` under `node`; the source tree is TypeScript. */
const SOURCE_TREE = extname(fileURLToPath(import.meta.url)) === '.ts';

/**
 * Absolute path of the daemon entry. The NAME is fixed by the tree we are
 * running from, so the two supported modes each get a target that exists:
 * `dist/services/web/daemon-entry.js` after `pnpm build`, and
 * `src/services/web/daemon-entry.ts` for `pnpm dev` / the test suite.
 */
export function daemonEntryPath(): string {
  return join(MODULE_DIR, SOURCE_TREE ? 'daemon-entry.ts' : 'daemon-entry.js');
}

/**
 * Absolute path of the peaks CLI entry — the file that owns
 * `sub-agent shutdown register`.
 *
 * Explicit, never `process.argv[1]`: the caller of `registerWithParent` is the
 * DAEMON, whose `argv[1]` is the daemon entry, so spawning it with CLI
 * arguments boots a second daemon instead of registering anything (R8).
 */
export function cliEntryPath(): string {
  return join(TREE_DIR, 'cli', SOURCE_TREE ? 'index.ts' : 'index.js');
}

/**
 * Arguments that make `node` run `entry`.
 *
 * A `.ts` entry needs the TypeScript loader, and it is attached with
 * `--require preflight.cjs --import loader.mjs` — the exact flags `tsx` passes
 * to its own child — rather than by running the `tsx` CLI.
 *
 * That distinction is not cosmetic. `windowsHide` applies to the process we
 * spawn and to nothing it spawns in turn: launching `node tsx-cli.mjs entry.ts`
 * makes tsx spawn a GRANDCHILD, and the grandchild has no `windowsHide` of ours
 * — so on Windows every dev-mode `peaks web` cold start popped a console window
 * the user could not close. Invoking the loader directly keeps it one process,
 * so the flag we already pass covers everything.
 *
 * Exported so the race test's caller process is launched through the same
 * shape as the daemon: two copies of these flags would drift.
 *
 * Both callers prepend `process.execPath` themselves, so this returns ONLY the
 * interpreter flags and the entry.
 */
export function interpreterArgs(entry: string): string[] {
  if (!entry.endsWith('.ts')) {
    return [entry];
  }
  const tsxDist = resolve(TREE_DIR, '..', 'node_modules', 'tsx', 'dist');
  const preflight = join(tsxDist, 'preflight.cjs');
  const loader = join(tsxDist, 'loader.mjs');
  if (!existsSync(preflight) || !existsSync(loader)) {
    throw new Error(
      `WEB_DAEMON_TSX_MISSING: ${entry} is TypeScript but the tsx loader is not installed at ${tsxDist}. ` +
        'Run `pnpm install`, or `pnpm build` to use the compiled daemon entry.'
    );
  }
  return [
    '--require',
    preflight,
    ...(supportsImportFlag() ? ['--import'] : ['--loader']),
    pathToFileURL(loader).href,
    entry
  ];
}

/**
 * Whether this Node spells the ESM loader flag `--import`.
 *
 * It arrived in 20.6.0 (backported to 18.19.0); below that the spelling is
 * `--loader`, and passing `--import` is a bad option that kills the daemon at
 * startup — inside a `READY_TIMEOUT_MS = 20 s` wait whose only diagnosis is a
 * line in `daemon.log`. `package.json` declares `engines.node >= 20.0.0`, which
 * includes 20.0–20.5, so the flag cannot be unconditional. `tsx` gates its own
 * child the same way and this mirrors it.
 */
export function supportsImportFlag(nodeVersion: string = process.versions.node): boolean {
  const [major = 0, minor = 0] = nodeVersion.split('.').map(Number);
  return major >= 21 || (major === 20 && minor >= 6) || (major === 18 && minor >= 19);
}

/**
 * The exact command `spawnDaemon` hands to `spawn`, resolved without launching
 * anything so a test can assert its shape.
 *
 * `process.execPath` directly — never `npx`, and therefore never the
 * `cmd.exe /d /s /c node …` that npm's own `run-script` puts between us and the
 * daemon (`@npmcli/run-script/lib/make-spawn-args.js` spawns with `shell: true`
 * and no `windowsHide`). That layer was three processes per cold start instead
 * of one, it re-parsed our `--require` / `--import` paths through a command
 * string, it cost 2.8–7.1 s of the ~3 s cold start, and the two intermediate
 * processes ignored `windowsHide` — the console-window incident, one layer down.
 */
export function daemonSpawnCommand(): { command: string; args: string[] } {
  return { command: process.execPath, args: interpreterArgs(daemonEntryPath()) };
}

/**
 * Spawn the detached daemon. Both stdio pipes are redirected to
 * `web/daemon/daemon.log` — a daemon that inherited our stdout, or wrote to
 * `cwd`, would be the sneakiest way to break AC1 (tech-doc §7.2 rule 6).
 */
export function spawnDaemon(projectRoot: string, sessionId: string): { pid: number | undefined } {
  const logPath = webLogPath(projectRoot, sessionId);
  mkdirSync(dirname(logPath), { recursive: true, mode: DAEMON_DIR_MODE });
  truncateLogIfOversized(logPath);
  const logFd = openSync(logPath, 'a');
  try {
    const invocation = daemonSpawnCommand();
    const child = spawn(invocation.command, invocation.args, {
      cwd: projectRoot,
      env: daemonEnv(projectRoot, sessionId),
      stdio: ['ignore', logFd, logFd],
      detached: true,
      // `detached` alone would give this daemon its own VISIBLE console window
      // on Windows — one the user cannot close, per spawn, for a process whose
      // whole purpose is to be invisible.
      windowsHide: true
    });
    // A `ChildProcess` that emits `error` with no listener is an uncaught
    // exception: the CLI would die with a raw ENOENT stack and exit 7 instead of
    // letting `ensureDaemon` report its own `WEB_DAEMON_TIMEOUT` envelope.
    child.on('error', (error) => {
      process.stderr.write(`peaks web: daemon spawn failed: ${getErrorMessage(error)}\n`);
    });
    child.unref();
    return { pid: child.pid };
  } finally {
    closeSync(logFd);
  }
}

/**
 * The daemon's environment.
 *
 * `npx` used to be what made `playwright` resolvable inside the daemon; the
 * daemon is now a direct child, so this process resolves the pinned package
 * itself and puts its `node_modules/.bin` first on the child's `PATH`, which is
 * exactly what `playwright-loader.ts`'s PATH scan looks for. Unresolvable here
 * means the daemon answers its first browser op with `PLAYWRIGHT_NOT_RESOLVABLE`
 * rather than silently reaching for a shell.
 */
function daemonEnv(projectRoot: string, sessionId: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PEAKS_WEB_PROJECT_ROOT: projectRoot,
    PEAKS_WEB_SESSION_ID: sessionId,
    PEAKS_WEB_ARTIFACT_DIR: webDir(projectRoot, sessionId),
    PEAKS_DISPATCH_ID: process.env['PEAKS_DISPATCH_ID'] ?? 'current'
  };
  const playwrightBin = playwrightBinDir();
  if (playwrightBin !== null) {
    // Windows spells it `Path`; two case-variant keys make `CreateProcess`
    // resolve the search path non-deterministically, so the old key goes.
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === 'PATH') {
        delete env[key];
      }
    }
    env['PATH'] = `${playwrightBin}${delimiter}${process.env['PATH'] ?? ''}`;
  }
  return env;
}

/** `<…>/node_modules/.bin` for the resolved Playwright, or `null` when absent. */
function playwrightBinDir(): string | null {
  try {
    return join(dirname(dirname(resolvePlaywrightModule())), '.bin');
  } catch {
    return null;
  }
}

/** Truncate the daemon's log at cold start once it has outgrown the cap. */
function truncateLogIfOversized(logPath: string): void {
  try {
    if (statSync(logPath).size > MAX_LOG_BYTES) {
      closeSync(openSync(logPath, 'w'));
    }
  } catch {
    // No log yet.
  }
}

/**
 * Return a healthy daemon for this `(projectRoot, sessionId)`, spawning one only
 * when the session has none. A record whose pid is GONE is replaced (a stale
 * file from a SIGKILLed parent, R3); a record whose pid is ALIVE is never
 * replaced, even when `/health` does not answer — see `DaemonProbe`.
 *
 * Cold start is **double-checked locking**: the record, its pid liveness and
 * `/health` are re-probed AFTER the lock is acquired, with the same oracle the
 * pre-lock check used, and the lock is held across the spawn AND the readiness
 * wait. Q10 lets the orchestrator and a sub-agent call
 * `peaks web` at the same moment, and `spawnDaemon` returns as soon as `spawn()`
 * does, so releasing the lock there left the whole ~20 s startup window
 * unprotected: both callers would see no daemon, take the lock in turn, and
 * launch a browser each — two processes per session in violation of Q8, one of
 * them unreachable by `peaks web stop`. With the lock held, the loser waits for
 * the winner's daemon instead of spawning its own.
 */
export async function ensureDaemon(projectRoot: string, sessionId: string): Promise<WebDaemonInfo> {
  const existing = await probeDaemon(projectRoot, sessionId);
  if (existing.state === 'healthy') {
    return existing.info;
  }

  const holdsLock = acquireSpawnLock(projectRoot, sessionId);
  try {
    // Double check under the lock: the winner may have started a daemon while
    // this caller was waiting to acquire it.
    const late = await probeDaemon(projectRoot, sessionId);
    if (late.state === 'healthy') {
      return late.info;
    }
    // ONLY an absent daemon may be replaced. `unreachable` is a LIVE pid whose
    // `/health` missed a 500 ms budget — a daemon blocked in `spawnSync`'s
    // chromium install or in a synchronous `snap` prune, not a dead one.
    // Deleting its record would make it unreachable by every verb, and spawning
    // here would put two daemons (and two browsers) behind one session key, a
    // direct Q8 violation. So this branch waits for the incumbent instead.
    if (late.state === 'absent' && holdsLock) {
      removeDaemonInfo(projectRoot, sessionId);
      spawnDaemon(projectRoot, sessionId);
    }

    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const info = await probeDaemon(projectRoot, sessionId);
      if (info.state === 'healthy') {
        return info.info;
      }
      await delay(READY_POLL_MS);
    }
    throw new Error(
      `WEB_DAEMON_TIMEOUT: no healthy peaks web daemon for session ${sessionId} within ${READY_TIMEOUT_MS} ms` +
        (late.state === 'unreachable'
          ? ` (pid ${String(late.info.pid)} is alive but not answering /health)`
          : '')
    );
  } finally {
    if (holdsLock) {
      releaseSpawnLock(projectRoot, sessionId);
    }
  }
}

/**
 * What this session currently holds. Three states, because "no answer" and "no
 * process" are not the same fact and only one of them is safe to replace:
 *
 *   - `absent`      — no record, or the recorded pid is gone. Replaceable.
 *   - `healthy`     — pid alive and `/health` answers. Reusable.
 *   - `unreachable` — pid ALIVE, `/health` did not answer inside
 *     `HEALTH_TIMEOUT_MS`. NOT replaceable and NOT de-recordable: the process is
 *     still running, and the record is the only handle on it.
 *
 * Process liveness is checked FIRST and unconditionally: a `/health` miss alone
 * is evidence of slowness, not of death, and treating it as death is what let a
 * live daemon be de-recorded and duplicated.
 */
type DaemonProbe =
  | { readonly state: 'absent' }
  | { readonly state: 'healthy'; readonly info: WebDaemonInfo }
  | { readonly state: 'unreachable'; readonly info: WebDaemonInfo };

async function probeDaemon(projectRoot: string, sessionId: string): Promise<DaemonProbe> {
  const info = readDaemonInfo(projectRoot, sessionId);
  if (info === null || !isProcessAlive(info.pid)) {
    return { state: 'absent' };
  }
  if (await new WebDaemonClient(info).health()) {
    return { state: 'healthy', info };
  }
  return { state: 'unreachable', info };
}

/**
 * Stop this session's daemon and clear its records. Scoped to
 * `(projectRoot, sessionId)` by construction — another worktree's daemon is
 * untouched (design §10.2).
 *
 * Ownership is proven before asking the process to stop (R6/R7): a planted
 * `daemon.json` naming an unrelated pid must not make `peaks web stop` kill a
 * process the caller does not own, and on Windows `SIGTERM` is
 * `TerminateProcess` with no chance to say "no". `/health` is NOT evidence —
 * it is answered before the auth check, so any unrelated local listener that
 * returns 2xx for a `GET` satisfies it. The proof is an AUTHENTICATED `/op`
 * whose reply reports the very identity the record claims (`isOwnDaemon`): a
 * recycled pid pointing at somebody else's dev server cannot produce it.
 *
 * The graceful path comes FIRST, and it is not a nicety: on Windows a signal
 * cannot be handled, so signalling would terminate the daemon without running
 * its teardown, leaving its chromium process behind — the exact false pass
 * AC6 is written against. `/op {op:'stop'}` lets the daemon close every context,
 * persist storage state, close the browser and exit on its own terms; the
 * signal is only the fallback for a daemon that accepts the request and then
 * fails to leave.
 *
 * An instance that is alive but cannot be proven ours is **not** signalled and
 * **not** de-recorded. Its record is the only handle on a running process:
 * clearing it would leave the daemon and its chromium detached with no verb
 * able to reach them, and would let the next cold start spawn a second daemon
 * beside a live one (Q8). It is reported in `orphanedPids`, and a daemon that
 * survives its own stop request stays recorded too, so `status` and a second
 * `stop` still see it.
 */
export async function stopDaemon(projectRoot: string, sessionId: string): Promise<StopDaemonResult> {
  const info = readDaemonInfo(projectRoot, sessionId);
  const pids: number[] = [];
  const orphanedPids: number[] = [];
  if (info !== null && isProcessAlive(info.pid)) {
    const client = new WebDaemonClient(info);
    if (await isOwnDaemon(client, info)) {
      await requestStop(client);
      pids.push(info.pid);
      if (!(await waitForExit(info.pid, STOP_EXIT_TIMEOUT_MS))) {
        try {
          process.kill(info.pid, 'SIGTERM');
        } catch {
          // It exited between the probe and the signal.
        }
        await waitForExit(info.pid, STOP_EXIT_TIMEOUT_MS);
      }
    } else {
      orphanedPids.push(info.pid);
    }
  }
  // The record survives whenever something live is still behind it.
  if (info === null || !isProcessAlive(info.pid)) {
    removeDaemonInfo(projectRoot, sessionId);
    releaseSpawnLock(projectRoot, sessionId);
  }
  return { stopped: pids.filter((pid) => !isProcessAlive(pid)).length, pids, orphanedPids };
}

/**
 * True only when an authenticated daemon answers with the identity this record
 * claims. `/health` cannot be used for this: it is unauthenticated by contract
 * and answered before the auth check, so "something answered 2xx" is satisfied
 * by any local HTTP server — which is exactly how a stale record turns a
 * recycled pid into a `TerminateProcess`.
 */
async function isOwnDaemon(client: WebDaemonClient, info: WebDaemonInfo): Promise<boolean> {
  try {
    const response = await client.call<{ pid?: unknown; sessionId?: unknown }>(
      'whoami',
      {},
      STOP_REQUEST_TIMEOUT_MS
    );
    const data = response.data;
    return (
      response.ok &&
      typeof data === 'object' &&
      data !== null &&
      data.pid === info.pid &&
      data.sessionId === info.sessionId
    );
  } catch {
    return false;
  }
}

/** Ask the daemon to shut itself down. A refusal or a timeout means "try the signal". */
async function requestStop(client: WebDaemonClient): Promise<void> {
  try {
    await client.call('stop', {}, STOP_REQUEST_TIMEOUT_MS);
  } catch {
    // Transport-level failure only: the daemon is gone, or its shutdown raced
    // the response. Either way the exit wait decides what actually happened.
  }
}

/** True once `pid` has left the process table, false at the deadline. */
async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await delay(STOP_POLL_MS);
  }
  return !isProcessAlive(pid);
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
        ...interpreterArgs(entry),
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
      { stdio: 'ignore', detached: true, windowsHide: true }
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

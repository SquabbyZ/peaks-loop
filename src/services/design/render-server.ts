/**
 * Opt-in `--start` lifecycle for a project's own dev server.
 *
 * `peaks design check --start` runs the command the user recorded in
 * `design/engine.json` (`render.startCommand`, relative to `render.cwd`), waits
 * for the render URL to answer, and hands the caller a handle whose `stop()`
 * reaps the whole process tree — on success, on timeout, and on an early exit.
 * An orphaned `vite dev` holding a port is the failure this module exists to
 * prevent (plan Review Focus: "Orphan server").
 *
 * The command is the user's own recorded string, so `shell: true` is
 * intentional: it is the documented shape of an npm-script-style start command.
 * It is never assembled from external input.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

import { probeRenderUrl } from './render-url.js';

/** Default budget for a dev server's first byte. */
const DEFAULT_START_TIMEOUT_MS = 30_000;

/** Gap between reachability probes. */
const POLL_INTERVAL_MS = 100;

/** Per-attempt probe budget while polling, so one slow answer cannot eat the whole deadline. */
const PROBE_ATTEMPT_TIMEOUT_MS = 1_000;

/** How long `stop()` waits for the tree to be gone before giving up. */
const EXIT_WAIT_MS = 5_000;

/** POSIX escalation budgets: SIGTERM, then SIGKILL. */
const POSIX_TERM_WAIT_MS = 2_000;
const POSIX_KILL_WAIT_MS = 2_000;

export type RenderServerHandle = {
  url: string;
  stop: () => Promise<void>;
};

export type StartRenderServerInput = {
  /** Repository root; a relative `cwd` is resolved against it. */
  projectRoot: string;
  /** `render.cwd` from `design/engine.json`, relative or absolute. */
  cwd: string;
  /** `render.startCommand` — a shell command line. */
  command: string;
  /** The URL that must become reachable. */
  url: string;
  timeoutMs?: number;
};

export type StartRenderServerCode = 'DESIGN_RENDER_UNREACHABLE' | 'DESIGN_START_COMMAND_EXITED';

export type StartRenderServerResult =
  | { ok: true; server: RenderServerHandle }
  | { ok: false; code: StartRenderServerCode; message: string };

function sleep(ms: number): Promise<void> {
  return new Promise((settle) => {
    setTimeout(settle, ms);
  });
}

/**
 * The program word of a command line, so failure text can name the command
 * without echoing arguments: a start command may inline a token or a secret.
 */
function commandProgram(command: string): string {
  const word = /^\s*("[^"]*"|'[^']*'|\S+)/.exec(command)?.[1];
  if (word === undefined) return '<empty command>';
  return word.replace(/^["']|["']$/g, '');
}

function taskkill(pid: number): Promise<boolean> {
  return new Promise<boolean>((settle) => {
    execFile('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true }, (error) => {
      settle(error === null);
    });
  });
}

/** Signal a single pid; false when it is already gone. */
function signalPid(pid: number): boolean {
  try {
    process.kill(pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

/** Signal the POSIX process group; false when the group is already gone. */
function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

/** Resolve true on the child's exit, false when the wait budget elapses. */
function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise<boolean>((settle) => {
    const finish = (exited: boolean): void => {
      clearTimeout(timer);
      child.off('exit', onExit);
      settle(exited);
    };
    const onExit = (): void => {
      finish(true);
    };
    const timer = setTimeout(() => {
      finish(false);
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

/**
 * Kill the whole tree and wait for it. Windows uses `taskkill /T /F` (the shell
 * is the tree root); POSIX signals the detached child's process group, which is
 * why the spawn sets `detached: true` there.
 */
async function killTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    if (!(await taskkill(pid))) {
      // The pid may already be gone; the direct signal is the fallback.
      signalPid(pid);
    }
    await waitForExit(child, EXIT_WAIT_MS);
    return;
  }
  if (signalGroup(pid, 'SIGTERM')) {
    await waitForExit(child, POSIX_TERM_WAIT_MS);
  }
  // The shell exiting on SIGTERM does not prove a grandchild followed it, so the
  // group is always SIGKILLed once the grace has passed; a missing group is gone.
  if (signalGroup(pid, 'SIGKILL')) {
    await waitForExit(child, POSIX_KILL_WAIT_MS);
  }
}

/** Track the child's exit, including a spawn error that never emits `exit`. */
function watchChild(child: ChildProcess): { exited: () => boolean; status: () => string } {
  let exited = false;
  let spawnError: string | null = null;
  child.once('exit', () => {
    exited = true;
  });
  child.on('error', (error: Error) => {
    spawnError = error.message;
    exited = true;
  });
  return {
    exited: () => exited,
    status: () => {
      if (spawnError !== null) return spawnError;
      if (child.signalCode !== null) return `signal ${child.signalCode}`;
      if (child.exitCode !== null) return `exit code ${child.exitCode}`;
      return 'an unknown status';
    }
  };
}

/** A `stop()` that kills the tree at most once, however often it is called. */
function lazyStop(child: ChildProcess): () => Promise<void> {
  let stopped: Promise<void> | null = null;
  return () => (stopped ??= killTree(child));
}

type Readiness = { ready: true } | { ready: false; reason: 'exited' | 'timeout' };

/** Poll the URL until it answers, the child exits, or the deadline passes. */
async function waitForReady(
  url: string,
  exited: () => boolean,
  timeoutMs: number
): Promise<Readiness> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited()) return { ready: false, reason: 'exited' };
    const remaining = Math.max(1, deadline - Date.now());
    if (await probeRenderUrl(url, Math.min(PROBE_ATTEMPT_TIMEOUT_MS, remaining))) {
      return { ready: true };
    }
    if (exited()) return { ready: false, reason: 'exited' };
    await sleep(Math.min(POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
  }
  return { ready: false, reason: 'timeout' };
}

/**
 * Spawn the recorded start command and poll until `url` answers. On timeout or
 * an early exit the tree is killed before returning, so a failed start never
 * leaves a listener behind.
 */
export async function startRenderServer(
  input: StartRenderServerInput
): Promise<StartRenderServerResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const child = spawn(input.command, {
    cwd: resolve(input.projectRoot, input.cwd),
    shell: true,
    detached: process.platform !== 'win32',
    windowsHide: true,
    // A dev server writes far more than a pipe buffer; an unread pipe blocks it.
    stdio: 'ignore'
  });
  const state = watchChild(child);
  const stop = lazyStop(child);

  const readiness = await waitForReady(input.url, state.exited, timeoutMs);
  if (readiness.ready) return { ok: true, server: { url: input.url, stop } };

  await stop();
  if (readiness.reason === 'exited') {
    return {
      ok: false,
      code: 'DESIGN_START_COMMAND_EXITED',
      message:
        `Start command exited before ${input.url} became reachable (${state.status()}): ` +
        `${commandProgram(input.command)} (arguments redacted)`
    };
  }
  return {
    ok: false,
    code: 'DESIGN_RENDER_UNREACHABLE',
    message:
      `Start command did not make ${input.url} reachable within ${timeoutMs}ms: ` +
      `${commandProgram(input.command)} (arguments redacted)`
  };
}

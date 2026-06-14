/**
 * Slice 2026-06-14-cc-connect-weixin (slice 2) — start / stop /
 * restart / status service. Owns the daemon lifecycle.
 *
 * `start` is idempotent: if a live process is already recorded
 * in the PID file, the call short-circuits with `ok: true` and
 * a friendly hint (the user wanted a one-line peak-solo-style
 * experience).
 *
 * `stop` sends SIGTERM, waits up to 5s, then SIGKILL. The PID
 * file is removed at the end regardless of outcome.
 *
 * `restart` = stop + start, but tolerates a stop failure when
 * the process was already gone.
 *
 * `status` returns a JSON-friendly snapshot covering
 * `running|weixin-paired|pid|binary-path` (per AC4/AC5).
 */
import { probeCcConnect } from './cc-connect-resolver.js';
import { readBinaryPathCache } from './binary-cache.js';
import { readCcConnectState } from './state-parser.js';
import {
  COMPANION_KILL_TIMEOUT_MS,
  isPidAlive,
  spawnCompanion,
  closeLogFd,
  readProcessRecord,
  writeProcessRecord,
  clearProcessRecord,
  companionPidFile,
  companionLogFile
} from './process-manager.js';
import { DEFAULT_COMPANION_CHANNEL, type CompanionChannel } from './companion-types.js';

export type StartResult = {
  started: boolean;
  alreadyRunning: boolean;
  pid: number | null;
  binaryPath: string | null;
  argv: readonly string[];
  logFile: string;
  pidFile: string;
  error: string | null;
  nextActions: string[];
};

export type StopResult = {
  stopped: boolean;
  wasRunning: boolean;
  pid: number | null;
  signal: 'SIGTERM' | 'SIGKILL' | null;
  durationMs: number;
  error: string | null;
};

export type RestartResult = {
  restarted: boolean;
  stop: StopResult;
  start: StartResult;
  error: string | null;
};

export type StatusSnapshot = {
  running: boolean;
  channel: CompanionChannel;
  pid: number | null;
  binaryPath: string | null;
  startedAt: string | null;
  pidFile: string;
  logFile: string;
  stateFile: string;
  pairing: ReturnType<typeof readCcConnectState>;
  cache: ReturnType<typeof readBinaryPathCache>;
  version: string | null;
  error: string | null;
};

export type StartOptions = {
  /** Inject clock for tests. */
  now?: () => Date;
  /** Inject a custom spawn function (default: spawnCompanion detached). */
  spawn?: typeof spawnCompanion;
  /** Path env used to resolve the binary (defaults to process.env.PATH). */
  pathEnv?: string;
  /**
   * Slice 2026-06-14-cc-connect-weixin (slice 2): cwd used to scope
   * the node_modules lookup. Defaults to process.cwd(). Tests use
   * this to point resolution at a tmp dir without touching the
   * peaks-cli install's own node_modules.
   */
  cwd?: string;
  /** Force-start even if a previous process record exists (kill+relaunch). */
  force?: boolean;
  /** Override the home dir (test seam). */
  home?: string;
};

const START_DEFAULT_ARGV: readonly string[] = ['--daemon'];

export async function startCcConnect(options: StartOptions = {}): Promise<StartResult> {
  const pidFile = companionPidFile(options.home);
  const logFile = companionLogFile(options.home);
  const existing = readProcessRecord(options.home);
  if (existing !== null && isPidAlive(existing.pid) && options.force !== true) {
    return {
      started: false,
      alreadyRunning: true,
      pid: existing.pid,
      binaryPath: existing.binaryPath,
      argv: existing.argv,
      logFile,
      pidFile,
      error: null,
      nextActions: [`peaks companion is already running (pid ${existing.pid}); use \`peaks companion restart\` to relaunch`]
    };
  }
  if (existing !== null) {
    clearProcessRecord(options.home);
  }
  const probe = await probeCcConnect({
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.pathEnv !== undefined ? { pathEnv: options.pathEnv } : {})
  });
  if (!probe.ok || probe.binaryPath === null) {
    return {
      started: false,
      alreadyRunning: false,
      pid: null,
      binaryPath: null,
      argv: [],
      logFile,
      pidFile,
      error: probe.error ?? 'cc-connect binary not on PATH',
      nextActions: ['run `peaks companion install` to install cc-connect, then retry']
    };
  }
  const spawnFn = options.spawn ?? spawnCompanion;
  const now = options.now ?? (() => new Date());
  const argv: readonly string[] = [...START_DEFAULT_ARGV];
  const { child, logFd } = spawnFn(probe.binaryPath, argv);
  closeLogFd(logFd);
  if (typeof child.pid !== 'number' || child.pid <= 0) {
    return {
      started: false,
      alreadyRunning: false,
      pid: null,
      binaryPath: probe.binaryPath,
      argv,
      logFile,
      pidFile,
      error: 'spawn returned no pid (binary failed to launch?)',
      nextActions: [`inspect the log: \`tail -n 50 ${logFile}\``]
    };
  }
  const recordWrite = writeProcessRecord({
    pid: child.pid,
    binaryPath: probe.binaryPath,
    channel: DEFAULT_COMPANION_CHANNEL,
    startedAt: now().toISOString(),
    argv
  }, options.home);
  return {
    started: true,
    alreadyRunning: false,
    pid: child.pid,
    binaryPath: probe.binaryPath,
    argv,
    logFile,
    pidFile,
    error: recordWrite.ok ? null : recordWrite.error,
    nextActions: [
      `next: run \`peaks companion status\` to verify, or \`peaks companion setup\` to render the iLink QR`
    ]
  };
}

export type StopOptions = {
  /** Override the kill timeout (default 5s). */
  timeoutMs?: number;
  /** Inject a clock for tests. */
  now?: () => number;
  /** When true, skip the SIGKILL fallback (test friendly). */
  noEscalate?: boolean;
  /** Inject a "is alive" probe (default: isPidAlive). */
  alive?: (pid: number) => boolean;
  /** Override the home dir (test seam). */
  home?: string;
};

export function stopCcConnect(options: StopOptions = {}): Promise<StopResult> {
  const timeoutMs = options.timeoutMs ?? COMPANION_KILL_TIMEOUT_MS;
  const alive = options.alive ?? isPidAlive;
  const now = options.now ?? (() => Date.now());
  const record = readProcessRecord(options.home);
  if (record === null || !alive(record.pid)) {
    if (record !== null) clearProcessRecord(options.home);
    return Promise.resolve({
      stopped: true,
      wasRunning: false,
      pid: record?.pid ?? null,
      signal: null,
      durationMs: 0,
      error: null
    });
  }
  return new Promise((resolve) => {
    const started = now();
    let signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM';
    try {
      process.kill(record.pid, 'SIGTERM');
    } catch (err) {
      clearProcessRecord(options.home);
      resolve({
        stopped: false,
        wasRunning: true,
        pid: record.pid,
        signal: null,
        durationMs: now() - started,
        error: err instanceof Error ? err.message : String(err)
      });
      return;
    }
    const deadline = started + timeoutMs;
    const tick = (): void => {
      if (!alive(record.pid)) {
        clearProcessRecord(options.home);
        resolve({
          stopped: true,
          wasRunning: true,
          pid: record.pid,
          signal,
          durationMs: now() - started,
          error: null
        });
        return;
      }
      if (now() >= deadline) {
        if (options.noEscalate === true) {
          resolve({
            stopped: false,
            wasRunning: true,
            pid: record.pid,
            signal: 'SIGTERM',
            durationMs: now() - started,
            error: 'timed out waiting for process to exit (--no-escalate)'
          });
          return;
        }
        signal = 'SIGKILL';
        try {
          process.kill(record.pid, 'SIGKILL');
        } catch (err) {
          resolve({
            stopped: false,
            wasRunning: true,
            pid: record.pid,
            signal: 'SIGKILL',
            durationMs: now() - started,
            error: err instanceof Error ? err.message : String(err)
          });
          return;
        }
        setImmediate(() => {
          clearProcessRecord(options.home);
          resolve({
            stopped: true,
            wasRunning: true,
            pid: record.pid,
            signal: 'SIGKILL',
            durationMs: now() - started,
            error: null
          });
        });
        return;
      }
      setTimeout(tick, 100);
    };
    setTimeout(tick, 50);
  });
}

export async function restartCcConnect(options: StartOptions & StopOptions = {}): Promise<RestartResult> {
  const stop = await stopCcConnect({
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.noEscalate === true ? { noEscalate: true } : {}),
    ...(options.alive !== undefined ? { alive: options.alive } : {}),
    ...(options.home !== undefined ? { home: options.home } : {})
  });
  clearProcessRecord(options.home);
  const start = await startCcConnect({
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.spawn !== undefined ? { spawn: options.spawn } : {}),
    ...(options.pathEnv !== undefined ? { pathEnv: options.pathEnv } : {}),
    ...(options.home !== undefined ? { home: options.home } : {}),
    force: true
  });
  return {
    restarted: start.started,
    stop,
    start,
    error: start.error ?? stop.error
  };
}

export type StatusOptions = {
  pathEnv?: string;
  /** Inject a custom probe (default: probeCcConnect). */
  probe?: typeof probeCcConnect;
  /**
   * Slice 2026-06-14-cc-connect-weixin (slice 2): cwd used to scope
   * the node_modules lookup (defaults to process.cwd()).
   */
  cwd?: string;
  /** Override the home dir (test seam). */
  home?: string;
};

export async function statusCcConnect(options: StatusOptions = {}): Promise<StatusSnapshot> {
  const record = readProcessRecord(options.home);
  const alive = record !== null && isPidAlive(record.pid);
  const probeFn = options.probe ?? probeCcConnect;
  const probe = await probeFn({
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.pathEnv !== undefined ? { pathEnv: options.pathEnv } : {}),
    skipSpawn: true
  });
  const cache = readBinaryPathCache(options.home);
  const state = readCcConnectState();
  return {
    running: alive,
    channel: DEFAULT_COMPANION_CHANNEL,
    pid: alive ? record?.pid ?? null : null,
    binaryPath: record?.binaryPath ?? probe.binaryPath ?? cache?.binaryPath ?? null,
    startedAt: alive ? record?.startedAt ?? null : null,
    pidFile: companionPidFile(options.home),
    logFile: companionLogFile(options.home),
    stateFile: state.statePath,
    pairing: state,
    cache,
    version: cache?.version ?? null,
    error: null
  };
}

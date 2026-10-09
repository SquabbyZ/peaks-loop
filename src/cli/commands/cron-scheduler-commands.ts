/**
 * Companion CLI to Part 14 (peaks cron init/list/run). The
 * scheduler is a long-running background daemon that wakes up
 * once per minute, reads `.peaks/cron/schedule.json`, and runs
 * any due tasks via detached execSync (so a misbehaving task
 * cannot block the scheduler). Best-effort persistence via
 * `.peaks/cron/scheduler.pid` (advisory — operators can `kill
 * $(cat scheduler.pid)` if a stale entry lingers).
 *
 * Why a separate `peaks-cron-scheduler` CLI (not a peaks
 * subcommand) — long-running daemons that are spawned from a
 * `peaks ...` invocation confuse a future "which peaks version
 * is running" check. A dedicated binary name keeps the
 * scheduler's startup visible to operators.
 *
 * Windows: the scheduler writes its pid to a file. To run as
 * a real Windows service, the operator wires NSSM (or
 * node-windows) to call `peaks-cron-scheduler start` on
 * service start. Future slice: ship an NSSM install recipe
 * in the operator docs.
 *
 * POSIX: same pid-file pattern; an init.d / systemd unit
 * file would call `peaks-cron-scheduler start` and rely on
 * the scheduler to write its own pid. Or just run from
 * `nohup peaks-cron-scheduler start &` if you don't need
 * restart-on-crash.
 *
 * This file owns `registerCronSchedulerCommand`, `runSchedulerLoop` and the
 * standalone entry shim the `bin/peaks-cron-scheduler.js` script loads; the
 * four verb bodies live beside it, over the pid-file vocabulary in
 * `cron-scheduler-shared.ts`.
 */

import type { Command } from 'commander';
import { getErrorMessage } from 'peaks-loop-shared/result';

import { type ProgramIO } from '../cli-helpers.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { listDueTasks, runTask } from './cron-commands.js';
import { persistLastRunAt } from './cron-scheduler-persist.js';
import { SCHEDULER_TICK_MS } from './cron-scheduler-shared.js';
import { registerCronSchedulerStartCommand } from './cron-scheduler-start-command.js';
import { registerCronSchedulerStopCommand } from './cron-scheduler-stop-command.js';
import { registerCronSchedulerStatusCommand } from './cron-scheduler-status-command.js';
import { registerCronSchedulerRunOnceCommand } from './cron-scheduler-run-once-command.js';

export function registerCronSchedulerCommand(program: Command, io: ProgramIO): void {
  const cmd = program
    .command('cron-scheduler')
    .description('Long-running background scheduler for peaks cron tasks (Part 15).');

  registerCronSchedulerStartCommand(cmd, io);
  registerCronSchedulerStopCommand(cmd, io);
  registerCronSchedulerStatusCommand(cmd, io);
  registerCronSchedulerRunOnceCommand(cmd, io);
}

/** The loop's interval handle, cleared when the shutdown signal arrives. */
function waitForShutdown(signal: AbortSignal | undefined, handle: NodeJS.Timeout): Promise<void> {
  // Wait for the abort signal (POSIX) or the platform equivalent. We don't use
  // Node's process.on('SIGTERM') for portability — the parent process kills us
  // via `process.kill(pid, 'SIGTERM')` and the event loop exits naturally if
  // the interval is the only thing keeping the loop alive.
  return new Promise<void>((resolveShutdown) => {
    const onAbort = (): void => {
      clearInterval(handle);
      resolveShutdown();
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    } else {
      // POSIX: SIGTERM. Windows: kill the process directly.
      process.on('SIGTERM', onAbort);
      process.on('SIGINT', onAbort);
    }
  });
}

/**
 * Standalone scheduler entry point (the process the CLI spawns).
 * Runs a setInterval tick + reads schedule + runs due tasks.
 * Exits cleanly on SIGTERM.
 *
 * Exported as `runSchedulerLoop` so the dedicated
 * `peaks-cron-scheduler.js` entry shim can call it; the
 * command-side `registerCronSchedulerCommand` only uses
 * start/stop/status, not the loop.
 */
export async function runSchedulerLoop(args: {
  projectRoot: string;
  tickMs?: number;
  signal?: AbortSignal;
}): Promise<void> {
  const tickMs = args.tickMs ?? SCHEDULER_TICK_MS;
  // Idempotency: refuse to start a second loop in the same
  // process (the start CLI is expected to be a fresh spawn).
  if ((process as { __peaksCronScheduler?: boolean }).__peaksCronScheduler) {
    throw new Error('scheduler loop already running in this process');
  }
  (process as { __peaksCronScheduler?: boolean }).__peaksCronScheduler = true;

  const tick = (): void => {
    try {
      const due = listDueTasks(args.projectRoot);
      const records = due.map((task) => runTask(args.projectRoot, task));
      // backlog §2.24: this write-back is what makes a fired task stop being
      // due. Without it `lastRunAt` stays null, `listDueTasks` keeps the entry
      // due, and a 24 h task re-fires on every 60,000 ms tick (measured: 6 fires
      // across 6 ticks, 1 after the write). Killed runs are deliberately NOT
      // stamped — here, in `run-once`, and since repair cycle 1 in `peaks
      // cron run` too; the rule and its per-platform costs are in
      // `cron-scheduler-persist.ts`.
      persistLastRunAt(args.projectRoot, records);
    } catch (err) {
      process.stderr.write(`[cron-scheduler] tick error: ${getErrorMessage(err)}\n`);
    }
  };

  // First tick on entry (don't wait the full interval
  // for the first run after a start).
  tick();
  const handle = setInterval(tick, tickMs);
  await waitForShutdown(args.signal, handle);
  process.exit(0);
}

// Standalone entry shim. When this file is run directly via
// `node peaks-cron-scheduler.js`, the loop starts; when it is
// imported (e.g. by the CLI), the export is used but the
// loop is not started.
if (process.env.PEAKS_CRON_SCHEDULER_DAEMON === '1') {
  // Spawned by `peaks cron-scheduler start` as the long-running
  // detached child. Run the loop until SIGTERM. Gated on the
  // env var (not argv[1]) because on Windows a forked node
  // process inherits the parent's argv[1] (which is bin/peaks.js).
  const projectRoot = (() => {
    const idx = process.argv.indexOf('--project');
    return idx >= 0
      ? (process.argv[idx + 1] as string)
      : (findProjectRoot(process.cwd()) ?? process.cwd());
  })();
  runSchedulerLoop({ projectRoot }).catch((err) => {
    process.stderr.write(`[cron-scheduler] fatal: ${getErrorMessage(err)}\n`);
    process.exit(1);
  });
}

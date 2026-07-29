/**
 * `peaks cron scheduler start|stop|status|run-once` — slice 2026-07-29 Part 15.
 *
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
 */

import { execSync, fork, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { readSchedule, listDueTasks, runTask, type ScheduleFile } from './cron-commands.js';

const SCHEDULER_TICK_MS = 60_000; // 1 minute
const PID_FILENAME = 'scheduler.pid';

function schedulerPidPath(projectRoot: string): string {
  return join(projectRoot, '.peaks', 'cron', PID_FILENAME);
}

function readSchedulerPid(projectRoot: string): number | null {
  const p = schedulerPidPath(projectRoot);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, 'utf8').trim();
  const pid = Number.parseInt(raw, 10);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  return pid;
}

function isPidAlive(pid: number): boolean {
  try {
    // `process.kill(pid, 0)` does not actually kill; it just
    // checks if the process exists. ESRCH means no such pid;
    // EPERM means it exists but we don't have permission to
    // signal it (still alive).
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as { code?: string }).code;
    return code === 'EPERM';
  }
}

function findSchedulerEntryPoint(): string {
  // The peaks-cron-scheduler.js entry shim lives in bin/ (not
  // dist/, so the pnpm build does not overwrite it). It forwards
  // to dist/cli/commands/cron-scheduler-commands.js with
  // PEAKS_CRON_SCHEDULER_DAEMON=1 set; the CLI detects the env
  // and runs runSchedulerLoop directly.
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/cli/commands/cron-scheduler-commands.js → bin/peaks-cron-scheduler.js
  return resolve(here, '..', '..', '..', 'bin', 'peaks-cron-scheduler.js');
}

export function registerCronSchedulerCommand(program: Command, io: ProgramIO): void {
  const cmd = program
    .command('cron-scheduler')
    .description('Long-running background scheduler for peaks cron tasks (Part 15).');

  addJsonOption(
    cmd.command('start')
      .description('Spawn the scheduler as a detached background process. Idempotent: refuses to start when an alive pid already exists.')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: { project?: string; json?: boolean }) => {
    try {
      const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
      const pidFile = schedulerPidPath(projectRoot);
      const existing = readSchedulerPid(projectRoot);
      if (existing !== null && isPidAlive(existing)) {
        printResult(
          io,
          ok('cron-scheduler.start', { projectRoot, started: false, alreadyRunning: true, existingPid: existing }, [], [
            `Scheduler already running at pid ${existing}; not starting a second one.`,
            'Use `peaks cron-scheduler stop` first if you need to restart.'
          ]),
          options.json
        );
        return;
      }
      // Spawn detached via `peaks-cron-scheduler.js` — the
      // child runs `runSchedulerLoop` (60s setInterval + due-task
      // runner). The detached flag + stdio:ignore puts the
      // scheduler in its own process group (POSIX) / detaches
      // from the console (Windows). PEAKS_CRON_SCHEDULER_DAEMON
      // env is the canonical "I'm the long-running child" signal.
      const entry = findSchedulerEntryPoint();
      const child = spawn(process.execPath, [entry, '--project', projectRoot], {
        cwd: projectRoot,
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
        env: { ...process.env, PEAKS_CRON_SCHEDULER: '1', PEAKS_CRON_SCHEDULER_DAEMON: '1' }
      });
      child.unref();
      if (typeof child.pid !== 'number') {
        throw new Error('spawn returned no pid');
      }
      writeFileSync(pidFile, String(child.pid), 'utf8');
      printResult(
        io,
        ok('cron-scheduler.start', { projectRoot, started: true, pid: child.pid, pidFile }, [], [
          `Scheduler started at pid ${child.pid}; logs go to .peaks/cron/scheduler.log.`,
          'Use `peaks cron-scheduler status` to confirm it is alive; `stop` to terminate.'
        ]),
        options.json
      );
    } catch (err) {
      printResult(
        io,
        fail('cron-scheduler.start', 'SCHEDULER_START_FAILED', getErrorMessage(err), { projectRoot: options.project }, [
          'Verify the peaks-cron-scheduler.js entry point is on disk.',
          'Check that the .peaks/cron/ directory is writable.'
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    cmd.command('stop')
      .description('Send SIGTERM to the scheduler pid (best-effort; removes the pid file either way).')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: { project?: string; json?: boolean }) => {
    try {
      const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
      const pid = readSchedulerPid(projectRoot);
      if (pid === null) {
        printResult(
          io,
          ok('cron-scheduler.stop', { projectRoot, stopped: false, reason: 'no-pid-file' }, [], ['No scheduler pid file found; nothing to stop.']),
          options.json
        );
        return;
      }
      let signalSent = false;
      if (isPidAlive(pid)) {
        try {
          process.kill(pid, 'SIGTERM');
          signalSent = true;
        } catch {
          signalSent = false;
        }
      }
      const pidFile = schedulerPidPath(projectRoot);
      try { unlinkSync(pidFile); } catch { /* best-effort */ }
      printResult(
        io,
        ok('cron-scheduler.stop', { projectRoot, stopped: signalSent, pid, pidFile }, [], [
          signalSent
            ? `Sent SIGTERM to pid ${pid}; pid file removed.`
            : `pid ${pid} was not alive; pid file removed.`
        ]),
        options.json
      );
    } catch (err) {
      printResult(
        io,
        fail('cron-scheduler.stop', 'SCHEDULER_STOP_FAILED', getErrorMessage(err), { projectRoot: options.project }, [
          'Verify the pid file is readable / the process is yours.'
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    cmd.command('status')
      .description('Report whether the scheduler is alive + when it last ran a task.')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: { project?: string; json?: boolean }) => {
    try {
      const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
      const pid = readSchedulerPid(projectRoot);
      const alive = pid !== null && isPidAlive(pid);
      let schedule: ScheduleFile;
      try {
        schedule = readSchedule(projectRoot);
      } catch (err) {
        schedule = { version: 1, entries: [] };
      }
      const due = alive ? listDueTasks(projectRoot) : [];
      printResult(
        io,
        ok(
          'cron-scheduler.status',
          { projectRoot, pid, alive, scheduleEntries: schedule.entries.length, dueTaskCount: due.length },
          [],
          [alive
            ? `Scheduler alive at pid ${pid}; ${due.length} task(s) due now.`
            : 'Scheduler is NOT running. Use `peaks cron-scheduler start` to spawn.']
        ),
        options.json
      );
    } catch (err) {
      printResult(
        io,
        fail('cron-scheduler.status', 'SCHEDULER_STATUS_FAILED', getErrorMessage(err), { projectRoot: options.project }, [
          'Verify the .peaks/cron/ directory exists.'
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    cmd.command('run-once')
      .description('Synchronous foreground one-shot: run every currently-due task and exit. Useful for manual cron substitute.')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: { project?: string; json?: boolean }) => {
    try {
      const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
      const due = listDueTasks(projectRoot);
      const records = due.map((t) => runTask(projectRoot, t));
      printResult(
        io,
        ok('cron-scheduler.run-once', { projectRoot, ran: records.length, records }, [], [
          `${records.length} due task(s) ran; ${records.filter((r) => r.exitCode === 0).length} succeeded.`
        ]),
        options.json
      );
      if (records.some((r) => r.exitCode !== 0)) process.exitCode = 1;
    } catch (err) {
      printResult(
        io,
        fail('cron-scheduler.run-once', 'SCHEDULER_RUN_ONCE_FAILED', getErrorMessage(err), { projectRoot: options.project }, [
          "If schedule.json is missing, run 'peaks cron init' first."
        ]),
        options.json
      );
      process.exitCode = 1;
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
export async function runSchedulerLoop(args: { projectRoot: string; tickMs?: number; signal?: AbortSignal }): Promise<void> {
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
      for (const task of due) {
        runTask(args.projectRoot, task);
      }
    } catch (err) {
      process.stderr.write(`[cron-scheduler] tick error: ${getErrorMessage(err)}\n`);
    }
  };

  // First tick on entry (don't wait the full interval
  // for the first run after a start).
  tick();
  const handle = setInterval(tick, tickMs);

  // Wait for the abort signal (POSIX) or the platform
  // equivalent. We don't use Node's process.on('SIGTERM')
  // for portability — the parent process kills us via
  // `process.kill(pid, 'SIGTERM')` and the event loop
  // exits naturally if the interval is the only thing
  // keeping the loop alive. We clearInterval on exit.
  await new Promise<void>((resolve) => {
    const onAbort = (): void => {
      clearInterval(handle);
      resolve();
    };
    if (args.signal) {
      args.signal.addEventListener('abort', onAbort, { once: true });
    } else {
      // POSIX: SIGTERM. Windows: kill the process directly.
      process.on('SIGTERM', onAbort);
      process.on('SIGINT', onAbort);
    }
  });
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
    return idx >= 0 ? process.argv[idx + 1] as string : findProjectRoot(process.cwd()) ?? process.cwd();
  })();
  runSchedulerLoop({ projectRoot }).catch((err) => {
    process.stderr.write(`[cron-scheduler] fatal: ${getErrorMessage(err)}\n`);
    process.exit(1);
  });
}

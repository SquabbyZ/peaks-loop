// src/cli/commands/cron-scheduler-start-command.ts
//
// `peaks cron-scheduler start` — spawn the scheduler as a detached background
// process. Split out of `cron-scheduler-commands.ts`; the idempotency rule,
// the spawn options, the pid file and both envelopes are unchanged.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import type { Command } from 'commander';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { findProjectRoot } from '../../services/config/config-safety.js';
import {
  findSchedulerEntryPoint,
  isPidAlive,
  readSchedulerPid,
  schedulerPidPath
} from './cron-scheduler-shared.js';

/**
 * Spawn detached via `peaks-cron-scheduler.js` — the child runs
 * `runSchedulerLoop` (60s setInterval + due-task runner). The detached flag +
 * stdio:ignore puts the scheduler in its own process group (POSIX) / detaches
 * from the console (Windows). PEAKS_CRON_SCHEDULER_DAEMON env is the canonical
 * "I'm the long-running child" signal.
 */
function spawnDetachedScheduler(
  io: ProgramIO,
  options: { json?: boolean },
  projectRoot: string,
  pidFile: string
): void {
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
    ok(
      'cron-scheduler.start',
      { projectRoot, started: true, pid: child.pid, pidFile },
      [],
      [
        `Scheduler started at pid ${child.pid}; logs go to .peaks/cron/scheduler.log.`,
        'Use `peaks cron-scheduler status` to confirm it is alive; `stop` to terminate.'
      ]
    ),
    options.json ?? false
  );
}

export function runCronSchedulerStart(
  io: ProgramIO,
  options: { project?: string; json?: boolean }
): void {
  try {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const pidFile = schedulerPidPath(projectRoot);
    const existing = readSchedulerPid(projectRoot);
    if (existing !== null && isPidAlive(existing)) {
      printResult(
        io,
        ok(
          'cron-scheduler.start',
          { projectRoot, started: false, alreadyRunning: true, existingPid: existing },
          [],
          [
            `Scheduler already running at pid ${existing}; not starting a second one.`,
            'Use `peaks cron-scheduler stop` first if you need to restart.'
          ]
        ),
        options.json ?? false
      );
      return;
    }
    spawnDetachedScheduler(io, options, projectRoot, pidFile);
  } catch (err) {
    printResult(
      io,
      fail(
        'cron-scheduler.start',
        'SCHEDULER_START_FAILED',
        getErrorMessage(err),
        { projectRoot: options.project },
        [
          'Verify the peaks-cron-scheduler.js entry point is on disk.',
          'Check that the .peaks/cron/ directory is writable.'
        ]
      ),
      options.json ?? false
    );
    process.exitCode = 1;
  }
}

export function registerCronSchedulerStartCommand(cmd: Command, io: ProgramIO): void {
  addJsonOption(
    cmd
      .command('start')
      .description(
        'Spawn the scheduler as a detached background process. Idempotent: refuses to start when an alive pid already exists.'
      )
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: { project?: string; json?: boolean }) => runCronSchedulerStart(io, options));
}

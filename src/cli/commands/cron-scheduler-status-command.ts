// src/cli/commands/cron-scheduler-status-command.ts
//
// `peaks cron-scheduler status` — report whether the scheduler is alive and
// how many tasks are due. Split out of `cron-scheduler-commands.ts`; the
// degraded-tier schedule read and both envelopes are unchanged.

import type { Command } from 'commander';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { listDueTasks, readSchedule, type ScheduleFile } from './cron-commands.js';
import { isPidAlive, readSchedulerPid } from './cron-scheduler-shared.js';

export function runCronSchedulerStatus(
  io: ProgramIO,
  options: { project?: string; json?: boolean }
): void {
  try {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const pid = readSchedulerPid(projectRoot);
    const alive = pid !== null && isPidAlive(pid);
    let schedule: ScheduleFile;
    try {
      schedule = readSchedule(projectRoot);
    } catch {
      schedule = { version: 1, entries: [] };
    }
    const due = alive ? listDueTasks(projectRoot) : [];
    printResult(
      io,
      ok(
        'cron-scheduler.status',
        {
          projectRoot,
          pid,
          alive,
          scheduleEntries: schedule.entries.length,
          dueTaskCount: due.length
        },
        [],
        [
          alive
            ? `Scheduler alive at pid ${pid}; ${due.length} task(s) due now.`
            : 'Scheduler is NOT running. Use `peaks cron-scheduler start` to spawn.'
        ]
      ),
      options.json ?? false
    );
  } catch (err) {
    printResult(
      io,
      fail(
        'cron-scheduler.status',
        'SCHEDULER_STATUS_FAILED',
        getErrorMessage(err),
        { projectRoot: options.project },
        ['Verify the .peaks/cron/ directory exists.']
      ),
      options.json ?? false
    );
    process.exitCode = 1;
  }
}

export function registerCronSchedulerStatusCommand(cmd: Command, io: ProgramIO): void {
  addJsonOption(
    cmd
      .command('status')
      .description('Report whether the scheduler is alive + when it last ran a task.')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: { project?: string; json?: boolean }) => runCronSchedulerStatus(io, options));
}

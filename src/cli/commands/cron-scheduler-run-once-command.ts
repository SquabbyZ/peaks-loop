// src/cli/commands/cron-scheduler-run-once-command.ts
//
// `peaks cron-scheduler run-once` — the synchronous foreground one-shot.
// Split out of `cron-scheduler-commands.ts`; the persistence step, the
// success envelope and the exit-code rule are unchanged.

import type { Command } from 'commander';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { listDueTasks, runTask } from './cron-commands.js';
import { persistLastRunAt } from './cron-scheduler-persist.js';

export function runCronSchedulerRunOnce(
  io: ProgramIO,
  options: { project?: string; json?: boolean }
): void {
  try {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const due = listDueTasks(projectRoot);
    const records = due.map((t) => runTask(projectRoot, t));
    // §2.24 applied to the one-shot path too: without it `run-once` under an
    // external crontab re-ran the same task on every invocation.
    persistLastRunAt(projectRoot, records);
    printResult(
      io,
      ok(
        'cron-scheduler.run-once',
        { projectRoot, ran: records.length, records },
        [],
        [
          `${records.length} due task(s) ran; ${records.filter((r) => r.exitCode === 0).length} succeeded.`
        ]
      ),
      options.json ?? false
    );
    if (records.some((r) => r.exitCode !== 0)) process.exitCode = 1;
  } catch (err) {
    printResult(
      io,
      fail(
        'cron-scheduler.run-once',
        'SCHEDULER_RUN_ONCE_FAILED',
        getErrorMessage(err),
        { projectRoot: options.project },
        ["If schedule.json is missing, run 'peaks cron init' first."]
      ),
      options.json ?? false
    );
    process.exitCode = 1;
  }
}

export function registerCronSchedulerRunOnceCommand(cmd: Command, io: ProgramIO): void {
  addJsonOption(
    cmd
      .command('run-once')
      .description(
        'Synchronous foreground one-shot: run every currently-due task and exit. Useful for manual cron substitute.'
      )
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: { project?: string; json?: boolean }) => runCronSchedulerRunOnce(io, options));
}

// src/cli/commands/cron-scheduler-stop-command.ts
//
// `peaks cron-scheduler stop` — SIGTERM the scheduler pid (best-effort) and
// remove the pid file either way. Split out of `cron-scheduler-commands.ts`;
// the signal, the unlink and both envelopes are unchanged.

import { unlinkSync } from 'node:fs';
import type { Command } from 'commander';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { isPidAlive, readSchedulerPid, schedulerPidPath } from './cron-scheduler-shared.js';

/** The no-pid-file outcome: nothing to signal, nothing to unlink. */
function emitNoPidFile(io: ProgramIO, options: { json?: boolean }, projectRoot: string): void {
  printResult(
    io,
    ok(
      'cron-scheduler.stop',
      { projectRoot, stopped: false, reason: 'no-pid-file' },
      [],
      ['No scheduler pid file found; nothing to stop.']
    ),
    options.json ?? false
  );
}

/** SIGTERM the pid (best-effort) and remove the pid file either way. */
function terminateScheduler(
  projectRoot: string,
  pid: number
): { signalSent: boolean; pidFile: string } {
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
  try {
    unlinkSync(pidFile);
  } catch {
    /* best-effort */
  }
  return { signalSent, pidFile };
}

export function runCronSchedulerStop(
  io: ProgramIO,
  options: { project?: string; json?: boolean }
): void {
  try {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const pid = readSchedulerPid(projectRoot);
    if (pid === null) {
      emitNoPidFile(io, options, projectRoot);
      return;
    }
    const { signalSent, pidFile } = terminateScheduler(projectRoot, pid);
    printResult(
      io,
      ok(
        'cron-scheduler.stop',
        { projectRoot, stopped: signalSent, pid, pidFile },
        [],
        [
          signalSent
            ? `Sent SIGTERM to pid ${pid}; pid file removed.`
            : `pid ${pid} was not alive; pid file removed.`
        ]
      ),
      options.json ?? false
    );
  } catch (err) {
    printResult(
      io,
      fail(
        'cron-scheduler.stop',
        'SCHEDULER_STOP_FAILED',
        getErrorMessage(err),
        { projectRoot: options.project },
        ['Verify the pid file is readable / the process is yours.']
      ),
      options.json ?? false
    );
    process.exitCode = 1;
  }
}

export function registerCronSchedulerStopCommand(cmd: Command, io: ProgramIO): void {
  addJsonOption(
    cmd
      .command('stop')
      .description(
        'Send SIGTERM to the scheduler pid (best-effort; removes the pid file either way).'
      )
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: { project?: string; json?: boolean }) => runCronSchedulerStop(io, options));
}

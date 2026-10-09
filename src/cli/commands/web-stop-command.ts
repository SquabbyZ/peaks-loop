// src/cli/commands/web-stop-command.ts
//
// `peaks web stop` — stop this session's daemon and clear its records. Split
// out of `web-lifecycle-commands.ts`; the verb name, its options, the
// `stopped`-means-gone contract and the warning lines are unchanged.

import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';
import { stopDaemon, type StopDaemonResult } from '../../services/web/daemon-supervisor.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { noSession, resolveSession } from './web-command-shared.js';

/** Everything `stop` did NOT clean, said out loud rather than left implicit. */
function stopWarnings(result: StopDaemonResult): string[] {
  const warnings: string[] = [];
  const stuck = result.pids.length - result.stopped;
  if (stuck > 0) {
    warnings.push(
      `${String(stuck)} daemon process(es) did not exit after the stop request; they are recorded, ` +
        'so a later `peaks web stop` can try again'
    );
  }
  if (result.orphanedPids.length > 0) {
    warnings.push(
      `${String(result.orphanedPids.length)} daemon instance(s) are alive but could not be proven ` +
        "to be this session's daemon (no authenticated identity); the processes were left running, " +
        'because a pid that cannot be proven is never signalled, and their records are kept so ' +
        '`peaks web status` and a later `stop` still see them'
    );
  }
  return warnings;
}

/**
 * Stop the daemon and clear its records. `stopped` counts the daemons whose
 * process is confirmed GONE by return — not merely the ones we signalled — so a
 * caller that checks the process table right after this returns is not racing
 * the teardown (AC6).
 */
export async function runWebStop(io: ProgramIO, asJson: boolean): Promise<void> {
  const command = 'peaks.web.stop';
  try {
    const session = resolveSession();
    if (session === null) {
      printResult(io, noSession(command), asJson);
      process.exitCode = 1;
      return;
    }
    const result = await stopDaemon(session.projectRoot, session.sessionId);
    printResult(
      io,
      ok(
        command,
        {
          stopped: result.stopped,
          pids: [...result.pids],
          orphanedPids: [...result.orphanedPids]
        },
        stopWarnings(result)
      ),
      asJson
    );
  } catch (error) {
    printResult(
      io,
      fail(command, 'WEB_STOP_FAILED', `peaks web stop failed: ${getErrorMessage(error)}`, {}, []),
      asJson
    );
    process.exitCode = 1;
  }
}

export function registerWebStopCommand(web: Command, io: ProgramIO): void {
  addJsonOption(
    web
      .command('stop')
      .description(
        "Stop this session's web daemon and close its browser. Scoped to this project root and " +
          'session; another worktree is untouched, and a process that cannot be proven to be this ' +
          "session's daemon is left running rather than signalled."
      )
  ).action((options: { json?: boolean }) => runWebStop(io, options.json === true));
}

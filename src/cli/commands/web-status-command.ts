// src/cli/commands/web-status-command.ts
//
// `peaks web status` — this session's daemon instances (live / orphaned /
// stale), read from the filesystem and the loopback port, never from the daemon.
// Split out of `web-lifecycle-commands.ts`; the verb name, its options and the
// envelope shape are unchanged.

import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';
import { buildStatusReport } from '../../services/web/web-status-report.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { noSession, resolveSession } from './web-command-shared.js';

export async function runWebStatus(io: ProgramIO, asJson: boolean): Promise<void> {
  const command = 'peaks.web.status';
  try {
    const session = resolveSession();
    if (session === null) {
      printResult(io, noSession(command), asJson);
      process.exitCode = 1;
      return;
    }
    printResult(
      io,
      ok(command, await buildStatusReport(session.projectRoot, session.sessionId)),
      asJson
    );
  } catch (error) {
    printResult(
      io,
      fail(
        command,
        'WEB_STATUS_FAILED',
        `peaks web status failed: ${getErrorMessage(error)}`,
        {},
        []
      ),
      asJson
    );
    process.exitCode = 1;
  }
}

export function registerWebStatusCommand(web: Command, io: ProgramIO): void {
  addJsonOption(
    web
      .command('status')
      .description(
        "Report this session's web daemon instances (live / orphaned / stale). Works with no " +
          'daemon running and never starts one.'
      )
  ).action((options: { json?: boolean }) => runWebStatus(io, options.json === true));
}

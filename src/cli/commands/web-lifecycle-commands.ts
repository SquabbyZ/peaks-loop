/**
 * `peaks web status|stop` — the daemon-lifecycle verbs (slice S2, file 13;
 * extended by S3's `install` and S4's `login`).
 *
 * Attaches to the `web` parent handed in by `web-commands.ts` rather than
 * looking it up: the lookup needs a fallback branch for "parent not registered
 * yet" that cannot happen here, and one less branch is one less path to test.
 *
 * Neither verb goes through the daemon. `status` must work when the daemon is
 * dead or wedged — that IS its job (AC6) — and `stop` must work when the daemon
 * answers nothing at all. Both therefore read the filesystem and the loopback
 * port directly, and both keep working under S3's `PEAKS_WEB_DISABLED` gate
 * (decision C2).
 */
import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';

import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import { stopDaemon, type StopDaemonResult } from '../../services/web/daemon-supervisor.js';
import { buildStatusReport } from '../../services/web/web-status-report.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

export function registerWebLifecycleCommands(web: Command, io: ProgramIO): void {
  addJsonOption(
    web
      .command('status')
      .description(
        'Report this session\'s web daemon instances (live / orphaned / stale). Works with no ' +
          'daemon running and never starts one.'
      )
  ).action(async (options: { json?: boolean }) => {
    await runWebStatus(io, options.json === true);
  });

  addJsonOption(
    web
      .command('stop')
      .description(
        "Stop this session's web daemon and close its browser. Scoped to this project root and " +
          'session; another worktree is untouched, and a process that cannot be proven to be this ' +
          "session's daemon is left running rather than signalled."
      )
  ).action(async (options: { json?: boolean }) => {
    await runWebStop(io, options.json === true);
  });
}

/** Resolve this project's session, or report `NO_SESSION` exactly once. */
function resolveSession(): { projectRoot: string; sessionId: string } | null {
  const projectRoot = resolveCanonicalProjectRoot(process.cwd());
  const sessionId = getCurrentSessionId(projectRoot);
  return sessionId === null ? null : { projectRoot, sessionId };
}

/** The shared `NO_SESSION` envelope for both lifecycle verbs. */
function noSession(command: string): ReturnType<typeof fail> {
  return fail(command, 'NO_SESSION', 'No peaks session is bound to this project root', {}, [
    'Bind a session first (the LLM runs `peaks workspace init` on your behalf)'
  ]);
}

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
        'to be this session\'s daemon (no authenticated identity); the processes were left running, ' +
        'because a pid that cannot be proven is never signalled, and their records are kept so ' +
        '`peaks web status` and a later `stop` still see them'
    );
  }
  return warnings;
}

export async function runWebStatus(io: ProgramIO, asJson: boolean): Promise<void> {
  const command = 'peaks.web.status';
  try {
    const session = resolveSession();
    if (session === null) {
      printResult(io, noSession(command), asJson);
      process.exitCode = 1;
      return;
    }
    printResult(io, ok(command, await buildStatusReport(session.projectRoot, session.sessionId)), asJson);
  } catch (error) {
    printResult(
      io,
      fail(command, 'WEB_STATUS_FAILED', `peaks web status failed: ${getErrorMessage(error)}`, {}, []),
      asJson
    );
    process.exitCode = 1;
  }
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

/**
 * `peaks web status|stop|install` — the daemon-lifecycle and acquisition verbs
 * (slice S2, file 13; S3 adds `install`; S4 adds `login`).
 *
 * Attaches to the `web` parent handed in by `web-commands.ts` rather than
 * looking it up: the lookup needs a fallback branch for "parent not registered
 * yet" that cannot happen here, and one less branch is one less path to test.
 *
 * None of the three goes through the daemon. `status` must work when the daemon
 * is dead or wedged — that IS its job (AC6) — and `stop` must work when the
 * daemon answers nothing at all. Both therefore read the filesystem and the
 * loopback port directly, and both keep working under S3's
 * `PEAKS_WEB_DISABLED` gate (decision C2). `install` is a local download, so it
 * needs no daemon either.
 */
import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';

import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import { stopDaemon, type StopDaemonResult } from '../../services/web/daemon-supervisor.js';
import { degradedEnvelope } from '../../services/web/web-fallback.js';
import {
  INSTALL_SIZE_WARNING,
  installChromium,
  isWebDisabled,
  probeBrowserInstalled
} from '../../services/web/web-install-service.js';
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

  addJsonOption(
    web
      .command('install')
      .description(
        'Download the pinned chromium for `peaks web` (one time, ~700 MB on disk). Needed only ' +
          'before the first browser op — a read-only verb never downloads. Refuses while ' +
          'PEAKS_WEB_DISABLED=1.'
      )
      .option('--force', "reinstall even if the browser is already present (Playwright's own recovery path)")
  ).action(async (options: { json?: boolean; force?: boolean }) => {
    await runWebInstall(io, options.json === true, options.force === true);
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

/** The MCP fallback for `install`, named so the LLM can act on it (decision C3). */
const WEB_DISABLED_ACTIONS = [
  'Unset PEAKS_WEB_DISABLED to install locally',
  'Or call mcp__playwright__browser_install instead'
];

/** The same fallback, minus the gate, for a download that failed on its own. */
const INSTALL_FAILED_ACTIONS = [
  'Retry `peaks web install`, or `peaks web install --force` after a partial download',
  'Or call mcp__playwright__browser_install instead'
];

/**
 * `peaks web install` — the explicit form of the lazy download, plus R6's
 * recovery path (`--force`).
 *
 * The gate is step 1 of the ordered gate (tech-doc §5.1): checked BEFORE the
 * session lookup, before any lock and before anything that could touch the
 * browser cache, so this verb cannot download under `PEAKS_WEB_DISABLED=1` even
 * if every later step is broken (C2's matrix).
 */
export async function runWebInstall(io: ProgramIO, asJson: boolean, force: boolean): Promise<void> {
  const command = 'peaks.web.install';
  try {
    if (isWebDisabled(process.env)) {
      printResult(
        io,
        fail(
          command,
          'WEB_DISABLED',
          '`peaks web install` will not download anything while PEAKS_WEB_DISABLED=1',
          {},
          WEB_DISABLED_ACTIONS
        ),
        asJson
      );
      process.exitCode = 1;
      return;
    }

    const session = resolveSession();
    if (session === null) {
      printResult(io, noSession(command), asJson);
      process.exitCode = 1;
      return;
    }

    // R6's other half: a missing executable is the only reason to download, so
    // an already-complete install is reported without spawning anything. The
    // shortcut still names `--force`, because it is the only escape if a browser
    // op keeps failing against a probe that says otherwise (R7).
    const before = await probeBrowserInstalled();
    if (before.installed && !force) {
      printResult(
        io,
        ok(
          command,
          {
            installed: true,
            downloaded: false,
            version: before.version,
            executablePath: before.executablePath
          },
          [],
          ['If browser ops still fail, re-run `peaks web install --force`']
        ),
        asJson
      );
      return;
    }

    // R2: name the size on the human channel BEFORE the blocking download —
    // this is the only point at which "before" is still available.
    io.stderr(`warning: ${INSTALL_SIZE_WARNING}`);
    const outcome = await installChromium({ force });
    if (!outcome.ok) {
      // R2: a failed download is a structured tier-3 envelope, never a stack.
      printResult(io, degradedEnvelope('install', `${outcome.code}: ${outcome.message}`), asJson);
      process.exitCode = 1;
      return;
    }

    // `after.installed` is CONSULTED, not merely carried (R7). An installer
    // that exits 0 without landing the browser — a proxy that filters the CDN, a
    // pinned npx resolving into a different cache root, a partial install — used
    // to report `ok: true, downloaded: true, installed: false` with exit 0 and
    // nothing to do next.
    const after = await probeBrowserInstalled();
    if (!after.installed) {
      printResult(
        io,
        degradedEnvelope(
          'install',
          'WEB_INSTALL_INCOMPLETE: `playwright install chromium` exited 0 but the browser it ' +
            'names is still missing'
        ),
        asJson
      );
      process.exitCode = 1;
      return;
    }
    printResult(
      io,
      ok(
        command,
        {
          installed: true,
          downloaded: true,
          version: after.version,
          executablePath: after.executablePath
        },
        [...outcome.warnings]
      ),
      asJson
    );
  } catch (error) {
    printResult(
      io,
      fail(
        command,
        'WEB_INSTALL_FAILED',
        `peaks web install failed: ${getErrorMessage(error)}`,
        {},
        INSTALL_FAILED_ACTIONS
      ),
      asJson
    );
    process.exitCode = 1;
  }
}

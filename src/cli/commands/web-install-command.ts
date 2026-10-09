// src/cli/commands/web-install-command.ts
//
// `peaks web install` — the explicit form of the lazy chromium download, plus
// R6's recovery path (`--force`). Split out of `web-lifecycle-commands.ts`; the
// verb name, its options, the gate-first order, the post-install probe and the
// envelope shapes are unchanged.

import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';
import { degradedEnvelope } from '../../services/web/web-fallback.js';
import {
  INSTALL_SIZE_WARNING,
  installChromium,
  isWebDisabled,
  probeBrowserInstalled
} from '../../services/web/web-install-service.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { noSession, resolveSession } from './web-command-shared.js';

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

type BrowserProbe = Awaited<ReturnType<typeof probeBrowserInstalled>>;

/**
 * R6's other half: a missing executable is the only reason to download, so an
 * already-complete install is reported without spawning anything. The shortcut
 * still names `--force`, because it is the only escape if a browser op keeps
 * failing against a probe that says otherwise (R7).
 */
/**
 * The ordered gate (tech-doc §5.1): `PEAKS_WEB_DISABLED` FIRST, before the
 * session lookup and before anything that could touch the browser cache, so
 * this verb cannot download under the gate even if every later step is broken.
 * Returns the refusal to print, or `null` when the install may proceed.
 */
function installRefusal(command: string): ReturnType<typeof fail> | null {
  if (isWebDisabled(process.env)) {
    return fail(
      command,
      'WEB_DISABLED',
      '`peaks web install` will not download anything while PEAKS_WEB_DISABLED=1',
      {},
      WEB_DISABLED_ACTIONS
    );
  }
  return resolveSession() === null ? noSession(command) : null;
}

/** R7: an installer that exited 0 without landing the browser is not a success. */
function installIncompleteEnvelope(): ReturnType<typeof degradedEnvelope> {
  return degradedEnvelope(
    'install',
    'WEB_INSTALL_INCOMPLETE: `playwright install chromium` exited 0 but the browser it ' +
      'names is still missing'
  );
}

function installDoneEnvelope(
  command: string,
  after: BrowserProbe,
  warnings: readonly string[]
): ReturnType<typeof ok> {
  return ok(
    command,
    {
      installed: true,
      downloaded: true,
      version: after.version,
      executablePath: after.executablePath
    },
    [...warnings]
  );
}

function alreadyInstalledEnvelope(command: string, before: BrowserProbe): ReturnType<typeof ok> {
  return ok(
    command,
    {
      installed: true,
      downloaded: false,
      version: before.version,
      executablePath: before.executablePath
    },
    [],
    ['If browser ops still fail, re-run `peaks web install --force`']
  );
}

/**
 * `peaks web install` — the explicit form of the lazy download, plus R6's
 * recovery path (`--force`).
 *
 * The gate is step 1 of the ordered gate (tech-doc §5.1) — see {@link installRefusal}.
 */
export async function runWebInstall(io: ProgramIO, asJson: boolean, force: boolean): Promise<void> {
  const command = 'peaks.web.install';
  try {
    const refusal = installRefusal(command);
    if (refusal !== null) {
      printResult(io, refusal, asJson);
      process.exitCode = 1;
      return;
    }

    const before = await probeBrowserInstalled();
    if (before.installed && !force) {
      printResult(io, alreadyInstalledEnvelope(command, before), asJson);
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

    // `after.installed` is CONSULTED, not merely carried (R7): an installer
    // that exits 0 without landing the browser — a proxy that filters the CDN, a
    // pinned npx resolving into a different cache root, a partial install —
    // reported `ok: true, downloaded: true, installed: false` with exit 0 and
    // nothing to do next.
    const after = await probeBrowserInstalled();
    if (!after.installed) {
      printResult(io, installIncompleteEnvelope(), asJson);
      process.exitCode = 1;
      return;
    }
    printResult(io, installDoneEnvelope(command, after, outcome.warnings), asJson);
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

export function registerWebInstallCommand(web: Command, io: ProgramIO): void {
  addJsonOption(
    web
      .command('install')
      .description(
        'Download the pinned chromium for `peaks web` (one time, ~700 MB on disk). Needed only ' +
          'before the first browser op — a read-only verb never downloads. Refuses while ' +
          'PEAKS_WEB_DISABLED=1.'
      )
      .option(
        '--force',
        "reinstall even if the browser is already present (Playwright's own recovery path)"
      )
  ).action((options: { json?: boolean; force?: boolean }) =>
    runWebInstall(io, options.json === true, options.force === true)
  );
}

// src/services/distribution/mcp-install-runner.ts
//
// The production runner behind the vendor-neutral MCP registration engine
// (`mcp-install.ts`): it runs one harness command under a deadline and reports
// what the process said. It lives in its own module only so the engine keeps its
// size; the engine RE-EXPORTS it, so every caller still imports it from
// `mcp-install.js` and no import path moved.
//
// THE FIELD THIS MODULE EXISTS FOR. A run that exits non-zero ANSWERED the
// question — "no such registration" — and a run the deadline kills, or one that
// never launches, did not: `answered: false` is the only place that distinction
// is born, and it is what stops `peaks mcp uninstall` from reporting a hung
// harness's scope as "nothing was there".

import { spawnSync } from 'node:child_process';

import type { McpInstallCommand, McpInstallOutcome, McpInstallRunner } from './mcp-install.js';

/**
 * Ceiling on ONE harness command. `spawnSync` without `timeout` has no ceiling
 * at all, and the failure it lets through is measured, not hypothetical: a
 * real harness binary on this host starts and then does not return within 25 s.
 * Unbounded, that blocks `peaks mcp install` in the foreground forever. Same
 * class the MCP CLI executor bounds (`cli-executor.ts`), set to twice its 15 s
 * because the child is the harness's binary and its startup is its own to
 * spend. A plan is at most three commands, so the install is bounded at 3x.
 */
export const MCP_INSTALL_TIMEOUT_MS = 30_000;

/**
 * One harness command, with the deadline applied. `windowsHide` is the tree's
 * spawn contract: a CLI that briefly runs a harness must not flash a console
 * window on a desktop OS. `timeoutMs` is a parameter only so a test can watch
 * the deadline fire without waiting out the production value — callers want
 * `spawnMcpInstallRunner`, which fixes it.
 */
export function spawnMcpInstallCommand(
  command: McpInstallCommand,
  timeoutMs: number = MCP_INSTALL_TIMEOUT_MS
): McpInstallOutcome {
  const result = spawnSync(command.command, [...command.args], {
    stdio: 'pipe',
    windowsHide: true,
    encoding: 'utf8',
    timeout: timeoutMs
  });
  if (result.error !== undefined) {
    // `spawnSync` kills the child at the deadline and reports its own timeout as
    // ETIMEDOUT. A deadline and a launch failure are different facts, but they
    // share the one that matters here: the harness never rendered a verdict.
    const timedOut = (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
    return {
      ok: false,
      answered: false,
      detail: timedOut
        ? `timed out after ${timeoutMs} ms and was killed: ${command.command} ${command.args.join(' ')}`
        : result.error.message
    };
  }
  if (result.status === 0) {
    return { ok: true, detail: '' };
  }
  const stderr = (result.stderr ?? '').trim();
  return { ok: false, detail: stderr.length > 0 ? stderr : `exit ${result.status ?? 'unknown'}` };
}

/** The production runner: the deadline above, and nothing else left to decide. */
export const spawnMcpInstallRunner: McpInstallRunner = (command) => spawnMcpInstallCommand(command);

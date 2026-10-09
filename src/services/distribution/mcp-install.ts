// src/services/distribution/mcp-install.ts
//
// The vendor-neutral MCP registration engine (spec §8.3). It owns the SHAPE of
// an install — delete every scope, then add — and owns no harness's spelling of
// anything: the server key, the scopes and the argv come from the adapter's
// `mcpInstall` profile, and the process that runs the argv is an injected
// runner.
//
// WHY DELETE-THEN-ADD AND NOT "CHECK, THEN ADD IF ABSENT". The harness's own
// register verb is not idempotent: the same name in the same scope fails, and
// there is no `--force` and no `update` to reach for. A conditional add would
// therefore have to be right about a state it cannot see — so the engine does
// the one thing that is right in both states: it removes what is there (a
// removal that finds nothing is tolerated) and then adds. That is also what
// makes the install SEMANTICALLY idempotent: two runs produce the same argv in
// the same order, so the registration left behind has the same CONTENT, even
// though the second run performed operations the first one did too.
//
// WHY THE DELETE SWEEPS EVERY SCOPE. The entry can already exist in a scope the
// install is not writing to — an earlier install, or a user who moved it. The
// removal names a scope, and the harness fails on the wrong or empty one, so a
// targeted delete would leave the old entry behind and the add would then fail
// on the duplicate it left. Sweeping all declared scopes is the only version of
// this that is correct for a state the engine cannot enumerate.
//
// WHAT "ONLY OURS" MEANS HERE. The engine never reads or writes the
// harness's configuration file. It runs the harness's own removal and addition,
// and the only key either of them names is the adapter's `serverName` — so no
// other entry can be touched by construction. The honest limit of that
// guarantee is the name itself: an entry the USER named the same thing is
// indistinguishable from ours, and is the one case this cannot tell apart.
//
// NO HARNESS BRANCH, NO PLATFORM BRANCH. Every value is either the caller's or
// the adapter's. `resolveMcpServerArgv` returns an interpreter and an entry path
// for the same reason `cli-executor.ts` does: a shipped CLI name is a shim on
// some platforms, and choosing between the two spellings would be the platform
// branch this module is forbidden to contain.

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IdeAdapter, IdeId } from '../ide/ide-types.js';
import {
  assertMcpInstallProfile,
  expandMcpArgv,
  type IdeMcpInstallProfile
} from '../ide/ide-mcp-install-types.js';

/** `<packageRoot>` — this file's tree is `<root>/src/services/distribution` or `<root>/dist/…`. */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** One process the plan wants run, as command + args. Never a joined string. */
export interface McpInstallCommand {
  readonly command: string;
  readonly args: readonly string[];
}

/** What one operation is for, so a report can say which step did what. */
export type McpInstallOperation = 'remove' | 'add';

export interface McpInstallStep {
  readonly operation: McpInstallOperation;
  /** The scope this step acts on; the target scope for an `add`. */
  readonly scope: string;
  readonly command: McpInstallCommand;
}

/** What a runner says happened. `detail` is surfaced verbatim when it did not. */
export interface McpInstallOutcome {
  readonly ok: boolean;
  readonly detail: string;
}

/** The seam: a test supplies one, the CLI supplies the spawning one below. */
export type McpInstallRunner = (command: McpInstallCommand) => McpInstallOutcome;

export interface McpInstallReport {
  readonly serverName: string;
  /** Scopes where the removal reported success — i.e. there was something to remove. */
  readonly removed: readonly string[];
  /** Scopes where the removal reported failure — normally "nothing was there". */
  readonly absent: readonly string[];
  readonly added: boolean;
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * The argv that launches THIS installation's read-only MCP server.
 *
 * An interpreter and an entry path, in array form: the same shape `mcp serve`
 * spawns and the same one the read-only executor uses. A bare CLI name would be
 * a `.cmd` shim on some platforms, and picking a spelling per platform is the
 * branch this tree forbids — resolving the pair needs none.
 */
export function resolveMcpServerArgv(): readonly string[] {
  return [process.execPath, join(PACKAGE_ROOT, 'bin', 'peaks.js'), 'mcp', 'serve'];
}

/** The plan: one removal per declared scope, then the addition. Order is the contract. */
export function buildMcpInstallPlan(
  profile: IdeMcpInstallProfile,
  serverArgv: readonly string[]
): readonly McpInstallStep[] {
  assertMcpInstallProfile(profile);
  const removals = profile.scopes.map((scope) => ({
    operation: 'remove' as const,
    scope,
    command: {
      command: profile.removeArgv[0] ?? '',
      args: expandMcpArgv(profile.removeArgv.slice(1), {
        serverName: profile.serverName,
        scope,
        serverArgv
      })
    }
  }));
  const addition: McpInstallStep = {
    operation: 'add',
    scope: profile.targetScope,
    command: {
      command: profile.addArgv[0] ?? '',
      args: expandMcpArgv(profile.addArgv.slice(1), {
        serverName: profile.serverName,
        scope: profile.targetScope,
        serverArgv
      })
    }
  };
  return [...removals, addition];
}

/** Every removal, then the addition. A failed removal is a fact, not a failure. */
export function runMcpInstallPlan(
  profile: IdeMcpInstallProfile,
  serverArgv: readonly string[],
  runner: McpInstallRunner
): McpInstallReport {
  const plan = buildMcpInstallPlan(profile, serverArgv);
  const removed: string[] = [];
  const absent: string[] = [];
  let detail = '';

  for (const step of plan) {
    const outcome = runner(step.command);
    if (step.operation === 'remove') {
      if (outcome.ok) removed.push(step.scope);
      else absent.push(step.scope);
      continue;
    }
    if (!outcome.ok) {
      return {
        serverName: profile.serverName,
        removed,
        absent,
        added: false,
        ok: false,
        detail: `the registration was not written: ${outcome.detail}`
      };
    }
    detail = `registered in scope '${step.scope}'`;
  }

  return { serverName: profile.serverName, removed, absent, added: true, ok: true, detail };
}

/** The removal sweep on its own — what `uninstall` is, and all that it is. */
export function runMcpUninstallPlan(
  profile: IdeMcpInstallProfile,
  serverArgv: readonly string[],
  runner: McpInstallRunner
): McpInstallReport {
  const plan = buildMcpInstallPlan(profile, serverArgv).filter(
    (step) => step.operation === 'remove'
  );
  const removed: string[] = [];
  const absent: string[] = [];
  for (const step of plan) {
    const outcome = runner(step.command);
    if (outcome.ok) removed.push(step.scope);
    else absent.push(step.scope);
  }
  return {
    serverName: profile.serverName,
    removed,
    absent,
    added: false,
    ok: true,
    detail:
      removed.length === 0
        ? `no '${profile.serverName}' registration was present in any declared scope`
        : `removed '${profile.serverName}' from ${removed.length} scope(s)`
  };
}

/**
 * One adapter's outcome. `skipped` is a FIRST-CLASS result and not an error: the
 * install's contract with an adapter that declares no registration entry is
 * silence, and a caller that has to distinguish "did nothing" from
 * "failed" needs the distinction to be in the value, not in a log line.
 */
export type AdapterMcpInstallResult =
  | { readonly ideId: IdeId; readonly skipped: true; readonly reason: string }
  | { readonly ideId: IdeId; readonly skipped: false; readonly report: McpInstallReport };

export const NO_MCP_INSTALL_REASON = 'adapter declares no mcpInstall profile';

/** Register this adapter's harness, or report that there is nothing to register. */
export function installMcpForAdapter(
  adapter: IdeAdapter,
  serverArgv: readonly string[],
  runner: McpInstallRunner
): AdapterMcpInstallResult {
  const profile = adapter.mcpInstall;
  if (profile === undefined) {
    return { ideId: adapter.id, skipped: true, reason: NO_MCP_INSTALL_REASON };
  }
  return {
    ideId: adapter.id,
    skipped: false,
    report: runMcpInstallPlan(profile, serverArgv, runner)
  };
}

/** The same, for the removal side. */
export function uninstallMcpForAdapter(
  adapter: IdeAdapter,
  serverArgv: readonly string[],
  runner: McpInstallRunner
): AdapterMcpInstallResult {
  const profile = adapter.mcpInstall;
  if (profile === undefined) {
    return { ideId: adapter.id, skipped: true, reason: NO_MCP_INSTALL_REASON };
  }
  return {
    ideId: adapter.id,
    skipped: false,
    report: runMcpUninstallPlan(profile, serverArgv, runner)
  };
}

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
    // ETIMEDOUT. That has to read as a deadline, not as a launch error: "the
    // harness hung" and "the harness said no" are different facts.
    if ((result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
      return {
        ok: false,
        detail: `timed out after ${timeoutMs} ms and was killed: ${command.command} ${command.args.join(' ')}`
      };
    }
    return { ok: false, detail: result.error.message };
  }
  if (result.status === 0) {
    return { ok: true, detail: '' };
  }
  const stderr = (result.stderr ?? '').trim();
  return { ok: false, detail: stderr.length > 0 ? stderr : `exit ${result.status ?? 'unknown'}` };
}

/** The production runner: the deadline above, and nothing else left to decide. */
export const spawnMcpInstallRunner: McpInstallRunner = (command) => spawnMcpInstallCommand(command);

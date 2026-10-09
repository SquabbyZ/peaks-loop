// src/services/mcp/cli-executor.ts
//
// The one place the MCP server touches the outside world: it runs a concrete
// argv against the peaks CLI and hands back what happened.
//
// THREE RULES, EACH MEASURED INTO THE SHAPE BELOW.
//
// 1. NO SHELL, NO PLATFORM BRANCH (spec §8.2). The launch is
//    `node <this tree's CLI entry>` — `process.execPath` plus the argument list
//    that makes this Node interpret that entry. Naming the CLI as a command
//    (`peaks`) is measurably wrong on a platform whose CLI is a batch shim:
//    Node refuses to spawn `.cmd`/`.bat` without a shell, and with a shell the
//    argv array stops being an argv array. `process.execPath` needs neither, so
//    one shape serves every platform and no `if (platform)` exists.
//
// 2. THE TIMEOUT IS MANDATORY, NOT OPTIONAL. `peaks job status --watch` never
//    returns. It is outside the read-only surface, but it proves the class: a
//    server that waits forever on a hung child gives its caller no recovery
//    path. A timeout therefore returns a NAMED failure, never an empty success
//    (spec §7.2 + §9 rule 3).
//
// 3. THE CHILD GETS NO STDIN. Our stdin is the JSON-RPC transport; a child that
//    inherited it would read our protocol stream and answer the harness itself.

import { spawn } from 'node:child_process';

import { readonlySpawnOptions } from '../readonly-surface/argv-guard.js';
import { cliEntryPath, interpreterArgs } from '../web/daemon-supervisor.js';

/** Ceiling on one CLI execution. Generous for a read, far short of "forever". */
export const DEFAULT_EXECUTION_TIMEOUT_MS = 15_000;

/** How to start this tree's own CLI. */
export interface CliLaunch {
  readonly command: string;
  readonly argsPrefix: readonly string[];
}

/**
 * Resolve the platform-neutral launch shape. Uses the shared daemon-supervisor
 * resolvers rather than a second copy of them: the entry path and the
 * TypeScript-loader flags have to agree with every other self-spawn in this
 * tree, and the file that owns them says so in as many words.
 */
export function resolveCliLaunch(): CliLaunch {
  return { command: process.execPath, argsPrefix: interpreterArgs(cliEntryPath()) };
}

export interface CliExecution {
  /** The concrete argv that was handed to the CLI, without the launch prefix. */
  readonly argv: readonly string[];
  /** Exit status, or `null` when the process died on a signal or was killed. */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** True when the deadline fired and the child was killed. */
  readonly timedOut: boolean;
  /** Set ONLY when the process could not be started at all. Never set on timeout. */
  readonly launchError?: string;
}

export interface ExecuteOptions {
  readonly launch?: CliLaunch;
  readonly timeoutMs?: number;
  readonly cwd?: string;
}

/** The spawn + drain half: one child, one settlement, whatever happens to it. */
function runChild(
  launch: CliLaunch,
  argv: readonly string[],
  cwd: string,
  timeoutMs: number
): Promise<CliExecution> {
  return new Promise<CliExecution>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let launchError: string | undefined;

    const child = spawn(launch.command, [...launch.argsPrefix, ...argv], {
      ...readonlySpawnOptions(),
      cwd,
      // stdin must stay ours; stdout/stderr are read as data.
      stdio: ['ignore', 'pipe', 'pipe'],
      // Windows contract: a spawned child must not allocate a console window.
      windowsHide: true
    });

    const deadline = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    const settle = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      const outcome: CliExecution = { argv, exitCode, stdout, stderr, timedOut };
      resolve(launchError === undefined ? outcome : { ...outcome, launchError });
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error: Error) => {
      launchError = error.message;
    });
    // `close` (not `exit`) so both pipes are drained before we read them.
    child.on('close', (code: number | null) => {
      settle(code);
    });
  });
}

/**
 * Run one argv. Always resolves: a failure is a described outcome, never a
 * rejection, because the caller has to report it to the harness either way.
 */
export async function executeCliArgv(
  argv: readonly string[],
  options: ExecuteOptions = {}
): Promise<CliExecution> {
  let launch: CliLaunch;
  try {
    launch = options.launch ?? resolveCliLaunch();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { argv, exitCode: null, stdout: '', stderr: '', timedOut: false, launchError: message };
  }
  return runChild(
    launch,
    argv,
    options.cwd ?? process.cwd(),
    options.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS
  );
}

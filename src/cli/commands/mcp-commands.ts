// src/cli/commands/mcp-commands.ts
//
// `peaks mcp` — the command family around the read-only MCP surface. This slice
// delivers `serve`; `install` / `uninstall` / `status` are the distribution
// slice's (spec §12, segment ③).
//
// WHY THIS FILE DOES NOT IMPORT THE SERVER. The design's load-bearing invariant
// is that `src/services/mcp/` is a DELETABLE PIPE (spec §1): remove it and the
// CLI is unchanged, the interceptor is unchanged, and a harness that used MCP
// simply falls back to Bash. That invariant is an assertion about import edges,
// and it is enforced by `tests/unit/standards/no-mcp-source-import.test.ts` —
// which reports an edge from any module outside the MCP root, this file
// included. So the server is reached the way the design says a server is
// reached: as a PROCESS, by path.
//
// The path is computed here rather than asked for, because asking would be the
// import. `SOURCE_TREE` / `TREE_DIR` are the same two facts every other
// self-spawn in this tree derives the same way (see `daemon-supervisor.ts`):
// this file's own extension says which tree it was loaded from, and its own
// directory says where that tree is.

import { spawn } from 'node:child_process';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';

import {
  installMcpForAdapter,
  resolveMcpServerArgv,
  spawnMcpInstallRunner,
  uninstallMcpForAdapter,
  type AdapterMcpInstallResult
} from '../../services/distribution/mcp-install.js';
import { detectIdeFromContext } from '../../services/ide/hook-translator.js';
import type { IdeAdapter } from '../../services/ide/ide-types.js';
import { resolveIdeOptionHelp, tryGetAdapter } from '../../services/ide/ide-registry.js';
import { interpreterArgs } from '../../services/web/daemon-supervisor.js';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';

/** This file's directory — `<root>/src/cli/commands` or `<root>/dist/cli/commands`. */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
/** `<root>/src` or `<root>/dist`. */
const TREE_DIR = resolve(MODULE_DIR, '..', '..');
/** Compiled trees run `.js` under node; the source tree is TypeScript. */
const SOURCE_TREE = extname(fileURLToPath(import.meta.url)) === '.ts';

/** Absolute path of the MCP server's process entry. */
export function mcpServerEntryPath(): string {
  return join(TREE_DIR, 'services', 'mcp', SOURCE_TREE ? 'server-main.ts' : 'server-main.js');
}

/** The exact command this launcher will spawn, resolved without spawning it. */
export function mcpServeInvocation(entry: string = mcpServerEntryPath()): {
  command: string;
  args: string[];
} {
  return { command: process.execPath, args: interpreterArgs(entry) };
}

interface McpServeOptions {
  project?: string;
  json?: boolean;
}

/**
 * Hand the process over to the MCP server: the child inherits all three standard
 * streams, so the harness's stdin/stdout pipe IS the server's pipe and this
 * process adds a frame of indirection and nothing else.
 */
function runMcpServe(io: ProgramIO, options: McpServeOptions): void {
  const invocation = mcpServeInvocation();
  const child = spawn(invocation.command, invocation.args, {
    stdio: 'inherit',
    cwd: options.project ?? process.cwd(),
    // Windows contract: a spawned child must not allocate a console window.
    windowsHide: true
  });
  child.on('error', (error: Error) => {
    printResult(
      io,
      fail(
        'mcp.serve',
        'MCP_SERVE_SPAWN_FAILED',
        `Could not start the MCP server: ${error.message}`,
        {
          entry: invocation.args.at(-1) ?? ''
        },
        ['Check that the build is present, or run `pnpm build`']
      ),
      options.json === true
    );
    process.exitCode = 1;
  });
  child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    // The child's status IS this command's status — an MCP client reads the
    // server's exit, so masking it would be the only lie this launcher told.
    if (signal !== null) {
      process.exitCode = 1;
      return;
    }
    process.exitCode = code ?? 0;
  });
}

export function registerMcpCommands(program: Command, io: ProgramIO): void {
  const mcp = program
    .command('mcp')
    .description('Serve peaks-loop read-only capabilities over MCP (stdio)');

  mcp
    .command('serve')
    .description('Run the read-only MCP server on stdio until the caller closes it')
    .option('--project <path>', 'project the server runs the CLI in (default: current directory)')
    .action((options: McpServeOptions) => {
      runMcpServe(io, options);
    });

  registerMcpRegistrationCommands(mcp, io);
}

interface McpRegistrationOptions {
  ide?: string;
  json?: boolean;
}

/**
 * The harness this command targets: `--ide` when given, else the same context
 * detection the hook commands use. An id with no registered adapter is reported
 * as unsupported rather than silently treated as "nothing to do" — the two are
 * different facts and only one of them is the caller's fault.
 */
type TargetAdapter =
  | { readonly kind: 'adapter'; readonly adapter: IdeAdapter }
  | { readonly kind: 'unsupported'; readonly ide: string };

function resolveTargetAdapter(options: McpRegistrationOptions): TargetAdapter {
  const ide =
    options.ide !== undefined && options.ide.length > 0
      ? options.ide
      : detectIdeFromContext({ env: process.env, cwd: process.cwd(), parsedStdin: null });
  const adapter = tryGetAdapter(ide);
  return adapter === undefined ? { kind: 'unsupported', ide } : { kind: 'adapter', adapter };
}

/** One envelope line per adapter: what was registered, or why nothing was. */
function reportRegistration(
  result: AdapterMcpInstallResult,
  verb: 'install' | 'uninstall'
): string {
  if (result.skipped) {
    return `${result.ideId}: skipped — ${result.reason}`;
  }
  const { report } = result;
  return `${result.ideId}: ${verb} ${report.ok ? 'ok' : 'FAILED'} — ${report.detail}`;
}

/** The `data` BOTH envelopes carry, so the failure path is never a thinner shape. */
function registrationEnvelopeData(
  result: AdapterMcpInstallResult,
  verb: 'install' | 'uninstall'
): {
  readonly ide: string;
  readonly skipped: boolean;
  readonly summary: string;
  readonly registration: AdapterMcpInstallResult;
} {
  return {
    ide: result.ideId,
    skipped: result.skipped,
    summary: reportRegistration(result, verb),
    registration: result
  };
}

function runMcpRegistration(
  io: ProgramIO,
  verb: 'install' | 'uninstall',
  options: McpRegistrationOptions
): void {
  const target = resolveTargetAdapter(options);
  if (target.kind === 'unsupported') {
    printResult(
      io,
      fail(
        `mcp.${verb}`,
        'MCP_HARNESS_UNSUPPORTED',
        `No adapter is registered for harness '${target.ide}'.`,
        { ide: target.ide },
        ['Pass --ide with a registered adapter id']
      ),
      options.json === true
    );
    process.exitCode = 1;
    return;
  }
  const { adapter } = target;

  const serverArgv = resolveMcpServerArgv();
  const result =
    verb === 'install'
      ? installMcpForAdapter(adapter, serverArgv, spawnMcpInstallRunner)
      : uninstallMcpForAdapter(adapter, serverArgv, spawnMcpInstallRunner);
  const report = result.skipped ? undefined : result.report;
  if (report !== undefined && !report.ok) {
    printResult(
      io,
      fail(
        `mcp.${verb}`,
        'MCP_REGISTRATION_FAILED',
        report.detail,
        registrationEnvelopeData(result, verb),
        ['Run the harness command by hand to see its own error']
      ),
      options.json === true
    );
    process.exitCode = 1;
    return;
  }
  printResult(io, ok(`mcp.${verb}`, registrationEnvelopeData(result, verb)), options.json === true);
}

/**
 * `peaks mcp install` / `peaks mcp uninstall` — the distribution half of the MCP
 * surface, and an explicit pair on purpose (spec §8.3 Q19): an uninstall that
 * only ran from a package manager's hook is skipped whenever the manager decides
 * to skip it, and the leftover registration then makes the NEXT install fail on
 * a duplicate. Neither command starts a process; they register one.
 */
function registerMcpRegistrationCommands(mcp: Command, io: ProgramIO): void {
  mcp
    .command('install')
    .description(
      'Register the peaks MCP server with the detected harness. Removes the name ' +
        'from every declared scope first, because the harness registers non-idempotently. ' +
        'A harness whose adapter declares no registration entry is skipped, not failed.'
    )
    .option('--ide <id>', resolveIdeOptionHelp())
    .option('--json', 'JSON envelope output')
    .action((options: McpRegistrationOptions) => {
      runMcpRegistration(io, 'install', options);
    });

  mcp
    .command('uninstall')
    .description(
      'Remove the peaks MCP registration from the harness, sweeping every scope it ' +
        'may hold. Explicit, because no package-manager hook is relied on.'
    )
    .option('--ide <id>', resolveIdeOptionHelp())
    .option('--json', 'JSON envelope output')
    .action((options: McpRegistrationOptions) => {
      runMcpRegistration(io, 'uninstall', options);
    });
}

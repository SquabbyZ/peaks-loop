import { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, getErrorMessage, type ProgramIO } from '../cli-helpers.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { buildStatusLineModel, parseStatusLineStdin } from '../../services/skills/skill-statusline-service.js';
import { renderStatusLine } from '../../services/skills/skill-statusline-renderer.js';
import {
  applyStatusLineInstall,
  planStatusLineInstall,
  removeStatusLineInstall,
  type StatusLineScope
} from '../../services/skills/statusline-settings-service.js';
import { readHookStatus as readSettingsStatus } from '../../services/skills/hooks-settings-service.js';
import { detectIdeFromContext } from '../../services/ide/hook-translator.js';
import type { IdeId } from '../../services/ide/ide-types.js';

const STDIN_READ_TIMEOUT_MS = 250;

/** Read piped stdin if present; resolve quickly with '' when attached to a TTY. */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve(data);
    };
    const timer = setTimeout(finish, STDIN_READ_TIMEOUT_MS);
    timer.unref?.();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      finish();
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      finish();
    });
  });
}

function resolveScope(options: { global?: boolean }): StatusLineScope {
  return options.global ? 'global' : 'project';
}

/**
 * Resolve the IDE the install should target. The CLI user can override with
 * `--ide <id>`. Otherwise we delegate to `detectIdeFromContext` which checks
 * `process.env[adapter.envVar]` → stdin shape → cwd `.trae`/`.claude` →
 * fallback `'claude-code'`. Pass `parsedStdin: null` since `peaks statusline
 * install` is not invoked from inside an IDE hook — there's no stdin payload.
 */
function resolveIdeForCommand(options: { ide?: string }, projectRoot: string | undefined): IdeId {
  if (options.ide !== undefined && options.ide.length > 0) {
    return options.ide as IdeId;
  }
  return detectIdeFromContext({ env: process.env, cwd: projectRoot ?? process.cwd(), parsedStdin: null });
}

type InstallOptions = { global?: boolean; project?: string; force?: boolean; dryRun?: boolean; json?: boolean; ide?: string };
type UninstallOptions = { global?: boolean; project?: string; json?: boolean; ide?: string };
type StatusOptions = { global?: boolean; project?: string; json?: boolean; ide?: string };
type RenderOptions = { project?: string; json?: boolean };

/**
 * Default-statusline render body. Reused by both the top-level default
 * action (Bug-02 dispatch) and the explicit `render` subcommand. Exported
 * so a unit test can exercise the JSON / text output paths without going
 * through commander.
 */
export async function runDefaultStatuslineRender(
  options: RenderOptions,
  io: ProgramIO
): Promise<void> {
  const raw = await readStdin();
  const stdin = parseStatusLineStdin(raw);
  const seeded = options.project
    ? { ...(stdin ?? {}), workspace: { current_dir: options.project } }
    : stdin;
  const model = buildStatusLineModel(seeded, Date.now());
  const text = renderStatusLine(model);
  if (options.json === true) {
    io.stdout(JSON.stringify({ ok: true, command: 'statusline.render', data: { text } }, null, 2));
    return;
  }
  io.stdout(text);
}

export function registerStatusLineCommands(program: Command, io: ProgramIO): void {
  // Top-level `peaks statusline` — register as a group with subcommands
  // (install | uninstall | status). When the user runs `peaks statusline` with
  // no subcommand, commander falls back to a hidden render subcommand so the
  // status line still renders. This pattern is required by commander 12.x:
  // when a command has both an action AND subcommands, commander's option
  // parser conflates the parent's options with the subcommand's and drops
  // flags. Routing through a subcommand (even one that's hidden) avoids the
  // option-shadowing bug.
  const statusline = addJsonOption(
    program
      .command('statusline')
      .description('Render the Peaks skill status line for the current session, or manage the adapter-driven statusLine entry. Run with no subcommand to render; with a subcommand (install | uninstall | status) to manage.')
      .option('--project <path>', 'project root path (used to label the status line when stdin is absent; applies to the default render path)')
  );

  // Default behavior: when the user types `peaks statusline` with no
  // subcommand, render the status line. Without this default action,
  // commander falls back to printing usage (Bug-02, ice-cola surface check
  // 2026-07-22). The hidden `render` subcommand is preserved so callers
  // can still invoke it explicitly.
  //
  // Note (commander 12.x): when both a top-level `.action(...)` and
  // subcommands exist, commander's option parser can conflate parent and
  // child flags. We therefore parse `process.argv` for the bare `statusline`
  // invocation here, and otherwise let the subcommand machinery handle the
  // rest. The implementation is wrapped in `peekDefaultStatuslineRender` so
  // it can be exercised in isolation by unit tests.
  statusline.action(async (_parentOptions: RenderOptions, command: Command) => {
    await runDefaultStatuslineRender(command.opts() as RenderOptions, io);
  });

  // Hidden render subcommand. Preserved for callers that want to invoke
  // render explicitly without going through the default-action dispatch.
  statusline
    .command('render', { hidden: true })
    .description('Render the Peaks skill status line for the current session (reads session JSON on stdin; honors --project for the project label).')
    .option('--project <path>', 'project root path (used to label the status line when stdin is absent)')
    .action(async (options: RenderOptions) => {
      await runDefaultStatuslineRender(options, io);
    });

  addJsonOption(
    statusline
      .command('install')
      .description("Install the Peaks status line into the adapter's settings.json (project scope by default).")
      .option('--global', 'install into the user-level ~/.claude/settings.json instead of the project')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option('--ide <id>', 'target adapter id (claude-code | trae); default: auto-detect from env/cwd')
      .option('--force', 'overwrite an existing non-Peaks statusLine entry')
      .option('--dry-run', 'show what would change without writing')
  ).action((options: InstallOptions) => {
    const scope = resolveScope(options);
    const projectRoot = scope === 'project'
      ? (options.project ?? findProjectRoot(process.cwd()) ?? process.cwd())
      : undefined;
    const ide = resolveIdeForCommand(options, projectRoot);
    try {
      if (options.dryRun) {
        const plan = planStatusLineInstall(scope, projectRoot, { ide });
        const warnings = plan.conflict
          ? [`An existing statusLine command is set: ${plan.conflictCommand}. Rerun with --force to overwrite.`]
          : [];
        printResult(io, ok('statusline.install', { ...plan, ide, applied: false, dryRun: true }, warnings), options.json);
        return;
      }
      const result = applyStatusLineInstall(scope, projectRoot, { force: options.force === true, ide });
      const warnings = result.conflict && !result.applied
        ? [`An existing statusLine command is set: ${result.conflictCommand}. Rerun with --force to overwrite.`]
        : [];
      const nextActions = result.applied
        ? ['Restart the IDE (or reload the workspace) so the status line takes effect']
        : [];
      printResult(io, ok('statusline.install', { ...result, ide, dryRun: false }, warnings, nextActions), options.json);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      printResult(io, fail('statusline.install', 'STATUSLINE_INSTALL_FAILED', message, { scope, ide, applied: false }, [message]), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    statusline
      .command('uninstall')
      .description("Remove the Peaks status line from the adapter's settings.json.")
      .option('--global', 'remove from the user-level ~/.claude/settings.json instead of the project')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option('--ide <id>', 'target adapter id (claude-code | trae); default: auto-detect from env/cwd')
  ).action((options: UninstallOptions) => {
    const scope = resolveScope(options);
    const projectRoot = scope === 'project'
      ? (options.project ?? findProjectRoot(process.cwd()) ?? process.cwd())
      : undefined;
    const ide = resolveIdeForCommand(options, projectRoot);
    try {
      const result = removeStatusLineInstall(scope, projectRoot, { ide });
      printResult(io, ok('statusline.uninstall', { ...result, ide }), options.json);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      printResult(io, fail('statusline.uninstall', 'STATUSLINE_UNINSTALL_FAILED', message, { scope, ide, removed: false }, [message]), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    statusline
      .command('status')
      .description('Report whether the Peaks status line is installed in the adapter settings.json.')
      .option('--global', 'inspect the user-level ~/.claude/settings.json instead of the project')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option('--ide <id>', 'target adapter id (claude-code | trae); default: auto-detect from env/cwd')
  ).action((options: StatusOptions) => {
    const scope = resolveScope(options);
    const projectRoot = scope === 'project'
      ? (options.project ?? findProjectRoot(process.cwd()) ?? process.cwd())
      : undefined;
    const ide = resolveIdeForCommand(options, projectRoot);
    try {
      const status = readSettingsStatus(scope, projectRoot, { ide });
      printResult(io, ok('statusline.status', { ...status, ide, command: 'peaks statusline' }), options.json);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      printResult(io, fail('statusline.status', 'STATUSLINE_STATUS_FAILED', message, { scope, ide }, [message]), options.json);
      process.exitCode = 1;
    }
  });
}

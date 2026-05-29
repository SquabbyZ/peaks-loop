import { Command } from 'commander';
import { fail, ok } from '../../shared/result.js';
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

export function registerStatusLineCommands(program: Command, io: ProgramIO): void {
  const statusline = program
    .command('statusline')
    .description('Render the Peaks skill status line for Claude Code (reads session JSON on stdin)')
    .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
    .action(async (options: { project?: string }) => {
      const raw = await readStdin();
      const stdin = parseStatusLineStdin(raw);
      // When a project override is passed (or no stdin), seed cwd so detection works.
      const seeded = options.project
        ? { ...(stdin ?? {}), workspace: { current_dir: options.project } }
        : stdin;
      const model = buildStatusLineModel(seeded, Date.now());
      io.stdout(renderStatusLine(model));
    });

  addJsonOption(
    statusline
      .command('install')
      .description('Install the Peaks status line into .claude/settings.json (project scope by default)')
      .option('--global', 'install into the user-level ~/.claude/settings.json instead of the project')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option('--force', 'overwrite an existing non-Peaks statusLine entry')
      .option('--dry-run', 'show what would change without writing')
  ).action((options: { global?: boolean; project?: string; force?: boolean; dryRun?: boolean; json?: boolean }) => {
    const scope = resolveScope(options);
    const projectRoot = scope === 'project'
      ? (options.project ?? findProjectRoot(process.cwd()) ?? process.cwd())
      : undefined;
    try {
      if (options.dryRun) {
        const plan = planStatusLineInstall(scope, projectRoot);
        const warnings = plan.conflict
          ? [`An existing statusLine command is set: ${plan.conflictCommand}. Rerun with --force to overwrite.`]
          : [];
        printResult(io, ok('statusline.install', { ...plan, applied: false, dryRun: true }, warnings), options.json);
        return;
      }
      const result = applyStatusLineInstall(scope, projectRoot, options.force ? { force: true } : {});
      const warnings = result.conflict && !result.applied
        ? [`An existing statusLine command is set: ${result.conflictCommand}. Rerun with --force to overwrite.`]
        : [];
      const nextActions = result.applied
        ? ['Restart Claude Code (or reload the window) so the status line takes effect']
        : [];
      printResult(io, ok('statusline.install', { ...result, dryRun: false }, warnings, nextActions), options.json);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      printResult(io, fail('statusline.install', 'STATUSLINE_INSTALL_FAILED', message, { scope, applied: false }, [message]), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    statusline
      .command('uninstall')
      .description('Remove the Peaks status line from .claude/settings.json')
      .option('--global', 'remove from the user-level ~/.claude/settings.json instead of the project')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
  ).action((options: { global?: boolean; project?: string; json?: boolean }) => {
    const scope = resolveScope(options);
    const projectRoot = scope === 'project'
      ? (options.project ?? findProjectRoot(process.cwd()) ?? process.cwd())
      : undefined;
    try {
      const result = removeStatusLineInstall(scope, projectRoot);
      printResult(io, ok('statusline.uninstall', result), options.json);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      printResult(io, fail('statusline.uninstall', 'STATUSLINE_UNINSTALL_FAILED', message, { scope, removed: false }, [message]), options.json);
      process.exitCode = 1;
    }
  });
}

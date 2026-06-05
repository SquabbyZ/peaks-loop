import { Command } from 'commander';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, printResult, getErrorMessage, type ProgramIO } from '../cli-helpers.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import {
  applyHookInstall,
  PEAKS_HOOK_ENTRIES,
  planHookInstall,
  readHookStatus,
  removeHookInstall,
  type HookScope
} from '../../services/skills/hooks-settings-service.js';

type HookCliOptions = { global?: boolean; project?: string; dryRun?: boolean; json?: boolean };

function resolveScope(options: { global?: boolean }): HookScope {
  return options.global ? 'global' : 'project';
}

function resolveProjectRoot(scope: HookScope, project: string | undefined): string | undefined {
  return scope === 'project' ? (project ?? findProjectRoot(process.cwd()) ?? process.cwd()) : undefined;
}

export function registerHooksCommands(program: Command, io: ProgramIO): void {
  const hooks = program
    .command('hooks')
    .description(
      'Manage the Peaks PreToolUse hooks in .claude/settings.json: (1) Bash→peaks gate enforce (SOP gate), (2) Task→peaks progress start (auto-spawn sub-agent progress terminal). Both are installed / removed together.'
    );

  addJsonOption(
    hooks
      .command('install')
      .description(
        `Install all peaks-managed PreToolUse hooks (${PEAKS_HOOK_ENTRIES.map((e) => e.matcher).join(', ')}) into the target .claude/settings.json. Idempotent: re-runs are no-ops. Project scope by default.`
      )
      .option('--global', 'install into the user-level ~/.claude/settings.json instead of the project')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option('--dry-run', 'show what would change without writing')
  ).action((options: HookCliOptions) => {
    const scope = resolveScope(options);
    const projectRoot = resolveProjectRoot(scope, options.project);
    try {
      if (options.dryRun === true) {
        const plan = planHookInstall(scope, projectRoot);
        printResult(
          io,
          ok(
            'hooks.install',
            {
              ...plan,
              applied: false,
              dryRun: true,
              entries: PEAKS_HOOK_ENTRIES.map((e) => ({ matcher: e.matcher, sentinel: e.sentinel }))
            },
            [],
            [`would install ${PEAKS_HOOK_ENTRIES.length} peaks-managed hook entries`]
          ),
          options.json
        );
        return;
      }
      const result = applyHookInstall(scope, projectRoot);
      const nextActions = result.applied
        ? [
            'Restart Claude Code (or reload the window) so the PreToolUse hooks take effect',
            `Installed: ${PEAKS_HOOK_ENTRIES.map((e) => `${e.matcher}→${e.sentinel}`).join(', ')}`
          ]
        : [];
      printResult(
        io,
        ok(
          'hooks.install',
          {
            ...result,
            dryRun: false,
            entries: PEAKS_HOOK_ENTRIES.map((e) => ({ matcher: e.matcher, sentinel: e.sentinel }))
          },
          [],
          nextActions
        ),
        options.json
      );
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      printResult(io, fail('hooks.install', 'HOOKS_INSTALL_FAILED', message, { scope, applied: false }, [message]), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    hooks
      .command('uninstall')
      .description(
        'Remove all peaks-managed PreToolUse hooks (gate-enforce + progress-start) from the target .claude/settings.json. Third-party hooks are preserved.'
      )
      .option('--global', 'remove from the user-level ~/.claude/settings.json instead of the project')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
  ).action((options: HookCliOptions) => {
    const scope = resolveScope(options);
    const projectRoot = resolveProjectRoot(scope, options.project);
    try {
      const result = removeHookInstall(scope, projectRoot);
      printResult(io, ok('hooks.uninstall', result), options.json);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      printResult(io, fail('hooks.uninstall', 'HOOKS_UNINSTALL_FAILED', message, { scope, removed: false }, [message]), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    hooks
      .command('status')
      .description('Report which peaks-managed PreToolUse hooks are installed (gate-enforce + progress-start).')
      .option('--global', 'inspect the user-level ~/.claude/settings.json instead of the project')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
  ).action((options: HookCliOptions) => {
    const scope = resolveScope(options);
    const projectRoot = resolveProjectRoot(scope, options.project);
    try {
      const status = readHookStatus(scope, projectRoot);
      printResult(
        io,
        ok('hooks.status', {
          ...status,
          entries: PEAKS_HOOK_ENTRIES.map((e) => ({ matcher: e.matcher, sentinel: e.sentinel }))
        }),
        options.json
      );
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      printResult(io, fail('hooks.status', 'HOOKS_STATUS_FAILED', message, { scope }, [message]), options.json);
      process.exitCode = 1;
    }
  });
}

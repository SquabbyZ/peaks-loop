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
import { detectIdeFromContext } from '../../services/ide/hook-translator.js';
import { getAdapter } from '../../services/ide/ide-registry.js';
import type { IdeId } from '../../services/ide/ide-types.js';

type HookCliOptions = { global?: boolean; project?: string; dryRun?: boolean; json?: boolean; ide?: string };

function resolveScope(options: { global?: boolean }): HookScope {
  return options.global ? 'global' : 'project';
}

function resolveProjectRoot(scope: HookScope, project: string | undefined): string | undefined {
  return scope === 'project' ? (project ?? findProjectRoot(process.cwd()) ?? process.cwd()) : undefined;
}

/**
 * Resolve the IDE the install should target. The CLI user can override with
 * `--ide <id>`. Otherwise we delegate to `detectIdeFromContext` which checks
 * `process.env[adapter.envVar]` → stdin shape → cwd `.trae`/`.claude` →
 * fallback `'claude-code'`. Pass `parsedStdin: null` since `peaks hooks
 * install` is not invoked from inside an IDE hook — there's no stdin payload.
 */
function resolveIdeForCommand(options: { ide?: string }, projectRoot: string | undefined): IdeId {
  if (options.ide !== undefined && options.ide.length > 0) {
    return options.ide as IdeId;
  }
  return detectIdeFromContext({ env: process.env, cwd: projectRoot ?? process.cwd(), parsedStdin: null });
}

// Slice #3: compute the per-IDE peaks hook entries for the CLI response
// summary. Replaces the slice #1 PEAKS_HOOK_ENTRIES constant which was
// hardcoded to claude-code values.
function listInstalledEntriesForIde(ide: IdeId): ReadonlyArray<{ matcher: string; sentinel: string }> {
  const adapter = getAdapter(ide);
  if (ide === 'trae') {
    return [
      { matcher: adapter.toolMatcher, sentinel: 'peaks hook handle' },
      { matcher: 'Task', sentinel: 'peaks progress start' }
    ];
  }
  // Default (claude-code) and any future registered adapters.
  return PEAKS_HOOK_ENTRIES.map((e) => ({ matcher: e.matcher, sentinel: e.sentinel }));
}

export function registerHooksCommands(program: Command, io: ProgramIO): void {
  const hooks = program
    .command('hooks')
    .description(
      "Manage the Peaks-managed hook entries in the adapter's settings.json (default: .claude/settings.json for Claude, .trae/settings.json for Trae): (1) gate-enforce hook (SOP gate), (2) progress-start hook (auto-spawn sub-agent progress terminal). Both are installed / removed together. The IDE is auto-detected from env / cwd; override with --ide <id>."
    );

  addJsonOption(
    hooks
      .command('install')
      .description(
        `Install all peaks-managed hook entries into the adapter's settings.json. Idempotent: re-runs are no-ops. Project scope by default.`
      )
      .option('--global', 'install into the user-level ~/.claude/settings.json instead of the project')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option('--ide <id>', "target adapter id (claude-code | trae); default: auto-detect from env/cwd")
      .option('--dry-run', 'show what would change without writing')
  ).action((options: HookCliOptions) => {
    const scope = resolveScope(options);
    const projectRoot = resolveProjectRoot(scope, options.project);
    const ide = resolveIdeForCommand(options, projectRoot);
    try {
      if (options.dryRun === true) {
        const plan = planHookInstall(scope, projectRoot, { ide });
        printResult(
          io,
          ok(
            'hooks.install',
            {
              ...plan,
              ide,
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
      const result = applyHookInstall(scope, projectRoot, { ide });
      // Slice #3: build the per-IDE entries summary from the actual installed
      // entries, not the slice #1 PEAKS_HOOK_ENTRIES constant (which is the
      // claude-code default). The user's JSON envelope must reflect the IDE
      // they targeted.
      const installedEntries = listInstalledEntriesForIde(ide);
      const nextActions = result.applied
        ? [
            'Restart the IDE (or reload the workspace) so the hook entries take effect',
            `Installed: ${installedEntries.map((e) => `${e.matcher}→${e.sentinel}`).join(', ')}`
          ]
        : [];
      printResult(
        io,
        ok(
          'hooks.install',
          {
            ...result,
            ide,
            dryRun: false,
            entries: installedEntries.map((e) => ({ matcher: e.matcher, sentinel: e.sentinel }))
          },
          [],
          nextActions
        ),
        options.json
      );
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      printResult(io, fail('hooks.install', 'HOOKS_INSTALL_FAILED', message, { scope, ide, applied: false }, [message]), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    hooks
      .command('uninstall')
      .description("Remove all peaks-managed hook entries (gate-enforce + progress-start) from the target settings.json. Third-party hooks are preserved.")
      .option('--global', 'remove from the user-level ~/.claude/settings.json instead of the project')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option('--ide <id>', 'target adapter id (claude-code | trae); default: auto-detect from env/cwd')
  ).action((options: HookCliOptions) => {
    const scope = resolveScope(options);
    const projectRoot = resolveProjectRoot(scope, options.project);
    const ide = resolveIdeForCommand(options, projectRoot);
    try {
      const result = removeHookInstall(scope, projectRoot, { ide });
      printResult(io, ok('hooks.uninstall', { ...result, ide }), options.json);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      printResult(io, fail('hooks.uninstall', 'HOOKS_UNINSTALL_FAILED', message, { scope, ide, removed: false }, [message]), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    hooks
      .command('status')
      .description('Report which peaks-managed hook entries are installed.')
      .option('--global', 'inspect the user-level ~/.claude/settings.json instead of the project')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option('--ide <id>', 'target adapter id (claude-code | trae); default: auto-detect from env/cwd')
  ).action((options: HookCliOptions) => {
    const scope = resolveScope(options);
    const projectRoot = resolveProjectRoot(scope, options.project);
    const ide = resolveIdeForCommand(options, projectRoot);
    try {
      const status = readHookStatus(scope, projectRoot, { ide });
      printResult(
        io,
        ok('hooks.status', {
          ...status,
          ide,
          entries: PEAKS_HOOK_ENTRIES.map((e) => ({ matcher: e.matcher, sentinel: e.sentinel }))
        }),
        options.json
      );
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      printResult(io, fail('hooks.status', 'HOOKS_STATUS_FAILED', message, { scope, ide }, [message]), options.json);
      process.exitCode = 1;
    }
  });
}

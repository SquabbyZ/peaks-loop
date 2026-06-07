import { existsSync } from 'node:fs';
import { Command } from 'commander';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, printResult, getErrorMessage, type ProgramIO } from '../cli-helpers.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import {
  applyHookInstall,
  planHookInstall,
  readHookStatus,
  readInstalledEntriesFromSettings,
  removeHookInstall,
  type HookScope
} from '../../services/skills/hooks-settings-service.js';
import { readJsonObjectFile } from '../../services/ide/shared/atomic-json.js';
import { detectIdeFromContext } from '../../services/ide/hook-translator.js';
import { getAdapter } from '../../services/ide/ide-registry.js';
import type { IdeId } from '../../services/ide/ide-types.js';

type HookCliOptions = { global?: boolean; project?: string; dryRun?: boolean; json?: boolean; ide?: string; progress?: boolean };

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

/**
 * Slice #014: compute the per-IDE peaks hook entries for the install /
 * dry-run RESPONSE SUMMARY. This is the *desired* shape (what the install
 * WOULD write), not what is on disk. The status command uses a different
 * helper (`readInstalledEntriesFromSettings`) that reads the actual
 * settings.json.
 *
 * After slice #014 only the gate-enforce entry is ever installed
 * (the legacy progress-start surface is gone). The summary mirrors
 * the install shape so the JSON envelope doesn't claim a hook the
 * service did not write.
 */
function listExpectedEntriesForIde(ide: IdeId, _skipProgress = false): ReadonlyArray<{ matcher: string; sentinel: string }> {
  const adapter = getAdapter(ide);
  if (ide === 'trae') {
    return [{ matcher: adapter.toolMatcher, sentinel: 'peaks hook handle' }];
  }
  return [{ matcher: adapter.toolMatcher, sentinel: 'peaks gate enforce' }];
}

export function registerHooksCommands(program: Command, io: ProgramIO): void {
  const hooks = program
    .command('hooks')
    .description(
      "Manage the Peaks-managed hook entry in the adapter's settings.json (default: .claude/settings.json for Claude, .trae/settings.json for Trae). Slice #014: the only installed entry is the gate-enforce hook (SOP gate). The legacy progress-start hook (auto-spawn sub-agent progress terminal) is no longer installed — sub-agent progress is now surfaced via the dispatch + heartbeat flow (`peaks sub-agent dispatch` / `peaks sub-agent heartbeat`). The IDE is auto-detected from env / cwd; override with --ide <id>."
    );

  addJsonOption(
    hooks
      .command('install')
      .description(
        `Install the peaks-managed gate-enforce hook entry into the adapter's settings.json. Slice #014: only the gate-enforce entry is installed; the legacy progress-start entry is no longer installed. Idempotent: re-runs are no-ops. Project scope by default.`
      )
      .option('--global', 'install into the user-level ~/.claude/settings.json instead of the project')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option('--ide <id>', "target adapter id (claude-code | trae); default: auto-detect from env/cwd")
      .option('--dry-run', 'show what would change without writing')
      .option('--no-progress', 'skip the progress-start PreToolUse hook entry; install ONLY the gate-enforce entry')
  ).action((options: HookCliOptions) => {
    const scope = resolveScope(options);
    const projectRoot = resolveProjectRoot(scope, options.project);
    const ide = resolveIdeForCommand(options, projectRoot);
    const skipProgress = options.progress === false;
    try {
      if (options.dryRun === true) {
        const plan = planHookInstall(scope, projectRoot, { ide, skipProgress });
        const dryRunEntries = listExpectedEntriesForIde(ide, skipProgress);
        printResult(
          io,
          ok(
            'hooks.install',
            {
              ...plan,
              ide,
              applied: false,
              dryRun: true,
              skipProgress,
              entries: dryRunEntries
            },
            [],
            [`would install ${dryRunEntries.length} peaks-managed hook entries`]
          ),
          options.json
        );
        return;
      }
      const result = applyHookInstall(scope, projectRoot, { ide, skipProgress });
      // Slice #3: build the per-IDE entries summary from the actual installed
      // entries, not the slice #1 PEAKS_HOOK_ENTRIES constant (which is the
      // claude-code default). The user's JSON envelope must reflect the IDE
      // they targeted. Slice #014: the install only emits the gate-enforce
      // entry; the summary mirrors the install shape, NOT a hardcoded
      // expected list.
      const installedEntries = listExpectedEntriesForIde(ide, skipProgress);
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
            skipProgress,
            entries: installedEntries.map((e) => ({ matcher: e.matcher, sentinel: e.sentinel }))
          },
          [],
          nextActions
        ),
        options.json
      );
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      printResult(io, fail('hooks.install', 'HOOKS_INSTALL_FAILED', message, { scope, ide, applied: false, skipProgress }, [message]), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    hooks
      .command('uninstall')
      .description("Remove the peaks-managed gate-enforce hook entry from the target settings.json. Any legacy progress-start entry that a pre-#014 install left behind is also removed (sentinel-based scan). Third-party hooks are preserved.")
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
      // Slice #014: read the ACTUAL on-disk entries (post-install shape),
      // not the IDE-EXPECTED list. Pre-#014 `listInstalledEntriesForIde`
      // returned the expected list and reported `entries: [Bash, Task]`
      // even when the file only had `Bash`. The new helper reads the
      // file and reports whatever peaks-managed entries are present,
      // including any legacy progress-start entry that a pre-#014
      // install left behind.
      const settingsPath = status.settingsPath;
      const settings = existsSync(settingsPath) ? readJsonObjectFile(settingsPath) : {};
      printResult(
        io,
        ok('hooks.status', {
          ...status,
          ide,
          entries: readInstalledEntriesFromSettings(settings, ide)
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

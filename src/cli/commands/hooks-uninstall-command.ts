// src/cli/commands/hooks-uninstall-command.ts
//
// `peaks hooks uninstall` — remove the peaks-managed hook entries (the whole
// set the install writes, plus a legacy progress-start entry an install from
// before slice #014 left behind). Split out of `hooks-commands.ts`; the verb
// name, its options and the envelope shape are unchanged.

import type { Command } from 'commander';
import {
  listSuperpowersDenyEntries,
  removeHookInstall
} from '../../services/skills/hooks-settings-service.js';
import { resolveIdeOptionHelp } from '../../services/ide/ide-registry.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  resolveIdeForCommand,
  resolveProjectRoot,
  resolveScope,
  type HookCliOptions
} from './hooks-command-shared.js';

function runHooksUninstall(io: ProgramIO, options: HookCliOptions): void {
  const scope = resolveScope(options);
  const projectRoot = resolveProjectRoot(scope, options.project);
  const ide = resolveIdeForCommand(options, projectRoot);
  try {
    const result = removeHookInstall(scope, projectRoot, { ide });
    // bookkeeping. `permissionsDenyRemoved` mirrors `removed` (the
    // service strips deny entries on the same atomic write that
    // strips the hook entries; they share the same boolean).
    printResult(
      io,
      ok('hooks.uninstall', {
        ...result,
        ide,
        permissionsDenyRemoved: result.removed,
        permissionsDenyEntries: listSuperpowersDenyEntries()
      }),
      options.json
    );
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    printResult(
      io,
      fail('hooks.uninstall', 'HOOKS_UNINSTALL_FAILED', message, { scope, ide, removed: false }, [
        message
      ]),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerHooksUninstallCommand(hooks: Command, io: ProgramIO): void {
  addJsonOption(
    hooks
      .command('uninstall')
      .description(
        'Remove the peaks-managed hook entries from the target settings.json — for Claude Code: peaks gate enforce (Bash and MCP tool calls), peaks code-gate (Edit|Write|MultiEdit), peaks outer-cache write, peaks session primer, peaks session reinject, peaks compact settle — plus the Layer-3 permissions.deny entries (worktree governance); the other adapters remove their own single hook entry. A legacy progress-start entry left behind by an install from before slice #014 is removed too (sentinel-based scan). Third-party hooks are preserved.'
      )
      .option(
        '--global',
        'remove from the user-level ~/.claude/settings.json instead of the project'
      )
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option('--ide <id>', resolveIdeOptionHelp())
  ).action((options: HookCliOptions) => runHooksUninstall(io, options));
}

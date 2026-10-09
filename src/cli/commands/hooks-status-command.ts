// src/cli/commands/hooks-status-command.ts
//
// `peaks hooks status` — report which peaks-managed hook entries are installed.
// Split out of `hooks-commands.ts`; the verb name, its options, the
// "read the ACTUAL on-disk entries, not the expected list" ruling and the
// envelope shape are unchanged.

import { existsSync } from 'node:fs';
import type { Command } from 'commander';
import {
  listSuperpowersDenyEntries,
  readHookStatus,
  readInstalledEntriesFromSettings
} from '../../services/skills/hooks-settings-service.js';
import { readJsonObjectFile } from '../../services/ide/shared/atomic-json.js';
import { resolveIdeOptionHelp } from '../../services/ide/ide-registry.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  resolveIdeForCommand,
  resolveProjectRoot,
  resolveScope,
  type HookCliOptions
} from './hooks-command-shared.js';

/**
 * `permissions.deny` block from a settings.json object and return
 * every peaks-managed entry currently present. Used by `hooks status`
 * to surface Layer 3 governance state without forcing the caller to
 * re-read the file. Tolerant of missing / malformed `permissions` —
 * a missing field returns an empty array, never throws.
 */
function readOnDiskDenyEntries(settings: Record<string, unknown>): ReadonlyArray<string> {
  const permissions = settings.permissions;
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) return [];
  const deny = (permissions as Record<string, unknown>).deny;
  if (!Array.isArray(deny)) return [];
  return deny.filter((d): d is string => typeof d === 'string');
}

function runHooksStatus(io: ProgramIO, options: HookCliOptions): void {
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
    // The gate-enforce entry is materialized into the machine-local
    // settings file (see `resolveHookTargets`), so the on-disk entry list
    // must be read from both files or `status` would report it missing.
    const localSettings =
      status.localSettingsPath !== undefined && existsSync(status.localSettingsPath)
        ? readJsonObjectFile(status.localSettingsPath)
        : {};
    // entries actually on disk. We read the existing settings.json
    // (above) and surface its `permissions.deny` block. Any entry
    // that matches the current `SUPERPOWERS_DENIED_SKILLS` set is
    // considered "peaks-managed"; user-written entries are passed
    // through verbatim so the envelope reflects reality. The desired
    // list is also included for parity with install / uninstall.
    const onDiskDeny = readOnDiskDenyEntries(settings);
    // `status` reports the state of the world; for an IDE that cannot host a
    // hook the state of the world is "none, and none is possible". The exit
    // code stays 0 (the query succeeded) and the payload carries the finding
    // — `supportsHooks: false` on the data, plus a warning naming the IDE, so
    // the negative fact is not confused with "supported IDE, nothing
    // installed yet".
    const warnings = status.supportsHooks
      ? []
      : [
          `IDE '${ide}' cannot host peaks hooks (no HOOK_COMMAND_BY_IDE entry); nothing can be installed for it, which is why none is.`
        ];
    printResult(
      io,
      ok(
        'hooks.status',
        {
          ...status,
          ide,
          entries: [
            ...readInstalledEntriesFromSettings(settings, ide),
            ...readInstalledEntriesFromSettings(localSettings, ide)
          ],
          permissionsDenyEntries: listSuperpowersDenyEntries(),
          permissionsDenyOnDisk: onDiskDeny
        },
        warnings
      ),
      options.json
    );
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    printResult(
      io,
      fail('hooks.status', 'HOOKS_STATUS_FAILED', message, { scope, ide }, [message]),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerHooksStatusCommand(hooks: Command, io: ProgramIO): void {
  addJsonOption(
    hooks
      .command('status')
      .description('Report which peaks-managed hook entries are installed.')
      .option('--global', 'inspect the user-level ~/.claude/settings.json instead of the project')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option('--ide <id>', resolveIdeOptionHelp())
  ).action((options: HookCliOptions) => runHooksStatus(io, options));
}

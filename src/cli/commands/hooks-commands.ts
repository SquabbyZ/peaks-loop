import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, getErrorMessage, type ProgramIO } from '../cli-helpers.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import {
  applyHookInstall,
  planHookInstall,
  readHookStatus,
  readInstalledEntriesFromSettings,
  removeHookInstall,
  listSuperpowersDenyEntries,
  type HookScope
} from '../../services/skills/hooks-settings-service.js';
import {
  resolveHookEntries,
  resolveHookSpec
} from '../../services/skills/hooks-codegate-superpowers.js';
import { readJsonObjectFile } from '../../services/ide/shared/atomic-json.js';
import { detectIdeFromContext } from '../../services/ide/hook-translator.js';
import { resolveIdeOptionHelp } from '../../services/ide/ide-registry.js';
import type { IdeId } from '../../services/ide/ide-types.js';

type HookCliOptions = {
  global?: boolean;
  project?: string;
  dryRun?: boolean;
  json?: boolean;
  ide?: string;
  progress?: boolean;
};

/**
 * This module's own directory — `<root>/src/cli/commands` in the source tree,
 * `<root>/dist/cli/commands` in a build. Same reason as
 * `claude-settings-template.ts`: `package.json#type` is `module`, so the CJS
 * module-directory global does not exist here (it is a ReferenceError under
 * both tsx and the shipped `dist` build — see the guard in
 * `tests/unit/hooks/gate-enforce-machine-local-shell.test.ts`), and
 * `process.argv[1]` names a different file per entry point.
 */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

function resolveScope(options: { global?: boolean }): HookScope {
  return options.global ? 'global' : 'project';
}

function resolveProjectRoot(scope: HookScope, project: string | undefined): string | undefined {
  return scope === 'project'
    ? (project ?? findProjectRoot(process.cwd()) ?? process.cwd())
    : undefined;
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
  return detectIdeFromContext({
    env: process.env,
    cwd: projectRoot ?? process.cwd(),
    parsedStdin: null
  });
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
function listExpectedEntriesForIde(
  ide: IdeId,
  _skipProgress = false
): ReadonlyArray<{ matcher: string; sentinel: string }> {
  // Derived from `resolveHookEntries(ide)` — the same function `planHookInstall`
  // / `applyHookInstall` write from — so the summary can only ever report a
  // shape the install actually produces. The previous version was a
  // hand-written literal under a comment claiming it "mirrors the install
  // shape, NOT a hardcoded expected list" (diagnosis 2026-09-15, C4); the
  // literal had drifted from that claim in both directions: it re-typed the
  // code-gate matcher instead of reading `HOOK_CODE_GATE_MATCHER`, and it
  // reported 2 of the 6 entries a claude-code install writes.
  //
  // The filter is the tool-call event. `resolveHookEntries` also returns the
  // once-per-session SessionStart / PostCompact entries; those are not what a
  // per-call hook-entry summary is read for, and leaving them out is the only
  // place this summary is narrower than the install.
  const event = resolveHookSpec(ide).hookEnforceEvent;
  return resolveHookEntries(ide, _skipProgress)
    .filter((entry) => entry.event === event)
    .map((entry) => ({ matcher: entry.matcher, sentinel: entry.sentinel }));
}

/**
 * Slice 2026-07-24-peaks-code-bridge-002-rootcause (G6b / G10): copy the
 * superpowers-bridge hook source from the peaks-loop repo
 * (src/services/hooks/pre-tool-superpowers-bridge.sh) into the user-global
 * `<userHome>/.claude/skills/peaks-code/hooks/` directory. The user-global
 * copy is treated as a build artifact: it MUST be byte-identical to the
 * repo source after install, and the source of truth is the repo file.
 *
 * Why this lives in the install command: the install is the single
 * declared surface where the user-global directory is touched. Adding it
 * here keeps the "hooks only ship from src/services/hooks/" invariant
 * (G10 / AC10) — no other code path writes to `~/.claude/skills/peaks-code/hooks/`.
 *
 * Failure modes:
 *   - Source file missing (build not run yet) → silently skip and emit a
 *     warning. The settings.json install still succeeds; only the script
 *     distribution is skipped. Matches the "release-pack silent skip
 *     when tarball lacks dist/version.js" pattern from commit 08d93353.
 *   - Target directory unwritable → throw so the user knows.
 *   - Target file already exists with identical bytes → no-op.
 *   - Target file exists with different bytes → overwrite (the repo
 *     source is authoritative).
 *
 * Returns `{ copied, source, target }` so the install envelope can report
 * it without forcing the caller to inspect the filesystem.
 */
/**
 * Slice 2026-07-29-worktree-layer3-deny: read the on-disk
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

/**
 * One `nextActions` line for a hook-script copy, or `null` when there is
 * nothing to say.
 *
 * Diagnosis 2026-09-15 (C7): the copy failure used to be reported as a single
 * sentence — `'<x> hook not copied (source missing or non-global scope)'` —
 * which merged a real build failure into the expected project-scope no-op.
 * Only `scope === 'global'` copies these scripts at all (see the call sites),
 * so in project scope the sentence described normal behaviour in the wording
 * of a fault, and a healthy `peaks hooks install` read as broken.
 *
 * Scope is therefore what decides the sentence, and it is knowable here — the
 * copy helper cannot tell the two cases apart because both return
 * `copied: false`, but the caller can. Project scope emits no line: there is
 * no action to take, and the envelope's `bridgeHookCopy` / `codeGateHookCopy`
 * field still reports `copied: false` for anyone reading the JSON.
 */
function describeHookCopy(
  label: string,
  copy: { copied: boolean; source: string; target: string },
  scope: HookScope,
  dryRun: boolean
): string | null {
  if (scope !== 'global') return null;
  if (copy.copied) {
    return dryRun
      ? `would copy ${label} from ${copy.source} to ${copy.target}`
      : `Copied ${label}: ${copy.target}`;
  }
  return `${label} NOT copied — source missing at ${copy.source}. Run the build (\`pnpm build\`) so the script ships with the package.`;
}

function copyBridgeHookIfPresent(
  userHome: string,
  dryRun = false
): { copied: boolean; source: string; target: string } {
  const source = resolve(
    MODULE_DIR,
    '..',
    '..',
    'services',
    'hooks',
    'pre-tool-superpowers-bridge.sh'
  );
  const target = resolve(
    userHome,
    '.claude',
    'skills',
    'peaks-code',
    'hooks',
    'pre-tool-superpowers-bridge.sh'
  );
  if (!existsSync(source)) {
    return { copied: false, source, target };
  }
  if (dryRun) {
    return { copied: true, source, target };
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return { copied: true, source, target };
}

/**
 * Slice 2026-08-06-codegate-vendor-neutral: copy the code-gate hook
 * source (`src/services/hooks/pre-tool-code-gate.sh`) into the user-
 * global peaks-code hooks dir, mirroring the bridge-hook copy. The
 * hook itself is vendor-neutral (no `claude` / `anthropic` strings in
 * the script) — this installer is the vendor adapter that decides
 * where the file lands. The CLI command `peaks code-gate` is the
 * runtime entry; the shell script is the canonical artifact distributed
 * alongside the bridge hook.
 */
function copyCodeGateHookIfPresent(
  userHome: string,
  dryRun = false
): { copied: boolean; source: string; target: string } {
  const source = resolve(MODULE_DIR, '..', '..', 'services', 'hooks', 'pre-tool-code-gate.sh');
  const target = resolve(
    userHome,
    '.claude',
    'skills',
    'peaks-code',
    'hooks',
    'pre-tool-code-gate.sh'
  );
  if (!existsSync(source)) {
    return { copied: false, source, target };
  }
  if (dryRun) {
    return { copied: true, source, target };
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return { copied: true, source, target };
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
      .option(
        '--global',
        'install into the user-level ~/.claude/settings.json instead of the project'
      )
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option('--ide <id>', resolveIdeOptionHelp())
      .option('--dry-run', 'show what would change without writing')
      .option(
        '--no-progress',
        'skip the progress-start PreToolUse hook entry; install ONLY the gate-enforce entry'
      )
  ).action((options: HookCliOptions) => {
    const scope = resolveScope(options);
    const projectRoot = resolveProjectRoot(scope, options.project);
    const ide = resolveIdeForCommand(options, projectRoot);
    const skipProgress = options.progress === false;
    try {
      if (options.dryRun === true) {
        const plan = planHookInstall(scope, projectRoot, { ide, skipProgress });
        const dryRunEntries = listExpectedEntriesForIde(ide, skipProgress);
        // `dryRun: true` — a --dry-run must not write anything, and these
        // helpers' target is the user's home directory.
        const bridgeCopy =
          scope === 'global'
            ? copyBridgeHookIfPresent(process.env.USERPROFILE ?? process.env.HOME ?? '', true)
            : { copied: false, source: '', target: '' };
        // Slice 2026-08-06-codegate-vendor-neutral: also copy the
        // code-gate hook script. The runtime gate lives at
        // `peaks code-gate --json` (registered as a PreToolUse entry
        // in the install output); the script is the build artifact
        // distributed alongside the bridge hook.
        const codeGateCopy =
          scope === 'global'
            ? copyCodeGateHookIfPresent(process.env.USERPROFILE ?? process.env.HOME ?? '', true)
            : { copied: false, source: '', target: '' };
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
              entries: dryRunEntries,
              bridgeHookCopy: bridgeCopy,
              codeGateHookCopy: codeGateCopy,
              // Slice 2026-07-29-worktree-layer3-deny: surface the
              // Layer 3 deny entries the install WOULD write. The
              // dry-run branch never actually invokes
              // `applyHookInstall`, so the on-disk snapshot is not
              // consulted here — the list is the desired-state
              // constant for clarity in the JSON envelope.
              permissionsDenyEntries: listSuperpowersDenyEntries()
            },
            [],
            [
              `would install ${dryRunEntries.length} peaks-managed hook entries`,
              // Name the target file of every entry: the gate-enforce entry is
              // routed to the machine-local settings file (see
              // `resolveHookTargets`), so a summary that only listed
              // `settingsPath` + the entry names read as if it landed in the
              // committed, shared file.
              ...plan.entryTargets.map(
                (entry) =>
                  `would write ${entry.matcher || '(no matcher)'} → ${entry.sentinel} to ${entry.settingsPath}`
              ),
              `would write ${listSuperpowersDenyEntries().length} permissions.deny entries (Layer 3 worktree governance)`,
              describeHookCopy('bridge hook', bridgeCopy, scope, true),
              describeHookCopy('code-gate hook', codeGateCopy, scope, true)
            ].filter((line): line is string => line !== null)
          ),
          options.json
        );
        return;
      }
      const result = applyHookInstall(scope, projectRoot, { ide, skipProgress });
      // Slice #3: build the per-IDE entries summary for the IDE the user
      // targeted, not the slice #1 PEAKS_HOOK_ENTRIES constant (which is the
      // claude-code default). The summary is derived from the install's own
      // entry table — see `listExpectedEntriesForIde`.
      const installedEntries = listExpectedEntriesForIde(ide, skipProgress);
      // Slice 2026-07-24-peaks-code-bridge-002-rootcause (G6b / G10): when
      // the install targets global scope, also copy the superpowers-bridge
      // hook script from src/services/hooks/ to the user-global hooks
      // directory. Project scope does not need this — project's
      // .claude/skills/peaks-code is already a junction into the npm source.
      const bridgeCopy =
        scope === 'global'
          ? copyBridgeHookIfPresent(process.env.USERPROFILE ?? process.env.HOME ?? '')
          : { copied: false, source: '', target: '' };
      // Slice 2026-08-06-codegate-vendor-neutral: also copy the
      // code-gate hook script. The runtime gate lives at
      // `peaks code-gate --json` (registered as a PreToolUse entry
      // in the install output); the script is the build artifact
      // distributed alongside the bridge hook.
      const codeGateCopy =
        scope === 'global'
          ? copyCodeGateHookIfPresent(process.env.USERPROFILE ?? process.env.HOME ?? '')
          : { copied: false, source: '', target: '' };
      const nextActions = result.applied
        ? [
            'Restart the IDE (or reload the workspace) so the hook entries take effect',
            `Installed: ${installedEntries.map((e) => `${e.matcher}→${e.sentinel}`).join(', ')}`,
            // Slice 2026-07-29-worktree-layer3-deny: surface L3 deny
            // write alongside the hook install — single atomic write.
            `Layer 3 deny: wrote ${listSuperpowersDenyEntries().length} permissions.deny entries (worktree governance)`,
            describeHookCopy('bridge hook', bridgeCopy, scope, false),
            describeHookCopy('code-gate hook', codeGateCopy, scope, false)
          ].filter((line): line is string => line !== null)
        : [describeHookCopy('bridge hook', bridgeCopy, scope, false)].filter(
            (line): line is string => line !== null
          );
      // Slice 2026-07-29-worktree-layer3-deny: emit L3 deny bookkeeping
      // in the JSON envelope so downstream automation (audit / sc) can
      // confirm Layer 3 was applied without re-reading the file. When
      // the install is a no-op (`applied: false`) the deny block was
      // already on disk from a prior install; we still emit the
      // current desired list for symmetry with the dry-run envelope.
      const denyEntries = listSuperpowersDenyEntries();
      printResult(
        io,
        ok(
          'hooks.install',
          {
            ...result,
            ide,
            dryRun: false,
            skipProgress,
            entries: installedEntries.map((e) => ({ matcher: e.matcher, sentinel: e.sentinel })),
            bridgeHookCopy: bridgeCopy,
            codeGateHookCopy: codeGateCopy,
            permissionsDenyApplied: result.applied,
            permissionsDenyEntries: denyEntries
          },
          [],
          nextActions
        ),
        options.json
      );
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      printResult(
        io,
        fail(
          'hooks.install',
          'HOOKS_INSTALL_FAILED',
          message,
          { scope, ide, applied: false, skipProgress },
          [message]
        ),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    hooks
      .command('uninstall')
      .description(
        'Remove the peaks-managed gate-enforce hook entry from the target settings.json. Any legacy progress-start entry that a pre-#014 install left behind is also removed (sentinel-based scan). Third-party hooks are preserved.'
      )
      .option(
        '--global',
        'remove from the user-level ~/.claude/settings.json instead of the project'
      )
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option('--ide <id>', resolveIdeOptionHelp())
  ).action((options: HookCliOptions) => {
    const scope = resolveScope(options);
    const projectRoot = resolveProjectRoot(scope, options.project);
    const ide = resolveIdeForCommand(options, projectRoot);
    try {
      const result = removeHookInstall(scope, projectRoot, { ide });
      // Slice 2026-07-29-worktree-layer3-deny: surface L3 deny removal
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
  });

  addJsonOption(
    hooks
      .command('status')
      .description('Report which peaks-managed hook entries are installed.')
      .option('--global', 'inspect the user-level ~/.claude/settings.json instead of the project')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option('--ide <id>', resolveIdeOptionHelp())
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
      // The gate-enforce entry is materialized into the machine-local
      // settings file (see `resolveHookTargets`), so the on-disk entry list
      // must be read from both files or `status` would report it missing.
      const localSettings =
        status.localSettingsPath !== undefined && existsSync(status.localSettingsPath)
          ? readJsonObjectFile(status.localSettingsPath)
          : {};
      // Slice 2026-07-29-worktree-layer3-deny: report the Layer 3 deny
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
  });
}

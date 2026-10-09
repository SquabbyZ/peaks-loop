/**
 * `peaks hooks *` — the Peaks-managed hook entry in the adapter's settings.json.
 *
 * The `install` verb and the hook-script distribution stay in this file because
 * three source-scanning guards pin file-level facts to this exact path:
 *
 *   - `tests/unit/cli/ide-option-help-lists-the-registry.test.ts` needs an
 *     `--ide` option declaration here whose help is derived from the registry;
 *   - `tests/unit/runtime/vendor-neutral-identity-guard.test.ts` pins the two
 *     user-global Claude Code skill-bridge copy targets to this file
 *     (`settingsPaths: 2` in its `KNOWN_DEBT` census);
 *   - `tests/unit/hooks/gate-enforce-machine-local-shell.test.ts` scans this
 *     file for the CJS module-directory global, because this is where the hook
 *     script sources are resolved.
 *
 * The other verbs live beside it: `hooks-uninstall-command.ts`,
 * `hooks-status-command.ts`, the two install envelopes in
 * `hooks-install-envelopes.ts`, and the scope / IDE resolution in
 * `hooks-command-shared.ts`.
 */

import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { resolveIdeOptionHelp } from '../../services/ide/ide-registry.js';
import type { HookScope } from '../../services/skills/hooks-settings-service.js';
import { fail } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  resolveIdeForCommand,
  resolveProjectRoot,
  resolveScope,
  type HookCliOptions,
  type HookScriptCopies,
  type HookScriptCopy,
  type InstallContext
} from './hooks-command-shared.js';
import { printInstallApplied, printInstallDryRun } from './hooks-install-envelopes.js';
import { registerHooksStatusCommand } from './hooks-status-command.js';
import { registerHooksUninstallCommand } from './hooks-uninstall-command.js';

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

/**
 * `src/services/hooks/pre-tool-superpowers-bridge.sh` from the peaks-loop repo
 * into the user-global `<userHome>/.claude/skills/peaks-code/hooks/` directory.
 * The user-global copy is treated as a build artifact: it MUST be
 * byte-identical to the repo source after install, and the source of truth is
 * the repo file.
 *
 * Why this lives in the install command: the install is the single declared
 * surface where the user-global directory is touched. Adding it here keeps the
 * "hooks only ship from src/services/hooks/" invariant (G10 / AC10) — no other
 * code path writes to `~/.claude/skills/peaks-code/hooks/`.
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
function copyBridgeHookIfPresent(userHome: string, dryRun = false): HookScriptCopy {
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
 * The same distribution for the code-gate hook
 * source (`src/services/hooks/pre-tool-code-gate.sh`) into the user-
 * global peaks-code hooks dir, mirroring the bridge-hook copy. The
 * hook itself is vendor-neutral (no `claude` / `anthropic` strings in
 * the script) — this installer is the vendor adapter that decides
 * where the file lands. The CLI command `peaks code-gate` is the
 * runtime entry; the shell script is the canonical artifact distributed
 * alongside the bridge hook.
 */
function copyCodeGateHookIfPresent(userHome: string, dryRun = false): HookScriptCopy {
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

/** The `{ copied: false, source: '', target: '' }` a non-global scope reports. */
const NO_COPY: HookScriptCopy = { copied: false, source: '', target: '' };

/**
 * The two hook-script copies for this scope. Only a global install distributes
 * them; a project install reports the no-op shape the envelope has always
 * carried. In `--dry-run` the copies report what they WOULD do and write
 * nothing — their target is the user's home directory.
 */
function hookScriptCopies(scope: HookScope, dryRun: boolean): HookScriptCopies {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  return {
    bridgeCopy: scope === 'global' ? copyBridgeHookIfPresent(home, dryRun) : NO_COPY,
    codeGateCopy: scope === 'global' ? copyCodeGateHookIfPresent(home, dryRun) : NO_COPY
  };
}

function runHooksInstall(io: ProgramIO, options: HookCliOptions): void {
  const scope = resolveScope(options);
  const projectRoot = resolveProjectRoot(scope, options.project);
  const ide = resolveIdeForCommand(options, projectRoot);
  const skipProgress = options.progress === false;
  const ctx: InstallContext = { scope, projectRoot, ide, skipProgress };
  try {
    const dryRun = options.dryRun === true;
    const copies = hookScriptCopies(scope, dryRun);
    if (dryRun) {
      printInstallDryRun(io, options, ctx, copies);
      return;
    }
    printInstallApplied(io, options, ctx, copies);
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
  ).action((options: HookCliOptions) => runHooksInstall(io, options));

  registerHooksUninstallCommand(hooks, io);
  registerHooksStatusCommand(hooks, io);
}

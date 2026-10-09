// src/cli/commands/statusline-commands.ts
//
// `peaks statusline` and its subcommands. The option chains are declared here —
// this is the file `tests/unit/cli/ide-option-help-lists-the-registry.test.ts`
// scans for `--ide` declarations — and the verb bodies live beside it, one
// module per verb, over the stdin seam and the scope/IDE resolution in
// `statusline-command-shared.ts`.

import type { Command } from 'commander';

import { addJsonOption, type ProgramIO } from '../cli-helpers.js';
import { resolveIdeOptionHelp } from '../../services/ide/ide-registry.js';
import { runDefaultStatuslineRender } from './statusline-render-command.js';
import { runStatuslineInstall } from './statusline-install-command.js';
import { runStatuslineUninstall } from './statusline-uninstall-command.js';
import { runStatuslineStatus } from './statusline-status-command.js';
import { runStatuslineCompact } from './statusline-compact-command.js';
import type {
  CompactOptions,
  InstallOptions,
  RenderOptions,
  StatusOptions,
  UninstallOptions
} from './statusline-command-shared.js';

/**
 * The bare `peaks statusline` invocation plus the hidden `render` subcommand.
 * This pattern is required by commander 12.x: when a command has both an
 * action AND subcommands, commander's option parser conflates the parent's
 * options with the subcommand's and drops flags. Routing through a subcommand
 * (even one that's hidden) avoids the option-shadowing bug.
 *
 * Without the default action, commander falls back to printing usage (Bug-02,
 * ice-cola surface check 2026-07-22).
 */
function registerRenderVerbs(statusline: Command, io: ProgramIO): void {
  statusline.action(async (_parentOptions: RenderOptions, command: Command) => {
    await runDefaultStatuslineRender(command.opts(), io);
  });

  statusline
    .command('render', { hidden: true })
    .description(
      'Render the Peaks skill status line for the current session (reads session JSON on stdin; honors --project for the project label).'
    )
    .option(
      '--project <path>',
      'project root path (used to label the status line when stdin is absent)'
    )
    .action(async (options: RenderOptions) => {
      await runDefaultStatuslineRender(options, io);
    });
}

function registerInstallVerb(statusline: Command, io: ProgramIO): void {
  addJsonOption(
    statusline
      .command('install')
      .description(
        "Install the Peaks status line into the adapter's settings.json (project scope by default)."
      )
      .option(
        '--global',
        'install into the user-level ~/.claude/settings.json instead of the project'
      )
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option('--ide <id>', resolveIdeOptionHelp())
      .option('--force', 'overwrite an existing non-Peaks statusLine entry')
      .option('--dry-run', 'show what would change without writing')
  ).action((options: InstallOptions) => runStatuslineInstall(io, options));
}

function registerUninstallVerb(statusline: Command, io: ProgramIO): void {
  addJsonOption(
    statusline
      .command('uninstall')
      .description("Remove the Peaks status line from the adapter's settings.json.")
      .option(
        '--global',
        'remove from the user-level ~/.claude/settings.json instead of the project'
      )
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option('--ide <id>', resolveIdeOptionHelp())
  ).action((options: UninstallOptions) => runStatuslineUninstall(io, options));
}

function registerStatusVerb(statusline: Command, io: ProgramIO): void {
  addJsonOption(
    statusline
      .command('status')
      .description(
        'Report whether the Peaks status line is installed in the adapter settings.json.'
      )
      .option('--global', 'inspect the user-level ~/.claude/settings.json instead of the project')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option('--ide <id>', resolveIdeOptionHelp())
  ).action((options: StatusOptions) => runStatuslineStatus(io, options));
}

function registerCompactVerb(statusline: Command, io: ProgramIO): void {
  addJsonOption(
    statusline
      .command('compact')
      .description(
        'Render the single-line auto-compact indicator the LLM embeds ' +
          "in Claude Code's statusline. Default output is plain text; " +
          'pass --json for the structured envelope. ' +
          'Reads the lifecycle record for the canonical session ' +
          '(`.peaks/_runtime/<sid>/compact-lifecycle.json`); pass ' +
          '--session-id to target a non-canonical session explicitly.'
      )
      .option('--project <path>', 'project root (auto-detected from cwd when omitted)')
      .option(
        '--session-id <sid>',
        'override the active session id (defaults to the canonical binding; supported for QA / internal tooling)'
      )
      .option(
        '--now <ms>',
        'override current time (epoch ms) — for testing / deterministic rendering of the lifecycle expiry window'
      )
  ).action((options: CompactOptions, command: Command) =>
    runStatuslineCompact(io, options, command)
  );
}

export function registerStatusLineCommands(program: Command, io: ProgramIO): void {
  const statusline = addJsonOption(
    program
      .command('statusline')
      .description(
        'Render the Peaks skill status line for the current session, or manage the adapter-driven statusLine entry. Run with no subcommand to render; with a subcommand (install | uninstall | status) to manage.'
      )
      .option(
        '--project <path>',
        'project root path (used to label the status line when stdin is absent; applies to the default render path)'
      )
      .option(
        '--now <ms>',
        'override current time (epoch ms) — for testing / deterministic rendering of the lifecycle expiry window'
      )
  );

  registerRenderVerbs(statusline, io);
  registerInstallVerb(statusline, io);
  registerUninstallVerb(statusline, io);
  registerStatusVerb(statusline, io);
  registerCompactVerb(statusline, io);
}

// Re-export for tests / external consumers: the render body is driven directly
// by `tests/unit/cli/statusline-witness-capture.test.ts`.
export { runDefaultStatuslineRender } from './statusline-render-command.js';

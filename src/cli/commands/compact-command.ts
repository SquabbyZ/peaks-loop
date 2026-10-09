/**
 * `peaks compact *` — strategic-compact CLI primitives.
 *
 * top-level `peaks compact` group:
 *
 *   - suggest:    PreToolUse-style two-signal suggestion (context size
 *                 + tool-call count), read-only by default.
 *   - recommend:  Pure (from, to) phase-pair → severity lookup.
 *   - survival:   Static SKILL.md "What Survives Compaction" table.
 *   - dry-run:    Composite of (suggest + recommend + survival), no
 *                 writes.
 *   - force:      Write a pre-compact checkpoint via
 *                 `peaks session checkpoint`; the IDE-side `/compact`
 *                 is still the LLM's call.
 *   - history / harness-window / settle: the observability and hook
 *                 transport for the window this group reports on.
 *
 * Each subcommand returns a `--json` envelope via `printResult`. This module is
 * the registrar: the parent group is created here and handed to each command's
 * own module.
 */
import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import { registerCompactReadCommands } from './compact-read-commands.js';
import { registerCompactDryRunCommand } from './compact-dry-run-command.js';
import { registerCompactForceCommand } from './compact-force-command.js';
import { registerCompactHistoryCommand } from './compact-history-command.js';
import { registerCompactHarnessWindowCommand } from './compact-harness-window-command.js';
import { registerCompactSettleCommand } from './compact-settle-command.js';

export function registerCompactCommands(program: Command, io: ProgramIO): void {
  const compact = program
    .command('compact')
    .description('Strategic-compact primitives: suggest / recommend / survival / dry-run / force');

  registerCompactReadCommands(compact, io);
  registerCompactDryRunCommand(compact, io);
  registerCompactForceCommand(compact, io);
  registerCompactHistoryCommand(compact, io);
  registerCompactHarnessWindowCommand(compact, io);
  registerCompactSettleCommand(compact, io);
}

/**
 * The `peaks contract` / `peaks classify` entry point.
 *
 * Pre-merge originals (now deleted):
 *   - src/cli/commands/contract-commands.ts          (167 lines)
 *   - src/cli/commands/classify-classify-commands.ts (190 lines)
 *
 * Both `register*Commands` functions are preserved **verbatim** (function name,
 * signature, body). The merge was a structural refactor only — no behavior
 * change — and `autoRegisterAllCommands` discovers both exports from this single
 * file. This module is now the entry point and no longer holds the verbs:
 *
 *   `contract-write-command.ts`        `peaks contract write`
 *   `classify-run-command.ts`          `peaks classify run`
 *   `classify-downgrade-command.ts`    `peaks classify downgrade` (always refused)
 *   `classify-signals.ts`              the diff signals + the audit log
 */

import type { Command } from 'commander';

import type { ProgramIO } from '../cli-helpers.js';
import { registerClassifyDowngradeCommand } from './classify-downgrade-command.js';
import { registerClassifyRunCommand } from './classify-run-command.js';

export { registerContractCommands } from './contract-write-command.js';

/**
 * peaks classify CLI (Slice L1a + L1b).
 *
 * Subcommands:
 *   - peaks classify run --project <path> [--override <level> --reason "<text>"]
 *     Classify the current diff via the heuristic + return a JSON envelope
 *     with the chosen level, gate set, and audit log.
 *   - peaks classify downgrade --level <level> --reason "<text>" --project <path>
 *     Always refused (per spec §4: "peaks classify downgrade" always errors
 *     out). LLM may ask; the CLI never grants.
 */
export function registerClassifyCommands(program: Command, io: ProgramIO): void {
  const classify = program
    .command('classify')
    .description(
      'L1a task classification: 5-level heuristic (typo/bug/feature/refactor/migration) + override/upgrade + audit log'
    );

  registerClassifyRunCommand(classify, io);
  registerClassifyDowngradeCommand(classify, io);
}

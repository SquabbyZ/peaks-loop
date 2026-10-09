/**
 * peaks asset * CLI — M5 / spec §5 / §7.4
 *
 * Adds the umbrella verbs for the post-run crystallization flow:
 *
 *   peaks asset crystallize --from-task <id> --loop-name <name> \
 *     --loop-scenario <text> --bee-name <name> \
 *     --bee-version <semver> --bee-description <text> \
 *     --brief-what-happened <text> --brief-why-it-matters <text> \
 *     --brief-what-learned <text> --brief-what-action <text> \
 *     [--bee-relation-reason <text>] [--brief-bullet <bullet>]... \
 *     [--source-trace <id>]... [--evaluator-summary <text>] \
 *     [--user-decision-summary <text>] \
 *     [--trigger <user_explicit|llm_suggested|success_default_prompt|similar_task_recurrence>] \
 *     [--project <root>] [--json]
 *   peaks asset dispose --crystallization-event <id> --mode <trace_only|retain|destroy> \
 *     [--project <root>] [--json]
 *   peaks asset status [--loop <id>] [--bee <name>] [--project <root>] [--json]
 *
 * The crystallize verb prints the 4-section brief in the
 * user-facing recommendation; refuses to proceed if any brief
 * section is missing (EvidenceBriefSchema.refine guard +
 * CrystallizationService pre-run gate).
 *
 * The dispose verb handles trace-only / retain / destroy. trace_only
 * retires the crystallization event but keeps the source trace;
 * retain is a no-op on the asset (the user wants to keep it as
 * evidence); destroy hard-retires both the event and (if the
 * user opts in) the created/updated assets. The CLI defaults to
 * trace-only disposal for safety.
 *
 * The status verb lists loop + bee lifecycle state plus any
 * crystallization events that reference them.
 *
 * Each verb prints a structured JSON envelope (`printResult` with
 * `asJson=true`). The user never types a JSON manifest / form
 * field; the LLM runs the CLI on the user's behalf.
 *
 * Defense in depth: the CrystallizationService enforces the
 * pre-run gate and the brief-section guard; the CLI only
 * translates flags into the service payload.
 *
 * The verb implementations live beside this file, one module per verb:
 * `asset-crystallize-command.ts`, `asset-dispose-command.ts`,
 * `asset-status-command.ts`, with their shared bootstrap in
 * `asset-command-shared.ts`.
 */

import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import { registerAssetCrystallizeCommand } from './asset-crystallize-command.js';
import { registerAssetDisposeCommand } from './asset-dispose-command.js';
import { registerAssetStatusCommand } from './asset-status-command.js';

export function registerAssetCommands(program: Command, io: ProgramIO): void {
  // Reuse the existing `asset` parent if one is registered; the
  // add-a-new-subcommand-check-for-existing-top-level-first rule
  // requires this guard.
  const existing = program.commands.find((c) => c.name() === 'asset');
  const asset =
    existing ??
    program
      .command('asset')
      .description(
        'M5: cross-asset crystallization surface (crystallize / dispose / status — spec §5 / §7.4)'
      );

  registerAssetCrystallizeCommand(asset, io);
  registerAssetDisposeCommand(asset, io);
  registerAssetStatusCommand(asset, io);
}

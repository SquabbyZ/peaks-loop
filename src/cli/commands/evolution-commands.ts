/**
 * peaks evolution * CLI — M4 / spec §4.4 / §6 / §7.4
 *
 * Adds the Darwin-style ratchet CLI surface:
 *
 *   peaks evolution propose --target <kind:id> --dimension <name> \
 *     --before-score <n> --after-score <n> [--delta-min <n>] \
 *     --author <id> [--brief-pointer <path>] [--project <root>] [--json]
 *   peaks evolution evaluate --proposal <id> \
 *     --evaluator <id> --skeptic <id> \
 *     --evaluator-score <n> [--refute-paragraph <text>] \
 *     [--risk-tag <tag>]... [--brief-pointer <path>] [--project <root>] [--json]
 *   peaks evolution revert --proposal <id> [--user-confirmation <ptr>] [--project <root>] [--json]
 *   peaks evolution status [--target <kind:id>] [--project <root>] [--json]
 *
 * Each verb prints a structured JSON envelope (`printResult` with
 * `asJson=true`). The CLI is a thin shim around EvolutionService +
 * the two runner modules. Author / evaluator / skeptic identities
 * are LLM-supplied; the user is NEVER asked to type them.
 *
 * Defense in depth: the EvolutionService enforces the ratchet
 * into the service payload.
 *
 * Size-debt split: each verb's registration and action body now lives
 * in its own sibling module — `evolution-propose-command.ts`,
 * `evolution-evaluate-command.ts`, `evolution-verdict-commands.ts`
 * (mark-keep + revert) and `evolution-status-command.ts` — over the
 * shared parse / validate / DB / failure helpers in
 * `evolution-command-shared.ts`. This file keeps the parent and the
 * delegation only; every command name, option, envelope key, error
 * code and exit-code site is unchanged.
 */

import type { Command } from 'commander';
import { dirname } from 'node:path';
import type { ProgramIO } from '../cli-helpers.js';
import { registerEvaluateCommand } from './evolution-evaluate-command.js';
import { registerProposeCommand } from './evolution-propose-command.js';
import { registerStatusCommand } from './evolution-status-command.js';
import { registerMarkKeepCommand, registerRevertCommand } from './evolution-verdict-commands.js';

export type { EvolutionTarget } from './evolution-command-shared.js';

export function registerEvolutionCommands(program: Command, io: ProgramIO): void {
  // Reuse the existing `evolution` parent if one is registered;
  // otherwise create it. The add-a-new-subcommand-check-for-existing-
  // top-level-first rule requires this guard.
  const existing = program.commands.find((c) => c.name() === 'evolution');
  const evolution =
    existing ??
    program
      .command('evolution')
      .description('Darwin-style ratchet: propose / evaluate / revert / status (spec §6)');

  registerProposeCommand(evolution, io);
  registerEvaluateCommand(evolution, io);
  registerMarkKeepCommand(evolution, io);
  registerRevertCommand(evolution, io);
  registerStatusCommand(evolution, io);

  // Suppress unused-var warnings for the dirname import; it is
  // reserved for the M5 path-pointer materialization.
  void dirname;
}

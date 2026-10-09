/**
 * `peaks sop` — author and validate user-defined SOP skills.
 *
 *   - `peaks sop init`       — scaffold a SOP (manifest + SKILL.md)
 *   - `peaks sop lint`       — validate the manifest
 *   - `peaks sop register`   — record the SOP's gates in the gate registry
 *   - `peaks sop registry`   — list registered SOPs and gates
 *   - `peaks sop check`      — evaluate one gate
 *   - `peaks sop advance`    — advance to a phase, enforcing the bypass policy
 *
 * Registration order is the user's reading order and is what the whole-registry
 * render pins; each verb's implementation lives beside this file, one module
 * per verb, over the shared envelope helpers in `sop-command-shared.ts`.
 */

import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import { registerSopInitCommand } from './sop-init-command.js';
import { registerSopLintCommand } from './sop-lint-command.js';
import { registerSopRegisterCommand } from './sop-register-command.js';
import { registerSopRegistryCommand } from './sop-registry-command.js';
import { registerSopCheckCommand } from './sop-check-command.js';
import { registerSopAdvanceCommand } from './sop-advance-command.js';

export function registerSopCommands(program: Command, io: ProgramIO): void {
  const sop = program.command('sop').description('Author and validate user-defined SOP skills');

  registerSopInitCommand(sop, io);
  registerSopLintCommand(sop, io);
  registerSopRegisterCommand(sop, io);
  registerSopRegistryCommand(sop, io);
  registerSopCheckCommand(sop, io);
  registerSopAdvanceCommand(sop, io);
}

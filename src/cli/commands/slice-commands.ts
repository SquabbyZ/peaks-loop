// src/cli/commands/slice-commands.ts
//
// The `peaks slice` registrar. Split into one module per subcommand
// check, ls, decompose, pick, plan. This file
// wires them up in the registration order the CLI surface dump pins.
import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import { registerSliceCheckCommand } from './slice-check-command.js';
import { registerSliceListCommand } from './slice-list-commands.js';
import { registerSliceDecomposeCommand } from './slice-decompose-command.js';
import { registerSlicePickCommand } from './slice-pick-command.js';
import { registerSlicePlanCommand } from './slice-plan-command.js';

// Published import path preserved (the `-picked.json` envelope validator has
// always been exported from this module).
export { parsePickedFile } from './slice-plan-command.js';

const SLICE_DESCRIPTION =
  'Slice lifecycle: check (boundary), decompose (PRD -> 6-stage algorithm), ' +
  'pick (fzf multi-select), plan (apply via peaks request init). ' +
  '`peaks slice check` is the post-micro-cycle boundary gate (4 stages). ' +
  '`decompose/pick/plan` form the new slice-decomposition pipeline.';

export function registerSliceCommands(program: Command, io: ProgramIO): void {
  const slice = program.command('slice').description(SLICE_DESCRIPTION);

  // ---------- peaks slice check (existing) ----------
  registerSliceCheckCommand(slice, io);

  registerSliceListCommand(slice, io);

  // ---------- peaks slice decompose (NEW) ----------
  registerSliceDecomposeCommand(slice, io);

  // ---------- peaks slice pick (NEW) ----------
  registerSlicePickCommand(slice, io);

  // ---------- peaks slice plan (NEW) ----------
  registerSlicePlanCommand(slice, io);
}

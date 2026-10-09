// src/cli/commands/baseline-commands.ts
//
// `peaks baseline` — manage the capability baseline (frozen product semantics
// for the 15 P0 journeys). Registration order is the user's reading order and
// is what the whole-registry render pins; each verb's body lives beside this
// file, over the shared envelope / path / scorer vocabulary in
// `baseline-command-shared.ts`.
//
//   - `baseline freeze`        — install a baseline JSON file
//   - `baseline list`          — list the 15 P0 journey rows
//   - `baseline show <id>`     — show one journey row
//   - `baseline run-guard`     — run the guard contracts over the baseline
//   - `baseline diff`          — current implementation vs. frozen baseline
//   - `baseline audit`         — the independent-context scorer
//   - `baseline freeze-update` — update rows, with the user's approval
//   - `baseline rollback`      — roll back to a historical version
//   - `baseline reset`         — wipe the current baseline

import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import {
  registerBaselineFreezeCommand,
  registerBaselineFreezeUpdateCommand
} from './baseline-freeze-commands.js';
import {
  registerBaselineDiffCommand,
  registerBaselineListCommand,
  registerBaselineShowCommand
} from './baseline-read-commands.js';
import { registerBaselineRunGuardCommand } from './baseline-guard-command.js';
import { registerBaselineAuditCommand } from './baseline-audit-command.js';
import {
  registerBaselineResetCommand,
  registerBaselineRollbackCommand
} from './baseline-rollback-commands.js';

export function registerBaselineCommands(program: Command, io: ProgramIO): void {
  const baseline = program
    .command('baseline')
    .description('Manage the capability baseline (frozen product semantics for 15 P0 journeys).');

  // The call order below IS the registration order the whole-registry render
  // pins, so it stays the order the verbs shipped in — a file may hold two
  // verbs' bodies without moving either.
  registerBaselineFreezeCommand(baseline, io);
  registerBaselineListCommand(baseline, io);
  registerBaselineShowCommand(baseline, io);
  registerBaselineRunGuardCommand(baseline, io);
  registerBaselineDiffCommand(baseline, io);
  registerBaselineAuditCommand(baseline, io);
  registerBaselineFreezeUpdateCommand(baseline, io);
  registerBaselineRollbackCommand(baseline, io);
  registerBaselineResetCommand(baseline, io);
}

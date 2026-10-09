// src/cli/commands/core/skill-command.ts
//
// The `peaks skill` registrar. Split into sibling modules by responsibility
// registry/platform (list, doctor, sync),
// runbook inspection, presence (read + write), presence housekeeping (clear,
// lease gc, check-stale) and heartbeat. This file only wires them up, in the
// registration order the CLI surface dump pins.
import type { Command } from 'commander';
import { registerSkillSearchCommand } from '../skill-search-commands.js';
import { type ProgramIO } from '../../cli-helpers.js';
import { registerSkillRegistryCommands } from './skill-registry-commands.js';
import { registerSkillRunbookCommand } from './skill-runbook-command.js';
import { registerSkillPresenceCommands } from './skill-presence-commands.js';
import { registerSkillPresenceHousekeepingCommands } from './skill-presence-housekeeping-commands.js';
import { registerSkillHeartbeatCommands } from './skill-heartbeat-commands.js';

// The loop-hygiene verdict stays importable from this module's original path:
// `tests/unit/cli/skill-presence-loop-hygiene.test.ts` imports it from here.
export { buildContextVerdict } from './skill-context-verdict.js';

export function registerSkillCommand(program: Command, io: ProgramIO): void {
  const skill = program.command('skill').description('Manage Peaks skills');

  registerSkillRegistryCommands(skill, io);
  registerSkillRunbookCommand(skill, io);
  registerSkillPresenceCommands(skill, io);
  registerSkillPresenceHousekeepingCommands(skill, io);
  registerSkillHeartbeatCommands(skill, io);

  // list / runbook / presence; preserves the existing surface
  // (HC-10 — 老入口保留).
  registerSkillSearchCommand(program, io);
}

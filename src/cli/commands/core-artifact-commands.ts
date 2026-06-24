import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import { registerArtifactsCommand } from './core/artifacts-command.js';
import { registerDoctorCommand, type DoctorLogsSection } from './core/doctor-command.js';
import { registerMemoryCommand } from './core/memory-command.js';
import { registerProfileCommand } from './core/profile-command.js';
import { registerProxyCommand } from './core/proxy-command.js';
import { registerSessionCommand } from './core/session-command.js';
import { registerSkillCommand } from './core/skill-command.js';
import { registerStandardsCommand } from './core/standards-command.js';

// Re-export the public surface so existing consumers
// (`src/cli/program.ts`, `tests/unit/cli-command-branches.test.ts`,
// any future callers needing the `peaks doctor --log` section type)
// keep importing everything from `core-artifact-commands.js` without
// needing to know the internal sub-module split.
export type { DoctorLogsSection, BindingSource } from './core/doctor-command.js';

/**
 * Top-level CLI command registrar for the "core + artifact" surface.
 *
 * Slice 2026-06-24-handoff-path-canonicalization split this orchestrator
 * out of a single 889-line file so each subcommand group lives in its
 * own module under `src/cli/commands/core/`. The orchestrator stays
 * thin (~this file) and forwards to the per-group registrars; the
 * public `registerCoreAndArtifactCommands(program, io)` signature is
 * preserved verbatim so `src/cli/program.ts` and the cli-command-branches
 * unit tests keep importing it from the same path.
 */
export function registerCoreAndArtifactCommands(program: Command, io: ProgramIO): void {
  registerDoctorCommand(program, io);
  registerSkillCommand(program, io);
  registerSessionCommand(program, io);
  registerProfileCommand(program, io);
  registerStandardsCommand(program, io);
  registerMemoryCommand(program, io);
  registerProxyCommand(program, io);
  registerArtifactsCommand(program, io);
}

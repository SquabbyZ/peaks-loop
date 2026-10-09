import type { Command } from 'commander';

import type { ProgramIO } from '../../cli-helpers.js';
// `peaks session checkpoint` and `peaks session resume` subcommands
// EAGERLY so they appear in `peaks session --help` output. The
// previous lazy import ran AFTER commander had already produced
// the help text, so an LLM calling `peaks <TAB>`-discovery never
// saw them — they were effectively hidden.
import { registerSessionCheckpointCommand } from '../session-checkpoint-command.js';
import { registerSessionResumeCommand } from '../session-resume-command.js';
// Slice 2 of the peaks-code → peaks-code rename plan: register the
// `peaks session migrate-skill-name` subcommand eagerly alongside
// checkpoint / resume / auto-compact-hook so it appears in
// `peaks session --help` for LLM `<TAB>`-discovery. See
// src/services/migrate-skill-name/.
import { registerSessionMigrateSkillNameCommand } from '../session-migrate-skill-name.js';
// state-machine sub-actions (state / transition / attempts / reset)
// appear in `peaks session --help` for LLM `<TAB>`-discovery.
import { registerSession24hModeCommand } from '../session-24h-mode.js';
import { registerSpillDemoCommand } from '../spill-demo-command.js';
import { registerSessionInfoCommand } from './session-info-command.js';
import {
  registerSessionListCommand,
  registerSessionRotateCommand,
  registerSessionTitleCommand
} from './session-verb-commands.js';

export function registerSessionCommand(program: Command, io: ProgramIO): void {
  const session = program.command('session').description('Manage Peaks session directories');

  registerSessionListCommand(session, io);
  registerSessionInfoCommand(session, io);
  registerSessionTitleCommand(session, io);

  // Skill-level primitives — the LLM is the decision-maker; CLI is the muscle.
  // Registered synchronously (rather than via `void (async () => …)`) so
  // commander walks the subcommand tree synchronously and
  // `peaks session --help` includes both `checkpoint` and `resume`. The
  // previous async-IIFE registered them on a microtask tick AFTER the
  // program-level help builder had already serialised its output, so they
  // were hidden from `<TAB>`-discovery and the LLM never saw them.
  registerSessionCheckpointCommand(session, io);
  registerSessionResumeCommand(session, io);
  // Slice 2 of the peaks-code → peaks-code rename plan:
  // `peaks session migrate-skill-name --from <old> --to <new>
  // [--apply] [--project <path>] [--json]`. Idempotent rewrite of
  // .peaks/_runtime/** for the rename; skipped paths recorded in
  // the response envelope. See src/services/migrate-skill-name/.
  registerSessionMigrateSkillNameCommand(session);
  registerSession24hModeCommand(session, io);
  registerSpillDemoCommand(session, io);

  registerSessionRotateCommand(session, io);
}

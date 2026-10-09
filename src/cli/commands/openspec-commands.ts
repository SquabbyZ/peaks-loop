// src/cli/commands/openspec-commands.ts
//
// The `openspec` parent command and the registration order of its verbs.
// The verb implementations live beside this file, one module per verb:
//
//   openspec-command-shared.ts        option shapes, flag translation, printers
//   openspec-list-command.ts          list
//   openspec-show-command.ts          show
//   openspec-to-rd-command.ts         to-rd
//   openspec-render-command.ts        render
//   openspec-validate-command.ts      validate
//   openspec-archive-command.ts       archive
//   openspec-init-command.ts          init
//   openspec-from-doctor-command.ts   from-doctor
//
// The order of the calls below IS the order commander registers the
// subcommands in, so it is part of the CLI's observable surface.

import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import { registerOpenSpecListCommand } from './openspec-list-command.js';
import { registerOpenSpecShowCommand } from './openspec-show-command.js';
import { registerOpenSpecToRdCommand } from './openspec-to-rd-command.js';
import { registerOpenSpecRenderCommand } from './openspec-render-command.js';
import { registerOpenSpecValidateCommand } from './openspec-validate-command.js';
import { registerOpenSpecArchiveCommand } from './openspec-archive-command.js';
import { registerOpenSpecInitCommand } from './openspec-init-command.js';
import { registerOpenSpecFromDoctorCommand } from './openspec-from-doctor-command.js';

export function registerOpenSpecCommands(program: Command, io: ProgramIO): void {
  const openspec = program
    .command('openspec')
    .description('Inspect OpenSpec changes inside the target project');

  registerOpenSpecListCommand(openspec, io);
  registerOpenSpecShowCommand(openspec, io);
  registerOpenSpecToRdCommand(openspec, io);
  registerOpenSpecRenderCommand(openspec, io);
  registerOpenSpecValidateCommand(openspec, io);
  registerOpenSpecArchiveCommand(openspec, io);
  registerOpenSpecInitCommand(openspec, io);
  registerOpenSpecFromDoctorCommand(openspec, io);
}

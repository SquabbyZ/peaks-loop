// src/cli/commands/sop-register-command.ts
//
// `peaks sop register` — validate a SOP and record its gates in the gate
// registry. Split out of `sop-commands.ts`; the verb name, its options, its
// envelope fields and its next-action strings are unchanged.

import type { Command } from 'commander';
import { registerSop, SopRegisterError } from '../../services/sop/sop-registry-service.js';
import { addJsonOption, getErrorMessage, type ProgramIO } from '../cli-helpers.js';
import { printSopFailure, printSopOk, type SopBaseOptions } from './sop-command-shared.js';

type SopRegisterCliOptions = SopBaseOptions & {
  id: string;
  allowCommands?: boolean;
  dryRun?: boolean;
};

async function runSopRegister(io: ProgramIO, options: SopRegisterCliOptions): Promise<void> {
  try {
    const registerOptions: Parameters<typeof registerSop>[0] = { id: options.id };
    if (options.allowCommands === true) {
      registerOptions.allowCommands = true;
    }
    if (options.dryRun === true) {
      registerOptions.dryRun = true;
    }
    if (options.project !== undefined) {
      registerOptions.projectRoot = options.project;
    }
    const result = await registerSop(registerOptions);
    printSopOk(io, {
      json: options.json,
      command: 'sop.register',
      data: result,
      nextActions: result.applied ? [] : ['Re-run without --dry-run to write registry.json']
    });
  } catch (error) {
    printSopFailure(io, {
      json: options.json,
      command: 'sop.register',
      code: error instanceof SopRegisterError ? error.code : 'SOP_REGISTER_FAILED',
      message: getErrorMessage(error),
      data: { id: options.id },
      nextActions: ['Run peaks sop lint to see why the SOP is not registrable']
    });
  }
}

export function registerSopRegisterCommand(sop: Command, io: ProgramIO): void {
  addJsonOption(
    sop
      .command('register')
      .description(
        'Validate a SOP and record its gates in the gate registry (global, or --project for the repo)'
      )
      .requiredOption('--id <sop-id>', 'SOP id to register')
      .option('--allow-commands', 'permit command-type gates when validating')
      .option('--dry-run', 'preview the registration without writing registry.json')
      .option(
        '--project <path>',
        'register into the repo (<path>/.peaks/sops, committed & team-shared) instead of global'
      )
  ).action((options: SopRegisterCliOptions) => runSopRegister(io, options));
}

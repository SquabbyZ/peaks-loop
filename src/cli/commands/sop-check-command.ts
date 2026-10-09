// src/cli/commands/sop-check-command.ts
//
// `peaks sop check` — evaluate a single SOP gate. Split out of
// `sop-commands.ts`; the verb name, its options, its envelope fields and its
// next-action strings are unchanged.

import type { Command } from 'commander';
import { checkGate, SopCheckError } from '../../services/sop/sop-check-service.js';
import { addJsonOption, getErrorMessage, type ProgramIO } from '../cli-helpers.js';
import { printSopFailure, printSopOk } from './sop-command-shared.js';

type SopCheckCliOptions = {
  id: string;
  gate: string;
  project: string;
  allowCommands?: boolean;
  json?: boolean;
};

async function runSopCheck(io: ProgramIO, options: SopCheckCliOptions): Promise<void> {
  try {
    const checkOptions: Parameters<typeof checkGate>[0] = {
      projectRoot: options.project,
      id: options.id,
      gateId: options.gate
    };
    if (options.allowCommands === true) {
      checkOptions.allowCommands = true;
    }
    printSopOk(io, {
      json: options.json,
      command: 'sop.check',
      data: await checkGate(checkOptions)
    });
  } catch (error) {
    printSopFailure(io, {
      json: options.json,
      command: 'sop.check',
      code: error instanceof SopCheckError ? error.code : 'SOP_CHECK_FAILED',
      message: getErrorMessage(error),
      data: { id: options.id, gateId: options.gate },
      nextActions: ['Verify the SOP id and gate id with peaks sop lint']
    });
  }
}

export function registerSopCheckCommand(sop: Command, io: ProgramIO): void {
  addJsonOption(
    sop
      .command('check')
      .description('Evaluate a single SOP gate (returns pass / fail / blocked)')
      .requiredOption('--id <sop-id>', 'SOP id')
      .requiredOption('--gate <gate-id>', 'gate id within the SOP')
      .option(
        '--project <path>',
        'project the gate evaluates against (default: current directory)',
        '.'
      )
      .option('--allow-commands', 'permit evaluating command-type gates')
  ).action((options: SopCheckCliOptions) => runSopCheck(io, options));
}

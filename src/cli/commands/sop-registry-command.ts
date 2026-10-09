// src/cli/commands/sop-registry-command.ts
//
// `peaks sop registry` — list registered SOPs and gates. Split out of
// `sop-commands.ts`; the verb name, its options, its envelope fields and its
// next-action strings are unchanged.

import type { Command } from 'commander';
import { readRegistry } from '../../services/sop/sop-registry-service.js';
import { addJsonOption, getErrorMessage, type ProgramIO } from '../cli-helpers.js';
import { printSopFailure, printSopOk, type SopBaseOptions } from './sop-command-shared.js';

type SopRegistryCliOptions = SopBaseOptions;

async function runSopRegistry(io: ProgramIO, options: SopRegistryCliOptions): Promise<void> {
  try {
    const registry = await readRegistry(options.project);
    printSopOk(io, { json: options.json, command: 'sop.registry', data: registry });
  } catch (error) {
    printSopFailure(io, {
      json: options.json,
      command: 'sop.registry',
      code: 'SOP_REGISTRY_FAILED',
      message: getErrorMessage(error),
      data: {},
      nextActions: ['The global registry may be corrupted; inspect ~/.peaks/sops/registry.json']
    });
  }
}

export function registerSopRegistryCommand(sop: Command, io: ProgramIO): void {
  addJsonOption(
    sop
      .command('registry')
      .description(
        'List registered SOPs and gates (global; merges in the cwd project layer by default)'
      )
      .option(
        '--project <path>',
        'also include and prefer the repo layer (<path>/.peaks/sops) (default: current directory)',
        '.'
      )
  ).action((options: SopRegistryCliOptions) => runSopRegistry(io, options));
}

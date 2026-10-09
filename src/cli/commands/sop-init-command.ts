// src/cli/commands/sop-init-command.ts
//
// `peaks sop init` — scaffold a user-authored SOP (manifest + SKILL.md).
// Split out of `sop-commands.ts`; the verb name, its options, its envelope
// fields and its next-action strings are unchanged.

import type { Command } from 'commander';
import { initSop } from '../../services/sop/sop-service.js';
import { addJsonOption, getErrorMessage, type ProgramIO } from '../cli-helpers.js';
import { printSopFailure, printSopOk, type SopBaseOptions } from './sop-command-shared.js';

type SopInitCliOptions = SopBaseOptions & {
  id: string;
  name?: string;
  apply?: boolean;
};

async function runSopInit(io: ProgramIO, options: SopInitCliOptions): Promise<void> {
  try {
    const initOptions: Parameters<typeof initSop>[0] = { id: options.id };
    if (options.name !== undefined) {
      initOptions.name = options.name;
    }
    if (options.apply === true) {
      initOptions.apply = true;
    }
    if (options.project !== undefined) {
      initOptions.projectRoot = options.project;
    }
    const result = await initSop(initOptions);
    // Side-effecting scaffold returns explicit next steps so the user doesn't
    // have to recall the runbook: applied → edit then lint; preview → apply.
    const nextActions = result.applied
      ? [
          `Edit ${result.manifestPath} to define your real phases and gates`,
          `peaks sop lint --id ${result.id} --json`
        ]
      : [`Re-run with --apply to write ${result.manifestPath}`];
    printSopOk(io, { json: options.json, command: 'sop.init', data: result, nextActions });
  } catch (error) {
    printSopFailure(io, {
      json: options.json,
      command: 'sop.init',
      code: 'SOP_INIT_FAILED',
      message: getErrorMessage(error),
      data: { id: options.id },
      nextActions: ['Check the SOP id before retrying']
    });
  }
}

export function registerSopInitCommand(sop: Command, io: ProgramIO): void {
  addJsonOption(
    sop
      .command('init')
      .description(
        'Scaffold a user-authored SOP (manifest + SKILL.md); global by default, --project commits it into a repo'
      )
      .requiredOption('--id <sop-id>', 'SOP id (lowercase kebab, e.g. team-release)')
      .option('--name <name>', 'human-readable SOP name (defaults to the id)')
      .option('--apply', 'write the SOP files (default: preview only)')
      .option(
        '--project <path>',
        'scaffold into the repo (<path>/.peaks/sops, committed & team-shared) instead of global'
      )
  ).action((options: SopInitCliOptions) => runSopInit(io, options));
}

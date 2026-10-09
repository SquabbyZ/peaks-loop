// src/cli/commands/sop-lint-command.ts
//
// `peaks sop lint` — validate a SOP manifest. Split out of `sop-commands.ts`;
// the verb name, its options, its envelope codes and its next-action strings
// are unchanged.

import type { Command } from 'commander';
import { lintSop } from '../../services/sop/sop-service.js';
import { addJsonOption, getErrorMessage, type ProgramIO } from '../cli-helpers.js';
import { printSopFailure, printSopOk, type SopBaseOptions } from './sop-command-shared.js';

type SopLintCliOptions = SopBaseOptions & {
  id: string;
  allowCommands?: boolean;
};

/** The `sop.lint` envelope for a lint result, found or not. */
function emitLintResult(
  io: ProgramIO,
  options: SopLintCliOptions,
  result: Awaited<ReturnType<typeof lintSop>>
): void {
  if (result === null) {
    printSopFailure(io, {
      json: options.json,
      command: 'sop.lint',
      code: 'SOP_NOT_FOUND',
      message: `No SOP found for id "${options.id}"`,
      data: { id: options.id },
      nextActions: ['Run peaks sop init --id <sop-id> --apply first']
    });
    return;
  }
  if (result.ok) {
    printSopOk(io, { json: options.json, command: 'sop.lint', data: result });
    return;
  }
  printSopFailure(io, {
    json: options.json,
    command: 'sop.lint',
    code: 'SOP_LINT_FAILED',
    message: `${result.findings.filter((f) => f.severity === 'error').length} lint error(s) in SOP "${options.id}"`,
    data: result,
    nextActions: ['Fix the reported findings, then re-run peaks sop lint']
  });
}

async function runSopLint(io: ProgramIO, options: SopLintCliOptions): Promise<void> {
  try {
    const lintOptions: Parameters<typeof lintSop>[0] = { id: options.id };
    if (options.allowCommands === true) {
      lintOptions.allowCommands = true;
    }
    if (options.project !== undefined) {
      lintOptions.projectRoot = options.project;
    }
    emitLintResult(io, options, await lintSop(lintOptions));
  } catch (error) {
    printSopFailure(io, {
      json: options.json,
      command: 'sop.lint',
      code: 'SOP_LINT_ERROR',
      message: getErrorMessage(error),
      data: { id: options.id },
      nextActions: ['Check the SOP id before retrying']
    });
  }
}

export function registerSopLintCommand(sop: Command, io: ProgramIO): void {
  addJsonOption(
    sop
      .command('lint')
      .description('Validate a SOP manifest (id namespace, phases, gate ids, check fields)')
      .requiredOption('--id <sop-id>', 'SOP id to lint')
      .option('--allow-commands', 'permit command-type gates (they run shell-less processes)')
      .option(
        '--project <path>',
        'lint the project-layer SOP (<path>/.peaks/sops) instead of global'
      )
  ).action((options: SopLintCliOptions) => runSopLint(io, options));
}

// src/cli/commands/openspec-init-command.ts
//
// `peaks openspec init --project <root>`. Extracted from
// `openspec-commands.ts`; the registered name, description, options and
// envelopes are unchanged.

import type { Command } from 'commander';
import { executeOpenSpecInit } from '../../services/openspec/openspec-init-service.js';
import { ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { failOpenSpec, type OpenSpecInitCommandOptions } from './openspec-command-shared.js';

type InitResult = Awaited<ReturnType<typeof executeOpenSpecInit>>;

/** The `openspec.init` follow-up lines; one branch per scaffold outcome. */
function initNextActions(result: InitResult): string[] {
  if (result.alreadyInitialized) {
    const nextActions = ['openspec/ already exists; no files were created or modified.'];
    if (result.existingFiles.length > 0) {
      nextActions.push(`Existing files preserved: ${result.existingFiles.join(', ')}`);
    }
    return nextActions;
  }
  if (!result.apply) {
    return ['Re-run with --apply to write the planned files to disk.'];
  }
  return [
    'Run `peaks openspec render --request <path> --apply` to scaffold a first change proposal.'
  ];
}

export function registerOpenSpecInitCommand(openspec: Command, io: ProgramIO): void {
  addJsonOption(
    openspec
      .command('init')
      .description(
        'Scaffold the openspec/ directory in the target project (changes/, archive/, README.md, CHANGES.md). Idempotent — refuses to overwrite an existing openspec/'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--apply', 'write files to disk (default: dry-run preview)', false)
  ).action(async (options: OpenSpecInitCommandOptions) => {
    try {
      const result = await executeOpenSpecInit({
        projectRoot: options.project,
        apply: options.apply === true
      });
      printResult(io, ok('openspec.init', result, [], initNextActions(result)), options.json);
    } catch (error) {
      failOpenSpec(io, 'openspec.init', {
        code: 'OPENSPEC_INIT_FAILED',
        error,
        data: { projectRoot: options.project },
        nextActions: ['Verify the project path exists and is writable'],
        json: options.json
      });
    }
  });
}

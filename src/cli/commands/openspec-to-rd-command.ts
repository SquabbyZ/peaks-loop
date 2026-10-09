// src/cli/commands/openspec-to-rd-command.ts
//
// `peaks openspec to-rd <changeId>`. Extracted from `openspec-commands.ts`; the
// registered name, description, options and envelopes are unchanged.

import type { Command } from 'commander';
import { projectOpenSpecToRdInput } from '../../services/openspec/openspec-bridge-service.js';
import { ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  failOpenSpec,
  OPENSPEC_PATH_HINT,
  printChangeNotFound,
  resolveScanOptions,
  type OpenSpecToRdOptions
} from './openspec-command-shared.js';

export function registerOpenSpecToRdCommand(openspec: Command, io: ProgramIO): void {
  addJsonOption(
    openspec
      .command('to-rd')
      .description(
        'Project an OpenSpec change into an RD/SC input shape (acceptance, what-changes, commit boundaries)'
      )
      .argument('<changeId>', 'OpenSpec change directory name under openspec/changes')
      .option('--project <path>', 'project root containing an openspec/ directory')
  ).action(async (changeId: string, options: OpenSpecToRdOptions) => {
    try {
      const projection = await projectOpenSpecToRdInput(
        changeId,
        resolveScanOptions(options.project)
      );
      if (projection === null) {
        printChangeNotFound(io, 'openspec.to-rd', changeId, options.json);
        return;
      }
      printResult(io, ok('openspec.to-rd', projection), options.json);
    } catch (error) {
      failOpenSpec(io, 'openspec.to-rd', {
        code: 'OPENSPEC_TO_RD_FAILED',
        error,
        data: { changeId },
        nextActions: OPENSPEC_PATH_HINT,
        json: options.json
      });
    }
  });
}

// src/cli/commands/openspec-show-command.ts
//
// `peaks openspec show <changeId>`. Extracted from `openspec-commands.ts`; the
// registered name, description, options and envelopes are unchanged.

import type { Command } from 'commander';
import { loadOpenSpecChange } from '../../services/openspec/openspec-scan-service.js';
import { ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  failOpenSpec,
  OPENSPEC_PATH_HINT,
  printChangeNotFound,
  resolveScanOptions,
  type OpenSpecShowOptions
} from './openspec-command-shared.js';

export function registerOpenSpecShowCommand(openspec: Command, io: ProgramIO): void {
  addJsonOption(
    openspec
      .command('show')
      .description('Show parsed proposal and tasks progress for a single OpenSpec change')
      .argument('<changeId>', 'OpenSpec change directory name under openspec/changes')
      .option('--project <path>', 'project root containing an openspec/ directory')
  ).action(async (changeId: string, options: OpenSpecShowOptions) => {
    try {
      const detail = await loadOpenSpecChange(changeId, resolveScanOptions(options.project));
      if (detail === null) {
        printChangeNotFound(io, 'openspec.show', changeId, options.json);
        return;
      }
      printResult(io, ok('openspec.show', detail), options.json);
    } catch (error) {
      failOpenSpec(io, 'openspec.show', {
        code: 'OPENSPEC_SHOW_FAILED',
        error,
        data: { changeId },
        nextActions: OPENSPEC_PATH_HINT,
        json: options.json
      });
    }
  });
}

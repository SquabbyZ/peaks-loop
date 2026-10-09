// src/cli/commands/openspec-list-command.ts
//
// `peaks openspec list`. Extracted from `openspec-commands.ts`; the registered
// name, description, options and envelopes are unchanged.

import type { Command } from 'commander';
import { scanOpenSpec } from '../../services/openspec/openspec-scan-service.js';
import { ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  failOpenSpec,
  OPENSPEC_PATH_HINT,
  resolveScanOptions,
  type OpenSpecListOptions
} from './openspec-command-shared.js';

export function registerOpenSpecListCommand(openspec: Command, io: ProgramIO): void {
  addJsonOption(
    openspec
      .command('list')
      .description('List OpenSpec changes detected under <project>/openspec/changes')
      .option('--project <path>', 'project root containing an openspec/ directory')
  ).action(async (options: OpenSpecListOptions) => {
    try {
      const report = await scanOpenSpec(resolveScanOptions(options.project));
      printResult(io, ok('openspec.list', report), options.json);
    } catch (error) {
      failOpenSpec(io, 'openspec.list', {
        code: 'OPENSPEC_LIST_FAILED',
        error,
        nextActions: OPENSPEC_PATH_HINT,
        json: options.json
      });
    }
  });
}

import type { Command } from 'commander';
import {
  executeProjectMemoryBackup,
  summarizeProjectMemoryBackupResult
} from '../../../services/memory/project-memory-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';
import { refuseBothFlags } from './memory-command-shared.js';

type SyncOptions = {
  project: string;
  workspace: string;
  dryRun?: boolean;
  apply?: boolean;
  json?: boolean;
};

export function registerMemorySyncCommand(memory: Command, io: ProgramIO): void {
  addJsonOption(
    memory
      .command('sync')
      .description('Back up project .peaks/memory into the artifact workspace')
      .requiredOption('--project <path>', 'target project root')
      .requiredOption('--workspace <path>', 'artifact workspace path')
      .option('--dry-run', 'preview copies without changing files')
      .option('--apply', 'copy project .peaks/memory into artifact workspace backup')
  ).action((options: SyncOptions) => {
    const refused = refuseBothFlags(io, {
      command: 'memory.sync',
      code: 'INVALID_MEMORY_SYNC_FLAGS',
      nextActions: ['Run without --apply to preview copies, or pass --apply to back up memories'],
      json: options.json,
      dryRun: options.dryRun,
      apply: options.apply
    });
    if (refused) return;
    try {
      const result = executeProjectMemoryBackup({
        projectRoot: options.project,
        artifactWorkspacePath: options.workspace,
        apply: options.apply === true
      });
      printResult(io, ok('memory.sync', summarizeProjectMemoryBackupResult(result)), options.json);
    } catch (error) {
      printResult(
        io,
        fail('memory.sync', 'MEMORY_SYNC_FAILED', getErrorMessage(error), {}, [
          'Use an artifact workspace outside the project root'
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });
}

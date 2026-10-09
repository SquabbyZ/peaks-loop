// src/cli/commands/project-memory-index-command.ts
//
// `peaks project memory-index` — the lightweight hot/warm memory index read.
// Split out of `project-commands.ts`; the verb name, its options and the
// `exists` / `index` envelope shape are unchanged.

import type { Command } from 'commander';
import { readMemoryIndex } from '../../services/memory/project-memory-service.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type ProjectMemoryIndexOptions = {
  project: string;
  json?: boolean;
};

function runProjectMemoryIndex(io: ProgramIO, options: ProjectMemoryIndexOptions): void {
  try {
    const index = readMemoryIndex(options.project);
    if (!index) {
      printResult(
        io,
        ok('project.memory-index', {
          exists: false,
          message: 'No memory index found. Run `peaks project memories:extract` first.'
        }),
        options.json
      );
      return;
    }
    printResult(io, ok('project.memory-index', { exists: true, index }), options.json);
  } catch (error) {
    printResult(
      io,
      fail(
        'project.memory-index',
        'MEMORY_INDEX_FAILED',
        getErrorMessage(error),
        { projectRoot: options.project },
        ['Check the project path and .peaks/memory directory']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerProjectMemoryIndexCommand(project: Command, io: ProgramIO): void {
  addJsonOption(
    project
      .command('memory-index')
      .description('Read the memory index — lightweight hot/warm分层 view of all project memories')
      .requiredOption('--project <path>', 'target project root')
  ).action((options: ProjectMemoryIndexOptions) => runProjectMemoryIndex(io, options));
}

// src/cli/commands/project-context-command.ts
//
// `peaks project context` — generate or read the persistent project context.
// Split out of `project-commands.ts`; the verb name, its options, the
// `exists` / `content` envelope keys and the read-vs-generate branch are
// unchanged.

import type { Command } from 'commander';
import {
  generateProjectContext,
  readProjectContext
} from '../../services/memory/project-context-service.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type ProjectContextOptions = {
  project: string;
  read?: boolean;
  json?: boolean;
};

/** The read branch's envelope data, present or absent. */
function readContextData(project: string): Record<string, unknown> {
  const content = readProjectContext(project);
  const path = `${project}/.peaks/PROJECT.md`;
  return content === null ? { exists: false, path } : { exists: true, path, content };
}

async function runProjectContext(io: ProgramIO, options: ProjectContextOptions): Promise<void> {
  try {
    if (options.read) {
      printResult(io, ok('project.context', readContextData(options.project)), options.json);
      return;
    }
    const result = await generateProjectContext(options.project);
    printResult(
      io,
      ok('project.context', {
        path: result.path,
        sessionCount: result.sessionCount,
        content: result.content,
        // context command also bootstraps the project-scan tree.
        // The envelope surfaces write counts + duration so the LLM
        // (and the user) see what landed.
        projectScan: result.projectScan
      }),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail(
        'project.context',
        'PROJECT_CONTEXT_FAILED',
        getErrorMessage(error),
        { projectRoot: options.project },
        ['Check the project path and .peaks directory']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerProjectContextCommand(project: Command, io: ProgramIO): void {
  addJsonOption(
    project
      .command('context')
      .description(
        'Generate or read persistent project context for cross-session Peaks understanding. Generates BOTH `.peaks/PROJECT.md` (session history) AND `.peaks/project-scan/project-scan.md` (tech stack + archetypes) — see `peaks workspace init` for the full 5-template boot (G4b/AC9).'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--read', 'read existing PROJECT.md without regenerating')
  ).action((options: ProjectContextOptions) => runProjectContext(io, options));
}

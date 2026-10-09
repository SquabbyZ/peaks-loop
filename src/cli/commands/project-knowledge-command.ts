// src/cli/commands/project-knowledge-command.ts
//
// `peaks project knowledge` — read the schema-sedimented business-knowledge
// concept table. Split out of `project-commands.ts`; the verb name, its
// options, the `--filter` substring semantics and every envelope key are
// unchanged.

import type { Command } from 'commander';
import { readBusinessKnowledge } from '../../services/prd/project-scan-reader.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type ProjectKnowledgeOptions = {
  project: string;
  filter?: string;
  json?: boolean;
};

type BusinessKnowledge = NonNullable<Awaited<ReturnType<typeof readBusinessKnowledge>>>;

/** The `exists: true` payload, with the case-insensitive concept filter applied. */
function knowledgeData(
  knowledge: BusinessKnowledge,
  filter: string | undefined
): Record<string, unknown> {
  const concepts = filter
    ? knowledge.concepts.filter((c) => c.concept.toLowerCase().includes(filter.toLowerCase()))
    : knowledge.concepts;
  return {
    exists: true,
    schemaVersion: knowledge.schemaVersion,
    total: knowledge.concepts.length,
    matched: concepts.length,
    filter: filter ?? null,
    concepts
  };
}

async function runProjectKnowledge(io: ProgramIO, options: ProjectKnowledgeOptions): Promise<void> {
  try {
    const knowledge = await readBusinessKnowledge(options.project);
    if (knowledge === null) {
      printResult(
        io,
        ok('project.knowledge', {
          exists: false,
          projectRoot: options.project,
          path: `${options.project}/.peaks/project-scan/business-knowledge.md`
        }),
        options.json
      );
      return;
    }
    printResult(
      io,
      ok('project.knowledge', knowledgeData(knowledge, options.filter)),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail(
        'project.knowledge',
        'PROJECT_KNOWLEDGE_FAILED',
        getErrorMessage(error),
        { projectRoot: options.project },
        ['Check the project path and .peaks/project-scan directory']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerProjectKnowledgeCommand(project: Command, io: ProgramIO): void {
  addJsonOption(
    project
      .command('knowledge')
      .description(
        'Read .peaks/project-scan/business-knowledge.md (the schema-sedimented concept table). LLM-consumable; use --filter for a concept substring.'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--filter <glob>', 'substring filter on the concept name (case-insensitive)')
  ).action((options: ProjectKnowledgeOptions) => runProjectKnowledge(io, options));
}

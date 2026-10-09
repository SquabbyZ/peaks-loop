/**
 * `peaks project *` — aggregate Peaks state for a target project (read-only).
 *
 * The umbrella verb plus the two memory verbs whose envelopes are pinned by
 * source-scanning tests, which is why they stay in this file rather than moving
 * to a sibling module beside the others:
 *
 *   - `tests/unit/services/memory/memory-kind-llm-surfaces.test.ts` requires the
 *     literal `VALID_PROJECT_MEMORY_KINDS` here (the `--kind` help must stay
 *     derived, never hand-maintained);
 *   - `tests/unit/services/memory/memory-block-drop-diagnostics.test.ts` requires
 *     the literal `describeMemoryBlockDrops(result.droppedBlocks)` here (the
 *     drops must reach the `ok(..., warnings)` channel).
 *
 * The rest live one module per verb:
 * `project-dashboard-command.ts`, `project-context-command.ts`,
 * `project-memory-index-command.ts`, `project-memories-show-command.ts`,
 * `project-knowledge-command.ts`.
 */

import type { Command } from 'commander';
import {
  describeMemoryBlockDrops,
  describeSessionScanFailures,
  extractSessionMemories,
  readProjectMemories,
  VALID_PROJECT_MEMORY_KINDS
} from '../../services/memory/project-memory-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { registerProjectDashboardCommand } from './project-dashboard-command.js';
import { registerProjectContextCommand } from './project-context-command.js';
import { registerProjectKnowledgeCommand } from './project-knowledge-command.js';
import { registerProjectMemoriesShowCommand } from './project-memories-show-command.js';
import { registerProjectMemoryIndexCommand } from './project-memory-index-command.js';

/** Derived from the canonical kind vocabulary — never hand-maintain a list here. */
const KIND_HELP = VALID_PROJECT_MEMORY_KINDS.join(', ');

type ProjectMemoriesOptions = {
  project: string;
  kind?: string;
  json?: boolean;
};

type MemoriesExtractOptions = {
  sessionId: string;
  project: string;
  dryRun?: boolean;
  apply?: boolean;
  json?: boolean;
};

type ExtractResult = ReturnType<typeof extractSessionMemories>;

/** The `ok` payload for `memories:extract` — the counts the caller acts on. */
function extractData(result: ExtractResult): Record<string, unknown> {
  return {
    scannedFiles: result.scannedFiles,
    extractedCount: result.extractedCount,
    writtenFiles: result.writtenFiles,
    memoryDir: result.primaryMemoryDir,
    indexUpdated: result.updatedIndex
  };
}

/**
 * Two drop axes, one channel. `droppedBlocks` = a block was found and rejected
 * (or a marker-shaped comment was not findable at all); `scanFailures` = the
 * whole artifact could not be read, so its blocks were never candidates.
 * `data` is unchanged by either — same contract as `memory.extract`.
 */
function extractWarnings(result: ExtractResult): string[] {
  return [
    ...describeMemoryBlockDrops(result.droppedBlocks),
    ...describeSessionScanFailures(result.scanFailures)
  ];
}

function runProjectMemories(io: ProgramIO, options: ProjectMemoriesOptions): void {
  try {
    const result = readProjectMemories(options.project);
    if (options.kind) {
      const memories = result.memories.filter((memory) => memory.kind === options.kind);
      printResult(
        io,
        ok('project.memories', {
          memoryDir: result.memoryDir,
          kind: options.kind,
          total: memories.length,
          memories
        }),
        options.json
      );
      return;
    }
    printResult(
      io,
      ok('project.memories', {
        memoryDir: result.memoryDir,
        total: result.total,
        byKind: result.byKind,
        memories: result.memories
      }),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail(
        'project.memories',
        'PROJECT_MEMORIES_FAILED',
        getErrorMessage(error),
        { projectRoot: options.project },
        ['Check the project path and .peaks/memory directory']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

function runMemoriesExtract(io: ProgramIO, options: MemoriesExtractOptions): void {
  if (options.dryRun === true && options.apply === true) {
    printResult(
      io,
      fail(
        'project.memories:extract',
        'INVALID_MEMORY_EXTRACT_FLAGS',
        'Use either --dry-run or --apply, not both',
        { sessionId: options.sessionId, projectRoot: options.project },
        ['Run without --apply to preview writes, or pass --apply to write memories']
      ),
      options.json
    );
    process.exitCode = 1;
    return;
  }
  try {
    const result = extractSessionMemories({
      projectRoot: options.project,
      sessionId: options.sessionId,
      apply: options.apply === true
    });
    printResult(
      io,
      ok('project.memories:extract', extractData(result), extractWarnings(result)),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail(
        'project.memories:extract',
        'MEMORY_EXTRACT_FAILED',
        getErrorMessage(error),
        { sessionId: options.sessionId, projectRoot: options.project },
        ['Check the session-id and project path']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerProjectCommands(program: Command, io: ProgramIO): void {
  const project = program
    .command('project')
    .description('Aggregate Peaks state for a target project (read-only)');

  registerProjectDashboardCommand(project, io);
  registerProjectContextCommand(project, io);

  // --- Extract memories from a session's artifacts into .peaks/memory ---
  addJsonOption(
    project
      .command('memories:extract')
      .description(
        'Scan a session artifact directory and extract <!-- peaks-memory:start --> blocks into .peaks/memory/'
      )
      .requiredOption('--session-id <id>', 'session id (e.g. 2026-05-29-session-89ff35)')
      .requiredOption('--project <path>', 'target project root')
      // Slice #015: drop the `--dry-run true` default. With the default
      // set to true, `options.dryRun === true && options.apply === true`
      // fired on every `--apply` call (because dryRun was true by
      // default), permanently breaking `--apply`. `--dry-run` is now
      // opt-in; the mutual-exclusion check below is correct without a
      // special-case.
      .option('--dry-run', 'preview writes without changing files')
      .option('--apply', 'write extracted memories into .peaks/memory/')
  ).action((options: MemoriesExtractOptions) => runMemoriesExtract(io, options));

  registerProjectMemoryIndexCommand(project, io);

  // --- Structured project memory (durable, LLM-authored, stored under .peaks/memory) ---
  addJsonOption(
    project
      .command('memories')
      .description(
        'Read durable project memories (decisions, conventions, modules, rules) from .peaks/memory for LLM consumption'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--kind <kind>', `filter by memory kind (one of: ${KIND_HELP})`)
  ).action((options: ProjectMemoriesOptions) => runProjectMemories(io, options));

  registerProjectMemoriesShowCommand(project, io);
  registerProjectKnowledgeCommand(project, io);
}

// src/cli/commands/memory-ingest-command.ts
//
// `peaks memory ingest` — import memories written by the IDE-side agent into
// `.peaks/memory/`. The IDE-side source is read-only; dry-run by default.
// Extracted from `memory-commands.ts`; the envelope, the flags and the exported
// symbol name are unchanged.

import { fail, ok } from 'peaks-loop-shared/result';

import { executeMemoryIngest } from '../../services/memory/memory-ingest-service.js';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import {
  memoryFailure,
  resolveMemoryProjectRoot,
  type MemoryIngestCommandOptions
} from './memory-command-shared.js';

export async function runMemoryIngest(
  io: ProgramIO,
  options: MemoryIngestCommandOptions
): Promise<void> {
  const projectRoot = resolveMemoryProjectRoot(options.project);

  if (options.dryRun === true && options.apply === true) {
    printResult(
      io,
      fail(
        'memory.ingest',
        'INVALID_MEMORY_INGEST_FLAGS',
        'Use either --dry-run or --apply, not both',
        {},
        ['Run without --apply to preview imports, or pass --apply to write them into .peaks/memory']
      ),
      options.json
    );
    process.exitCode = 1;
    return;
  }

  try {
    const report = executeMemoryIngest({
      projectRoot,
      ...(options.sourceDir !== undefined ? { sourceDir: options.sourceDir } : {}),
      apply: options.apply === true
    });
    printResult(
      io,
      ok('memory.ingest', report, report.warnings, ingestNextActions(report, options)),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      memoryFailure({
        command: 'memory.ingest',
        fallbackCode: 'MEMORY_INGEST_FAILED',
        error,
        projectRoot,
        suggestions: ['Check the --source-dir path and that .peaks/memory is writable']
      }),
      options.json
    );
    process.exitCode = 1;
  }
}

/** The preview / conflict / unclassified notices the report earns, in order. */
function ingestNextActions(
  report: ReturnType<typeof executeMemoryIngest>,
  options: MemoryIngestCommandOptions
): string[] {
  const nextActions: string[] = [];
  if (options.apply !== true && report.imported.length > 0) {
    nextActions.push(
      'Preview only — re-run with --apply to write these memories into .peaks/memory.'
    );
  }
  if (report.conflicts.length > 0) {
    nextActions.push(
      `${report.conflicts.length} conflict(s) left both copies in place; resolve them by hand.`
    );
  }
  if (report.needsClassification.length > 0) {
    nextActions.push(
      `${report.needsClassification.length} file(s) could not be classified; add \`metadata.type\` to the source before re-running.`
    );
  }
  return nextActions;
}

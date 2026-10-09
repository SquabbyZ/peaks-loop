// src/cli/commands/memory-reindex-command.ts
//
// `peaks memory reindex` — rebuild `.peaks/memory/index.json` from disk and
// regenerate `MEMORY.md`. Dry-run by default; `--apply` writes. Extracted from
// `memory-commands.ts`; the envelope, the flags and the exported symbol names
// are unchanged.

import { fail, ok } from 'peaks-loop-shared/result';

import { boundedNames, fitSummaryToBytes } from '../../services/context/summary-view.js';
import {
  executeMemoryReindex,
  type MemoryReindexReport
} from '../../services/memory/project-memory-service.js';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import {
  memoryFailure,
  resolveMemoryProjectRoot,
  type MemoryReindexCommandOptions
} from './memory-command-shared.js';

/**
 * `memory reindex`. The full report's arrays stay on disk / in the default
 * envelope; this replaces them with `{count, names}` views (≤ 2 KB).
 */
export function buildMemoryReindexSummary(report: MemoryReindexReport): Record<string, unknown> {
  const view = {
    view: 'summary',
    apply: report.apply,
    projectRoot: report.projectRoot,
    memoryDir: report.memoryDir,
    indexPath: report.indexPath,
    memoryMdPath: report.memoryMdPath,
    scannedFiles: report.scannedFiles,
    indexed: report.indexed,
    indexedByKind: report.indexedByKind,
    unclassified: boundedNames(
      report.unclassified.map((u) => `${u.name}${u.rawKind === null ? '' : ` (${u.rawKind})`}`)
    ),
    nameConflicts: boundedNames(report.nameConflicts.map((c) => c.name)),
    orphanIndex: boundedNames(report.orphanIndex.map((o) => o.name)),
    orphanDisk: boundedNames(report.orphanDisk.map((p) => p.split(/[\\/]/).pop() ?? p)),
    memoryMd: report.memoryMd,
    writtenFiles: boundedNames(report.writtenFiles.map((p) => p.split(/[\\/]/).pop() ?? p))
  };
  return fitSummaryToBytes(view);
}

export async function runMemoryReindex(
  io: ProgramIO,
  options: MemoryReindexCommandOptions
): Promise<void> {
  const projectRoot = resolveMemoryProjectRoot(options.project);

  if (options.dryRun === true && options.apply === true) {
    printResult(
      io,
      fail(
        'memory.reindex',
        'INVALID_MEMORY_REINDEX_FLAGS',
        'Use either --dry-run or --apply, not both',
        {},
        ['Run without --apply to preview the drift report, or pass --apply to rebuild']
      ),
      options.json
    );
    process.exitCode = 1;
    return;
  }

  try {
    const report = executeMemoryReindex({ projectRoot, apply: options.apply === true });
    // Slice B: `--summary` keeps the scalar drift counts + names-of-first-N;
    // the full report (with every unclassified/orphan path) stays available
    // by omitting the flag. Default shape is unchanged.
    const data = options.summary === true ? buildMemoryReindexSummary(report) : report;
    printResult(
      io,
      ok('memory.reindex', data, [], reindexNextActions(report, options)),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      memoryFailure({
        command: 'memory.reindex',
        fallbackCode: 'MEMORY_REINDEX_FAILED',
        error,
        projectRoot,
        suggestions: ['Check that the project has a readable .peaks/memory directory']
      }),
      options.json
    );
    process.exitCode = 1;
  }
}

/** The drift notices the report earns, in the report's own field order. */
function reindexNextActions(
  report: MemoryReindexReport,
  options: MemoryReindexCommandOptions
): string[] {
  const nextActions: string[] = [];
  if (options.apply !== true) {
    nextActions.push(
      'Preview only — re-run with --apply to rebuild index.json and regenerate MEMORY.md.'
    );
  }
  if (report.unclassified.length > 0) {
    nextActions.push(
      `${report.unclassified.length} file(s) have no resolvable kind; add \`metadata.type\` (or \`kind:\`) to index them.`
    );
  }
  if (report.orphanIndex.length > 0) {
    nextActions.push(
      `${report.orphanIndex.length} previous index entry(ies) point at missing files; they are dropped from the rebuilt index.`
    );
  }
  if (report.nameConflicts.length > 0) {
    nextActions.push(
      `${report.nameConflicts.length} name collision(s) across files; both entries are kept — rename one file to disambiguate.`
    );
  }
  return nextActions;
}

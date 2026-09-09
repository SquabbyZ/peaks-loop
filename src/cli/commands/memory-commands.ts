import { findProjectRoot } from '../../services/config/config-safety.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { loadMemoryIndex, searchMemory, type MemoryIndexEntry, type ProjectMemoryKind } from '../../services/memory/memory-search-service.js';
import { executeMemoryReindex } from '../../services/memory/project-memory-service.js';
import { executeMemoryIngest } from '../../services/memory/memory-ingest-service.js';
import { pickFromList } from '../../services/fuzzy-matching/fzf-pick-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { join } from 'node:path';

const VALID_KINDS: ReadonlyArray<ProjectMemoryKind> = [
  'project',
  'rule',
  'decision',
  'reference',
  'feedback',
  'convention',
  'module',
  'lesson',
];

export interface MemorySearchCommandOptions {
  query: string;
  kind?: string;
  limit?: number;
  project?: string;
  json?: boolean;
}

export interface MemoryListCommandOptions {
  kind?: string;
  pick?: boolean;
  fzfBin?: string;
  project?: string;
  json?: boolean;
}

export interface MemoryReindexCommandOptions {
  project?: string;
  dryRun?: boolean;
  apply?: boolean;
  json?: boolean;
}

export interface MemoryIngestCommandOptions {
  project?: string;
  sourceDir?: string;
  dryRun?: boolean;
  apply?: boolean;
  json?: boolean;
}

function resolveMemoryProjectRoot(project?: string): string {
  return project !== undefined
    ? resolveCanonicalProjectRoot(project)
    : (findProjectRoot(process.cwd()) ?? process.cwd());
}

export async function runMemoryList(io: ProgramIO, options: MemoryListCommandOptions): Promise<void> {
  const projectRoot = options.project !== undefined
    ? resolveCanonicalProjectRoot(options.project)
    : (findProjectRoot(process.cwd()) ?? process.cwd());

  try {
    const snapshot = loadMemoryIndex(projectRoot);
    const kindFilter = options.kind !== undefined && VALID_KINDS.includes(options.kind as ProjectMemoryKind)
      ? (options.kind as ProjectMemoryKind)
      : undefined;
    const entries = kindFilter === undefined
      ? snapshot.entries
      : snapshot.entries.filter((e) => e.kind === kindFilter);

    const warnings: string[] = [];
    let pickedEntries: MemoryIndexEntry[] = entries;
    let pickedOutputPath: string | null = null;
    let fzfVersion: string | null = null;

    if (options.pick === true) {
      const outputPath = join(projectRoot, '.peaks', 'memory', 'picked.json');
      const byName = new Map(entries.map((e) => [e.name, e] as const));
      const result = await pickFromList<MemoryIndexEntry>({
        items: entries,
        formatLine: (entry) => `${entry.name} | ${entry.kind} | ${entry.description.slice(0, 60)}`,
        parseLine: (line) => {
          const parts = line.split('|').map((p) => p.trim());
          if (parts.length < 1) return null;
          const name = parts[0];
          if (name === undefined || name.length === 0) return null;
          return byName.get(name) ?? null;
        },
        outputPath,
        meta: { kindFilter: kindFilter ?? null, totalCandidates: entries.length },
        ...(options.fzfBin !== undefined ? { fzfBin: options.fzfBin } : {}),
        projectRoot,
        multi: true,
        prompt: 'memory> '
      });
      pickedEntries = [...result.picked];
      pickedOutputPath = result.outputPath;
      fzfVersion = result.fzfVersion;
    }

    const nextActions: string[] = [];
    if (pickedOutputPath !== null) {
      nextActions.push(`Picked ${pickedEntries.length} entr(ies); written to ${pickedOutputPath}`);
    }
    if (entries.length === 0) {
      nextActions.push('No entries match; run `peaks memory extract` to build the index from memory/*.md files.');
    }

    printResult(
      io,
      ok(
        'memory.list',
        {
          indexPath: snapshot.indexPath,
          version: snapshot.version,
          updatedAt: snapshot.updatedAt,
          total: entries.length,
          kindFilter: kindFilter ?? null,
          entries,
          ...(options.pick === true ? { picked: pickedEntries, pickedOutputPath, fzfVersion } : {})
        },
        warnings,
        nextActions
      ),
      options.json
    );
  } catch (error) {
    const message = getErrorMessage(error);
    const code = (error as { code?: string }).code ?? 'MEMORY_LIST_FAILED';
    const suggestions: string[] = [];
    if (code === 'INDEX_MISSING') {
      suggestions.push('Run `peaks memory extract` to build the index from memory/*.md files');
    }
    printResult(
      io,
      fail('memory.list', code, message, { projectRoot }, suggestions),
      options.json
    );
    process.exitCode = 1;
  }
}

/**
 * Run the memory search subcommand. Extracted so unit tests can
 * exercise the full envelope without spawning a subprocess.
 */
export async function runMemorySearch(io: ProgramIO, options: MemorySearchCommandOptions): Promise<void> {
  const projectRoot = options.project !== undefined
    ? resolveCanonicalProjectRoot(options.project)
    : (findProjectRoot(process.cwd()) ?? process.cwd());

  const kindFilter = options.kind !== undefined && VALID_KINDS.includes(options.kind as ProjectMemoryKind)
    ? (options.kind as ProjectMemoryKind)
    : undefined;

  try {
    const matches = searchMemory({
      query: options.query,
      projectRoot,
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(kindFilter !== undefined ? { kind: kindFilter } : {}),
    });

    printResult(
      io,
      ok(
        'memory.search',
        {
          query: options.query,
          total: matches.length,
          matches,
          warnings: [],
        },
        []
      ),
      options.json
    );
  } catch (error) {
    const message = getErrorMessage(error);
    const code = (error as { code?: string }).code ?? 'MEMORY_SEARCH_FAILED';
    const suggestions: string[] = [];
    if (code === 'INDEX_MISSING') {
      suggestions.push('Run `peaks memory extract --apply` to build the index from memory/*.md files');
    }
    if (code === 'EMPTY_QUERY') {
      suggestions.push('Use `peaks memory index` to list all entries');
    }
    printResult(
      io,
      fail('memory.search', code, message, { projectRoot, query: options.query }, suggestions),
      options.json
    );
    process.exitCode = 1;
  }
}

/**
 * `peaks memory reindex` — rebuild `.peaks/memory/index.json` from disk and
 * regenerate `MEMORY.md`. Dry-run by default; `--apply` writes.
 */
export async function runMemoryReindex(io: ProgramIO, options: MemoryReindexCommandOptions): Promise<void> {
  const projectRoot = resolveMemoryProjectRoot(options.project);

  if (options.dryRun === true && options.apply === true) {
    printResult(io, fail('memory.reindex', 'INVALID_MEMORY_REINDEX_FLAGS', 'Use either --dry-run or --apply, not both', {}, ['Run without --apply to preview the drift report, or pass --apply to rebuild']), options.json);
    process.exitCode = 1;
    return;
  }

  try {
    const report = executeMemoryReindex({ projectRoot, apply: options.apply === true });
    const nextActions: string[] = [];
    if (options.apply !== true) {
      nextActions.push('Preview only — re-run with --apply to rebuild index.json and regenerate MEMORY.md.');
    }
    if (report.unclassified.length > 0) {
      nextActions.push(`${report.unclassified.length} file(s) have no resolvable kind; add \`metadata.type\` (or \`kind:\`) to index them.`);
    }
    if (report.orphanIndex.length > 0) {
      nextActions.push(`${report.orphanIndex.length} previous index entry(ies) point at missing files; they are dropped from the rebuilt index.`);
    }
    printResult(io, ok('memory.reindex', report, [], nextActions), options.json);
  } catch (error) {
    const message = getErrorMessage(error);
    const code = (error as { code?: string }).code ?? 'MEMORY_REINDEX_FAILED';
    printResult(
      io,
      fail('memory.reindex', code, message, { projectRoot }, ['Check that the project has a readable .peaks/memory directory']),
      options.json
    );
    process.exitCode = 1;
  }
}

/**
 * `peaks memory ingest` — import memories written by the IDE-side agent into
 * `.peaks/memory/`. The IDE-side source is read-only; dry-run by default.
 */
export async function runMemoryIngest(io: ProgramIO, options: MemoryIngestCommandOptions): Promise<void> {
  const projectRoot = resolveMemoryProjectRoot(options.project);

  if (options.dryRun === true && options.apply === true) {
    printResult(io, fail('memory.ingest', 'INVALID_MEMORY_INGEST_FLAGS', 'Use either --dry-run or --apply, not both', {}, ['Run without --apply to preview imports, or pass --apply to write them into .peaks/memory']), options.json);
    process.exitCode = 1;
    return;
  }

  try {
    const report = executeMemoryIngest({
      projectRoot,
      ...(options.sourceDir !== undefined ? { sourceDir: options.sourceDir } : {}),
      apply: options.apply === true
    });
    const nextActions: string[] = [];
    if (options.apply !== true && report.imported.length > 0) {
      nextActions.push('Preview only — re-run with --apply to write these memories into .peaks/memory.');
    }
    if (report.conflicts.length > 0) {
      nextActions.push(`${report.conflicts.length} conflict(s) left both copies in place; resolve them by hand.`);
    }
    if (report.needsClassification.length > 0) {
      nextActions.push(`${report.needsClassification.length} file(s) could not be classified; add \`metadata.type\` to the source before re-running.`);
    }
    printResult(io, ok('memory.ingest', report, report.warnings, nextActions), options.json);
  } catch (error) {
    const message = getErrorMessage(error);
    const code = (error as { code?: string }).code ?? 'MEMORY_INGEST_FAILED';
    printResult(
      io,
      fail('memory.ingest', code, message, { projectRoot }, ['Check the --source-dir path and that .peaks/memory is writable']),
      options.json
    );
    process.exitCode = 1;
  }
}

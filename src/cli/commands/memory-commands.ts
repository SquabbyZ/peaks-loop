import { findProjectRoot } from '../../services/config/config-safety.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { loadMemoryIndex, searchMemory, searchMemoryWithResults, type MemoryIndexEntry, type ProjectMemoryKind } from '../../services/memory/memory-search-service.js';
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
  /** When true, call headroom-ai to compress joined match text for LLM-side prompt assembly. */
  compressResults?: boolean;
}

export interface MemoryListCommandOptions {
  kind?: string;
  pick?: boolean;
  fzfBin?: string;
  project?: string;
  json?: boolean;
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
    const out = await searchMemoryWithResults({
      query: options.query,
      projectRoot,
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(kindFilter !== undefined ? { kind: kindFilter } : {}),
    }, {
      ...(options.compressResults === true ? { compressResults: true } : {})
    });

    printResult(
      io,
      ok(
        'memory.search',
        {
          query: options.query,
          total: out.matches.length,
          matches: out.matches,
          ...(out.compressedResults !== null ? { compressedResults: out.compressedResults } : {}),
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

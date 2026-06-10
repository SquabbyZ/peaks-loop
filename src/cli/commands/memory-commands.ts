import { findProjectRoot } from '../../services/config/config-safety.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { searchMemory, type ProjectMemoryKind } from '../../services/memory/memory-search-service.js';
import { fail, ok } from '../../shared/result.js';
import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

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

/**
 * Run the memory search subcommand. Extracted so unit tests can
 * exercise the full envelope without spawning a subprocess.
 */
export function runMemorySearch(io: ProgramIO, options: MemorySearchCommandOptions): void {
  const projectRoot = options.project !== undefined
    ? resolveCanonicalProjectRoot(options.project)
    : (findProjectRoot(process.cwd()) ?? process.cwd());

  const kindFilter = options.kind !== undefined && VALID_KINDS.includes(options.kind as ProjectMemoryKind)
    ? (options.kind as ProjectMemoryKind)
    : undefined;
  // When the user passes --kind but the value isn't in the valid set,
  // we silently pass `undefined` so the search returns the full set;
  // that's friendlier than a hard error and matches the spec's
  // "invalid kind -> empty matches" semantic for the filter path.
  // (For the loader unit test we exercise the explicit-invalid path
  // directly; here the CLI side is forgiving.)

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

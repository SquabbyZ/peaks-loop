// src/cli/commands/memory-search-command.ts
//
// `peaks memory search` — deterministic, local, zero-token fuzzy search over
// the memory index. Extracted from `memory-commands.ts`; the envelope, the
// flags and the exported symbol name are unchanged.

import { ok } from 'peaks-loop-shared/result';

import { searchMemory } from '../../services/memory/memory-search-service.js';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import {
  memoryFailure,
  resolveKindFilter,
  resolveMemoryProjectRoot,
  type MemorySearchCommandOptions
} from './memory-command-shared.js';

/** The one action each named failure earns. */
const SEARCH_HINTS: Readonly<Record<string, string>> = {
  INDEX_MISSING: 'Run `peaks memory extract --apply` to build the index from memory/*.md files',
  EMPTY_QUERY: 'Use `peaks memory index` to list all entries'
};

/**
 * Run the memory search subcommand. Extracted so unit tests can
 * exercise the full envelope without spawning a subprocess.
 */
export async function runMemorySearch(
  io: ProgramIO,
  options: MemorySearchCommandOptions
): Promise<void> {
  const projectRoot = resolveMemoryProjectRoot(options.project);
  const kindFilter = resolveKindFilter(options.kind);

  try {
    const matches = searchMemory({
      query: options.query,
      projectRoot,
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(kindFilter !== undefined ? { kind: kindFilter } : {})
    });

    printResult(
      io,
      ok(
        'memory.search',
        {
          query: options.query,
          total: matches.length,
          matches,
          warnings: []
        },
        []
      ),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      memoryFailure({
        command: 'memory.search',
        fallbackCode: 'MEMORY_SEARCH_FAILED',
        error,
        projectRoot,
        byCode: SEARCH_HINTS
      }),
      options.json
    );
    process.exitCode = 1;
  }
}

// src/cli/commands/memory-commands.ts
//
// The `peaks memory` run functions, one module per verb:
//
//   read  : `memory-list-command.ts`, `memory-search-command.ts`
//   write : `memory-reindex-command.ts`, `memory-rotate-command.ts`,
//           `memory-ingest-command.ts`
//   shared: `memory-command-shared.ts` (option types, project root, failures)
//
// The Commander wiring lives in `core/memory-command.ts`, which reaches these
// functions by dynamic `import('../memory-commands.js')`; this module is the
// path it names and keeps re-exporting every symbol it used to define, so
// `tests/unit/cli/commands/summary-flag.test.ts` and
// `tests/unit/services/context/summary-view.test.ts` need no edit.

export type {
  MemoryIngestCommandOptions,
  MemoryListCommandOptions,
  MemoryReindexCommandOptions,
  MemoryRotateCommandOptions,
  MemorySearchCommandOptions
} from './memory-command-shared.js';
export { buildMemoryListSummary, runMemoryList } from './memory-list-command.js';
export { buildMemoryReindexSummary, runMemoryReindex } from './memory-reindex-command.js';
export { runMemoryIngest } from './memory-ingest-command.js';
export { runMemoryRotate } from './memory-rotate-command.js';
export { runMemorySearch } from './memory-search-command.js';

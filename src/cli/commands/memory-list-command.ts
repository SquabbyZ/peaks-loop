// src/cli/commands/memory-list-command.ts
//
// `peaks memory list` — read `.peaks/memory/index.json`, optionally with fzf
// multi-select, plus the Slice B `--summary` view. Extracted from
// `memory-commands.ts`; the envelope, the flags and the exported symbol names
// are unchanged.

import { join } from 'node:path';
import { ok } from 'peaks-loop-shared/result';

import { boundedNames, fitSummaryToBytes } from '../../services/context/summary-view.js';
import { pickFromList } from '../../services/fuzzy-matching/fzf-pick-service.js';
import {
  loadMemoryIndex,
  type MemoryIndexEntry,
  type MemoryIndexSnapshot,
  type ProjectMemoryKind
} from '../../services/memory/memory-search-service.js';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import {
  memoryFailure,
  resolveKindFilter,
  resolveMemoryProjectRoot,
  type MemoryListCommandOptions
} from './memory-command-shared.js';

/**
 * Slice B: bounded view of `memory list`. `count` is the true total; `names`
 * carries `name (kind)` labels for the first N entries.
 */
export function buildMemoryListSummary(data: {
  snapshot: MemoryIndexSnapshot;
  entries: readonly MemoryIndexEntry[];
  kindFilter: ProjectMemoryKind | undefined;
  pickedEntries: readonly MemoryIndexEntry[];
  pickedOutputPath: string | null;
  fzfVersion: string | null;
}): Record<string, unknown> {
  const label = (e: MemoryIndexEntry): string => `${e.name} (${e.kind})`;
  const view: Record<string, unknown> = {
    view: 'summary',
    indexPath: data.snapshot.indexPath,
    version: data.snapshot.version,
    updatedAt: data.snapshot.updatedAt,
    total: data.entries.length,
    kindFilter: data.kindFilter ?? null,
    entries: boundedNames(data.entries.map(label))
  };
  if (data.pickedOutputPath !== null) {
    view.picked = boundedNames(data.pickedEntries.map(label));
    view.pickedOutputPath = data.pickedOutputPath;
    view.fzfVersion = data.fzfVersion;
  }
  return fitSummaryToBytes(view);
}

/** What the fzf branch (when `--pick` is set) contributes to the envelope. */
interface PickedMemory {
  readonly pickedEntries: readonly MemoryIndexEntry[];
  readonly pickedOutputPath: string | null;
  readonly fzfVersion: string | null;
}

export async function runMemoryList(
  io: ProgramIO,
  options: MemoryListCommandOptions
): Promise<void> {
  const projectRoot = resolveMemoryProjectRoot(options.project);

  try {
    const snapshot = loadMemoryIndex(projectRoot);
    const kindFilter = resolveKindFilter(options.kind);
    const entries =
      kindFilter === undefined
        ? snapshot.entries
        : snapshot.entries.filter((e) => e.kind === kindFilter);
    const picked = await pickMemoryEntries(projectRoot, entries, kindFilter, options);
    const data = memoryListData({ snapshot, entries, kindFilter, options, picked });
    printResult(io, ok('memory.list', data, [], listNextActions(entries, picked)), options.json);
  } catch (error) {
    printResult(
      io,
      memoryFailure({
        command: 'memory.list',
        fallbackCode: 'MEMORY_LIST_FAILED',
        error,
        projectRoot,
        byCode: {
          INDEX_MISSING: 'Run `peaks memory extract` to build the index from memory/*.md files'
        }
      }),
      options.json
    );
    process.exitCode = 1;
  }
}

/** The pick notice and the empty-index notice, in that order. */
function listNextActions(entries: readonly MemoryIndexEntry[], picked: PickedMemory): string[] {
  const nextActions: string[] = [];
  if (picked.pickedOutputPath !== null) {
    nextActions.push(
      `Picked ${picked.pickedEntries.length} entr(ies); written to ${picked.pickedOutputPath}`
    );
  }
  if (entries.length === 0) {
    nextActions.push(
      'No entries match; run `peaks memory extract` to build the index from memory/*.md files.'
    );
  }
  return nextActions;
}

/**
 * Slice B: `--summary` swaps the full entry array for a bounded
 * `{count, names}` view. The default (no flag) view is byte-identical to
 * before — the flag is strictly opt-in.
 */
function memoryListData(input: {
  readonly snapshot: MemoryIndexSnapshot;
  readonly entries: MemoryIndexEntry[];
  readonly kindFilter: ProjectMemoryKind | undefined;
  readonly options: MemoryListCommandOptions;
  readonly picked: PickedMemory;
}): Record<string, unknown> {
  const { snapshot, entries, kindFilter, options, picked } = input;
  if (options.summary === true) {
    return buildMemoryListSummary({ snapshot, entries, kindFilter, ...picked });
  }
  return {
    indexPath: snapshot.indexPath,
    version: snapshot.version,
    updatedAt: snapshot.updatedAt,
    total: entries.length,
    kindFilter: kindFilter ?? null,
    entries,
    ...(options.pick === true
      ? {
          picked: picked.pickedEntries,
          pickedOutputPath: picked.pickedOutputPath,
          fzfVersion: picked.fzfVersion
        }
      : {})
  };
}

/** The `--pick` branch, or the unchanged entry list when the flag is absent. */
async function pickMemoryEntries(
  projectRoot: string,
  entries: MemoryIndexEntry[],
  kindFilter: ProjectMemoryKind | undefined,
  options: MemoryListCommandOptions
): Promise<PickedMemory> {
  if (options.pick !== true) {
    return { pickedEntries: entries, pickedOutputPath: null, fzfVersion: null };
  }
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
  return {
    pickedEntries: [...result.picked],
    pickedOutputPath: result.outputPath,
    fzfVersion: result.fzfVersion
  };
}

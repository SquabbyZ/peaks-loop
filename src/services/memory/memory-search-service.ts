import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fuzzyMatchWithKey } from '../fuzzy-matching/fuzzy-match-service.js';

// Re-export the canonical ProjectMemoryKind from the existing memory
// service so callers can use a single import surface.
export type { ProjectMemoryKind } from './project-memory-service.js';
import type { ProjectMemoryKind } from './project-memory-service.js';

const DEFAULT_LIMIT = 6;

/**
 * One entry in `.peaks/memory/index.json` after the on-disk `hot[]` +
 * `cold[]` arrays are flattened. Mirrors the field shape that the
 * existing `project-memory-service.ts` writer emits.
 */
export interface MemoryIndexEntry {
  name: string;
  kind: ProjectMemoryKind;
  description: string;
  sourcePath: string;
  sourceArtifact: string | null;
  updatedAt: string;
}

/**
 * The full snapshot of `.peaks/memory/index.json`.
 */
export interface MemoryIndexSnapshot {
  indexPath: string;
  version: number;
  updatedAt: string;
  entries: MemoryIndexEntry[];
}

/**
 * Input to `searchMemory`. `projectRoot` defaults to the resolved
 * peaks project root (CLI resolves this before calling). `query` is
 * required and non-empty.
 */
export interface MemorySearchInput {
  query: string;
  projectRoot?: string;
  limit?: number;
  kind?: ProjectMemoryKind;
}

/**
 * One hit returned by `searchMemory`. Mirrors the entry shape with a
 * normalized score in [0, 1] (top of batch = 1.0) and the char indices
 * in the searchable text that contributed to the match.
 */
export interface MemorySearchResult {
  name: string;
  kind: ProjectMemoryKind;
  description: string;
  sourcePath: string;
  score: number;
  positions: number[];
}

/**
 * Read `.peaks/memory/index.json` and flatten the on-disk `hot[<kind>][]`
 * + `cold[]` shape into a single `entries[]` array. Throws structured
 * errors with stable `code` markers that the CLI converts to the
 * peaks envelope.
 */
export function loadMemoryIndex(projectRoot: string): MemoryIndexSnapshot {
  const indexPath = join(projectRoot, '.peaks', 'memory', 'index.json');
  if (!existsSync(indexPath)) {
    const err = new Error(`INDEX_MISSING: memory index not found at ${indexPath}`) as Error & { code?: string };
    err.code = 'INDEX_MISSING';
    throw err;
  }
  let raw: string;
  try {
    raw = readFileSync(indexPath, 'utf8');
  } catch (cause) {
    const err = new Error(`INDEX_INVALID: failed to read memory index at ${indexPath}: ${(cause as Error).message}`) as Error & { code?: string };
    err.code = 'INDEX_INVALID';
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    const err = new Error(`INDEX_INVALID: malformed memory index at ${indexPath}: ${(cause as Error).message}`) as Error & { code?: string };
    err.code = 'INDEX_INVALID';
    throw err;
  }
  const index = parsed as { version?: number; updatedAt?: string; hot?: Record<string, MemoryIndexEntry[]>; cold?: MemoryIndexEntry[] };
  const hot = index.hot ?? {};
  const flatFromHot = Object.values(hot).flat() as MemoryIndexEntry[];
  const flatFromCold = (index.cold ?? []) as MemoryIndexEntry[];
  const entries = [...flatFromHot, ...flatFromCold];

  return {
    indexPath,
    version: index.version ?? 1,
    updatedAt: index.updatedAt ?? '',
    entries,
  };
}

/**
 * Run the generic fuzzy kernel against the on-disk memory index. The
 * searchable text is `name + " " + description` for each entry (per
 * spec §Component Details).
 */
export function searchMemory(input: MemorySearchInput): MemorySearchResult[] {
  if (input.query === '') {
    const err = new Error('EMPTY_QUERY: searchMemory requires a non-empty query (use `peaks memory index` to list all)') as Error & { code?: string };
    err.code = 'EMPTY_QUERY';
    throw err;
  }
  const projectRoot = input.projectRoot ?? process.cwd();
  const limit = input.limit ?? DEFAULT_LIMIT;

  const snapshot = loadMemoryIndex(projectRoot);
  let candidates = snapshot.entries;

  if (input.kind !== undefined) {
    candidates = candidates.filter((e) => e.kind === input.kind);
  }

  // Per spec: searchable text is name + " " + description.
  // The keyFn is invoked once per item per call.
  const matches = fuzzyMatchWithKey(
    input.query,
    candidates,
    { keyFn: (e) => `${e.name} ${e.description}`, limit, caseSensitive: false }
  );

  return matches.map((m) => {
    const entry = m.item;
    return {
      name: entry.name,
      kind: entry.kind,
      description: entry.description,
      sourcePath: entry.sourcePath,
      score: m.score,
      positions: m.positions,
    };
  });
}

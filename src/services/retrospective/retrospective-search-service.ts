import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fuzzyMatchWithKey } from '../fuzzy-matching/fuzzy-match-service.js';

// Re-export the canonical types from the existing retrospective service
// so callers can use a single import surface.
export type { RetrospectiveType, RetrospectiveOutcome, RetrospectiveEntry } from './retrospective-index.js';
import type { RetrospectiveType, RetrospectiveOutcome, RetrospectiveEntry } from './retrospective-index.js';

const DEFAULT_LIMIT = 6;

/**
 * Input to `searchRetrospective`. `projectRoot` defaults to `process.cwd()`.
 * `query` is required and non-empty. `type` and `outcome` are optional
 * structured filters that compose with AND.
 */
export interface RetrospectiveSearchInput {
  query: string;
  projectRoot?: string;
  limit?: number;
  type?: RetrospectiveType;
  outcome?: RetrospectiveOutcome;
}

/**
 * One hit returned by `searchRetrospective`. The `artifactPaths` are
 * preserved so the LLM can follow up with `peaks retrospective show
 * <id>` (or read the artifact directly).
 */
export interface RetrospectiveSearchResult {
  id: string;
  sessionId: string;
  type: RetrospectiveType;
  title: string;
  summary: string;
  outcome: RetrospectiveOutcome;
  artifactPaths: string[];
  score: number;
  positions: number[];
}

/**
 * Read `.peaks/retrospective/index.json` and return the entries.
 * Throws structured errors with stable codes that the CLI converts
 * to the peaks envelope.
 */
function readIndex(projectRoot: string): RetrospectiveEntry[] {
  const resolvedRoot = resolve(projectRoot);
  const indexPath = join(resolvedRoot, '.peaks', 'retrospective', 'index.json');
  if (!existsSync(indexPath)) {
    const err = new Error(`INDEX_MISSING: retrospective index not found at ${indexPath}`) as Error & { code?: string };
    err.code = 'INDEX_MISSING';
    throw err;
  }
  let raw: string;
  try {
    raw = readFileSync(indexPath, 'utf8');
  } catch (cause) {
    const err = new Error(`INDEX_INVALID: failed to read retrospective index at ${indexPath}: ${(cause as Error).message}`) as Error & { code?: string };
    err.code = 'INDEX_INVALID';
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    const err = new Error(`INDEX_INVALID: malformed retrospective index at ${indexPath}: ${(cause as Error).message}`) as Error & { code?: string };
    err.code = 'INDEX_INVALID';
    throw err;
  }
  const index = parsed as { entries?: RetrospectiveEntry[] };
  return Array.isArray(index.entries) ? index.entries : [];
}

/**
 * Run the generic fuzzy kernel against the on-disk retrospective index.
 * Searchable text is `title + " " + summary` per spec §Component Details.
 * `--type` and `--outcome` filters compose with AND before the kernel
 * runs (cheaper to filter, then fuzzy on a smaller set).
 */
export function searchRetrospective(input: RetrospectiveSearchInput): RetrospectiveSearchResult[] {
  if (input.query === '') {
    const err = new Error('EMPTY_QUERY: searchRetrospective requires a non-empty query (use `peaks retrospective index` to list all)') as Error & { code?: string };
    err.code = 'EMPTY_QUERY';
    throw err;
  }
  const projectRoot = input.projectRoot ?? process.cwd();
  const limit = input.limit ?? DEFAULT_LIMIT;

  let candidates = readIndex(projectRoot);

  if (input.type !== undefined) {
    candidates = candidates.filter((e) => e.type === input.type);
  }
  if (input.outcome !== undefined) {
    candidates = candidates.filter((e) => e.outcome === input.outcome);
  }

  const matches = fuzzyMatchWithKey(
    input.query,
    candidates,
    { keyFn: (e) => `${e.title} ${e.summary}`, limit, caseSensitive: false }
  );

  return matches.map((m) => {
    const entry = m.item;
    return {
      id: entry.id,
      sessionId: entry.sessionId,
      type: entry.type,
      title: entry.title,
      summary: entry.summary,
      outcome: entry.outcome,
      artifactPaths: entry.artifactPaths,
      score: m.score,
      positions: m.positions,
    };
  });
}

export interface CompressedRetrospectiveResultsEnvelope {
  readonly mode: 'balanced' | 'aggressive' | 'conservative';
  readonly originalSize: number;
  readonly compressedSize: number;
  readonly compressionRatio: number;
  readonly compressedText: string;
  readonly warning: string | null;
}

export interface RetrospectiveSearchWithResults {
  readonly matches: RetrospectiveSearchResult[];
  readonly compressedResults: CompressedRetrospectiveResultsEnvelope | null;
}

export interface RetrospectiveSearchOptions {
  /** When true, compress joined match text via headroom-ai. Falls back
   *  silently to the structured `matches` array on failure. */
  readonly compressResults?: boolean;
}

import { compressPrompt as compressPromptForRetro, type HeadroomResult as HeadroomResultForRetro } from '../context/headroom-client.js';
import { loadPreferences as loadPreferencesForRetro } from '../preferences/preferences-service.js';
import { shouldCompressResults as shouldCompressResultsForRetro } from '../context/headroom-prefs.js';

export async function searchRetrospectiveWithResults(
  input: RetrospectiveSearchInput,
  options: RetrospectiveSearchOptions = {}
): Promise<RetrospectiveSearchWithResults> {
  const matches = searchRetrospective(input);
  if (options.compressResults !== true) {
    return { matches, compressedResults: null };
  }

  const projectRoot = input.projectRoot ?? process.cwd();
  const prefs = loadPreferencesForRetro(projectRoot).headroom;
  const joinedText = matches.map((m) => `${m.title}: ${m.summary}`).join('\n');
  const joinedBytes = Buffer.byteLength(joinedText, 'utf8');
  const decision = shouldCompressResultsForRetro(prefs, joinedBytes, 'retrospectiveSearch');
  if (!decision.compress) {
    return { matches, compressedResults: null };
  }

  const result: HeadroomResultForRetro = await compressPromptForRetro(joinedText, decision.mode);
  if (result.warning !== null || result.compressedPrompt === null) {
    return { matches, compressedResults: null };
  }

  return {
    matches,
    compressedResults: {
      mode: decision.mode,
      originalSize: result.originalSize,
      compressedSize: result.compressedSize,
      compressionRatio: result.compressionRatio,
      compressedText: result.compressedPrompt,
      warning: result.warning
    }
  };
}

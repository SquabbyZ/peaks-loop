/**
 * Incremental refresh of the stored graph: which entries a moved spacing token
 * reaches, and the bounded batches a refresh is split into. The persisted index
 * names the population and answers when it still matches the route directories;
 * only a disagreement falls back to parsing the entries.
 */
import { readdirSync } from 'node:fs';

import { readIndex, scanEntries } from './layout-graph-index.js';
import { readTokenIndex, tokenIndexFromDisk, type TokenRef } from './layout-graph-token-index.js';
import {
  entryDigest,
  entryFileName,
  graphRoot,
  keyText,
  routeSlug,
  type EntryKey,
  type IndexedEntry
} from './layout-graph-paths.js';
import type { Viewport } from './layout-geometry.js';
import type { SpacingToken } from './layout-tokens.js';

// eslint-disable-next-line no-magic-numbers -- the batch bound is a declared contract: fifty routes, six hundred entries.
export const MAX_BATCH_ROUTES = 50;
// eslint-disable-next-line no-magic-numbers -- the batch bound is a declared contract: fifty routes, six hundred entries.
export const MAX_BATCH_ENTRIES = 600;

export type RefreshTarget = {
  route: string;
  state: string;
  viewport: Viewport;
  url: string;
};

export type AffectedMode = 'index' | 'entries' | 'full';

export type AffectedEntries = {
  /** `index` read a complete reverse index, `entries` rebuilt it, `full` could read no entry. */
  mode: AffectedMode;
  affected: EntryKey[];
  unchanged: EntryKey[];
  changedTokens: string[];
  /** Why the reverse index could not be used, or null when it was. */
  reason: string | null;
  /** True when the persisted reverse index no longer describes the entries on disk. */
  needsRewrite: boolean;
};

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * The entries whose cited value for a changed token no longer matches, plus the
 * entries that now also cite a token the contract added at a value they already
 * carry.
 */
export function affectedFromIndex(
  tokens: ReadonlyMap<string, TokenRef[]>,
  next: readonly SpacingToken[]
): { affected: EntryKey[]; changedTokens: string[] } {
  const now = new Map(next.map((token) => [token.name, token.value]));
  const addedByValue = new Map<string, string>();
  for (const token of next) {
    if (!tokens.has(token.name)) addedByValue.set(token.value, token.name);
  }
  const hits = new Map<string, EntryKey>();
  const changed = new Set<string>();
  for (const [name, refs] of tokens) {
    const value = now.get(name) ?? null;
    const moved = refs.filter((ref) => value === null || ref.value !== value);
    if (moved.length > 0) {
      changed.add(name);
      for (const ref of moved) hits.set(keyText(ref.key), ref.key);
    }
    for (const ref of refs) {
      const added = addedByValue.get(ref.value);
      if (added === undefined) continue;
      changed.add(added);
      hits.set(keyText(ref.key), ref.key);
    }
  }
  return {
    affected: [...hits.values()].sort((left, right) => compareText(keyText(left), keyText(right))),
    changedTokens: [...changed].sort(compareText)
  };
}

type AffectedSource = { reason: string | null; needsRewrite: boolean };

function finishAffected(
  mode: AffectedMode,
  indexed: readonly EntryKey[],
  found: { affected: EntryKey[]; changedTokens: string[] },
  source: AffectedSource
): AffectedEntries {
  const affected = new Set(found.affected.map(keyText));
  return {
    mode,
    affected: found.affected,
    unchanged: indexed.filter((entry) => !affected.has(keyText(entry))),
    changedTokens: found.changedTokens,
    reason: source.reason,
    needsRewrite: source.needsRewrite
  };
}

function nothing(reason: string): AffectedEntries {
  return {
    mode: 'full',
    affected: [],
    unchanged: [],
    changedTokens: [],
    reason,
    needsRewrite: true
  };
}

/** True when the persisted reverse index names every entry the population holds. */
function coversAll(tokens: ReadonlyMap<string, TokenRef[]>, keys: readonly EntryKey[]): boolean {
  const known = new Set<string>();
  for (const refs of tokens.values()) {
    for (const ref of refs) known.add(keyText(ref.key));
  }
  return keys.every((key) => known.has(keyText(key)));
}

export type DirMatch = { ok: true; matches: boolean } | { ok: false; reason: string };

type FilesRead = { ok: true; files: Set<string> } | { ok: false; reason: string };

/**
 * Every entry file under the graph root, relative and POSIX, in one traversal.
 * Names only, so a file added or removed since the index was written is noticed
 * without parsing anything. Root-level files (the two indexes) are excluded.
 */
function entryFiles(projectRoot: string): FilesRead {
  let names: string[];
  try {
    names = readdirSync(graphRoot(projectRoot), { recursive: true, encoding: 'utf8' });
  } catch (error) {
    return {
      ok: false,
      reason: `the graph root could not be read (${error instanceof Error ? error.message : String(error)})`
    };
  }
  const files = new Set(
    names
      .map((name) => name.replace(/\\/g, '/'))
      .filter((name) => name.includes('/') && name.endsWith('.txt'))
  );
  return { ok: true, files };
}

/**
 * Does the index describe the route directories exactly? Names are compared
 * against one traversal, then every row's digest against the file it names, so a
 * route written straight into its directory and a same-name rewrite both send
 * the caller to the full scan instead of being trusted.
 */
export function indexMatchesDirectories(
  projectRoot: string,
  entries: readonly IndexedEntry[]
): DirMatch {
  const actual = entryFiles(projectRoot);
  if (!actual.ok) return actual;
  const named = new Set(
    entries.map(
      (entry) => `${routeSlug(entry.route)}/${entryFileName(entry.state, entry.viewport)}`
    )
  );
  if (named.size !== actual.files.size) return { ok: true, matches: false };
  for (const file of actual.files) if (!named.has(file)) return { ok: true, matches: false };
  return {
    ok: true,
    matches: entries.every((entry) => entryDigest(projectRoot, entry) === entry.digest)
  };
}

/**
 * The index-derived population, or null when the index cannot be trusted as one.
 * The two small index files are read first: a missing token index is expected and
 * must not cost the directory traversal.
 */
function fromIndex(projectRoot: string, tokens: readonly SpacingToken[]): AffectedEntries | null {
  const index = readIndex(projectRoot);
  if (!index.ok) return null;
  const keys: EntryKey[] = index.entries.map(({ route, state, viewport }) => ({
    route,
    state,
    viewport
  }));
  const tokenIndex = readTokenIndex(projectRoot);
  if (!tokenIndex.ok || !coversAll(tokenIndex.tokens, keys)) return null;
  const match = indexMatchesDirectories(projectRoot, index.entries);
  if (!match.ok) return null;
  if (!match.matches) return null;
  return finishAffected('index', keys, affectedFromIndex(tokenIndex.tokens, tokens), {
    reason: null,
    needsRewrite: false
  });
}

/** The population rebuilt by parsing every entry, used when the index cannot answer. */
function fromEntries(projectRoot: string, tokens: readonly SpacingToken[]): AffectedEntries {
  const scanned = scanEntries(projectRoot);
  if (!scanned.ok) return nothing(scanned.reason);
  const rebuilt = tokenIndexFromDisk(projectRoot);
  if (!rebuilt.ok) return nothing(rebuilt.reason);
  return finishAffected('entries', scanned.entries, affectedFromIndex(rebuilt.tokens, tokens), {
    reason: 'the persisted indexes do not name every entry',
    needsRewrite: true
  });
}

/**
 * Which entries a token change reaches. The index-derived population is used
 * only when it matches the route directories exactly; anything else parses the
 * entries, so an index that went stale cannot hide or invent a route.
 */
export function affectedEntries(
  projectRoot: string,
  tokens: readonly SpacingToken[]
): AffectedEntries {
  return fromIndex(projectRoot, tokens) ?? fromEntries(projectRoot, tokens);
}

/**
 * Split a refresh list so one batch never exceeds the declared bound. `full` is
 * false when the list was split, so a caller can say that it covered only part.
 */
export function batchTargets(targets: readonly RefreshTarget[]): {
  batches: RefreshTarget[][];
  full: boolean;
} {
  const batches: RefreshTarget[][] = [];
  let current: RefreshTarget[] = [];
  let routes = new Set<string>();
  for (const target of targets) {
    const routeCount = routes.has(target.route) ? routes.size : routes.size + 1;
    const over =
      current.length > 0 &&
      (routeCount > MAX_BATCH_ROUTES || current.length + 1 > MAX_BATCH_ENTRIES);
    if (over) {
      batches.push(current);
      current = [];
      routes = new Set();
    }
    current.push(target);
    routes.add(target.route);
  }
  if (current.length > 0) batches.push(current);
  return { batches, full: batches.length <= 1 };
}

/**
 * Where the graph lives on disk: one directory per route (the route's words
 * plus a digest of the exact route), one file per `(state, viewport)`, and a
 * captures/ sidecar beside the entries. Nothing here reads an entry.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Viewport } from './layout-geometry.js';

export const INDEX_FILE = 'index.txt';
export const INDEX_MAGIC = 'lgi 1';
export const COVERAGE_FILE = 'coverage.json';

/** How one key of a route's state matrix was obtained. */
export type CoverageVerdict = 'real' | 'failed' | 'state-unavailable';

/** One key of a route's state matrix, with the named reason when it is not real. */
export type CoverageKey = {
  state: string;
  viewport: Viewport;
  verdict: CoverageVerdict;
  reason?: string;
};

/** The route-level verdict: complete only when every expected key is a real entry. */
export type RouteCoverage = {
  route: string;
  complete: boolean;
  completeKeys: number;
  expectedKeys: number;
  /** The `<state>@<WxH>` keys that are not real entries. */
  missing: string[];
  keys: CoverageKey[];
};

const SLUG_MAX = 60;
const SLUG_DIGEST = 6;
const TEXT_SUFFIX = '.txt';
const JSON_SUFFIX = '.json';
const SLUG_JUNK = /[^a-z0-9]+/gi;
const SLUG_EDGES = /^-+|-+$/g;
const STATE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
/** Sixty-four bits of digest, the same width the entry header uses. */
const DIGEST_LENGTH = 16;

export type EntryKey = { route: string; state: string; viewport: Viewport };

/** An index row: the coordinate, the file it names, and the bytes it was written from. */
export type IndexedEntry = EntryKey & { path: string; digest: string };

export type StoreWrite = { ok: true; path: string } | { ok: false; reason: string };

export function graphRoot(projectRoot: string): string {
  return join(projectRoot, '.peaks', 'layout-graph');
}

/**
 * One directory name per route: the route's words, lowercased, plus a short
 * digest of the exact route. The digest keeps two routes that clean up to the
 * same words separate instead of letting one entry overwrite the other.
 */
export function routeSlug(route: string): string {
  const words = route
    .replace(/^\/+/, '')
    .replace(SLUG_JUNK, '-')
    .replace(SLUG_EDGES, '')
    .toLowerCase();
  const base = words.slice(0, SLUG_MAX) || 'page';
  const digest = createHash('sha256').update(route).digest('hex').slice(0, SLUG_DIGEST);
  return `${base}-${digest}`;
}

export function entryFileName(state: string, viewport: Viewport): string {
  return `${state}@${String(viewport.width)}x${String(viewport.height)}${TEXT_SUFFIX}`;
}

export function entryPath(projectRoot: string, key: EntryKey): string {
  return join(graphRoot(projectRoot), routeSlug(key.route), entryFileName(key.state, key.viewport));
}

/** Where the measured document a build used is kept, beside its entry. */
export function capturePath(projectRoot: string, key: EntryKey): string {
  return join(
    graphRoot(projectRoot),
    routeSlug(key.route),
    'captures',
    entryFileName(key.state, key.viewport).replace(TEXT_SUFFIX, JSON_SUFFIX)
  );
}

export function viewportKey(viewport: Viewport): string {
  return `${String(viewport.width)}x${String(viewport.height)}`;
}

const COORDINATE_PATTERN = /^([a-z0-9][a-z0-9-]*)@(\d+)x(\d+)$/;

/** A `<state>@<WxH>` coordinate, or null when the text is not one. */
export function parseCoordinate(text: string): { state: string; viewport: Viewport } | null {
  const match = COORDINATE_PATTERN.exec(text.trim());
  const state = match?.[1];
  const width = match?.[2];
  const height = match?.[3];
  if (state === undefined || width === undefined || height === undefined) return null;
  const viewport = { width: Number(width), height: Number(height) };
  return viewport.width > 0 && viewport.height > 0 ? { state, viewport } : null;
}

export type KeyComparison =
  | { verdict: 'comparable' }
  | { verdict: 'not-comparable'; reason: string; from: string; to: string };

export type ComparisonRead =
  { ok: true; comparison: KeyComparison } | { ok: false; reason: string };

/** Two coordinates are comparable only when they are the same key. */
export function compareEntryKeys(from: EntryKey, to: EntryKey): KeyComparison {
  const differing: string[] = [];
  if (from.route !== to.route) differing.push('route');
  if (from.state !== to.state) differing.push('state');
  if (from.viewport.width !== to.viewport.width || from.viewport.height !== to.viewport.height) {
    differing.push('viewport');
  }
  if (differing.length === 0) return { verdict: 'comparable' };
  return {
    verdict: 'not-comparable',
    reason:
      `${differing.join(' and ')} differ: ${keyText(from)} against ${keyText(to)}; ` +
      'only one key can be compared with itself',
    from: keyText(from),
    to: keyText(to)
  };
}

/** The comparison a caller asked for against the entry it selected. */
export function comparisonOf(selection: EntryKey, text: string): ComparisonRead {
  const parsed = parseCoordinate(text);
  if (parsed === null) return { ok: false, reason: `compare must be state@WxH, not "${text}"` };
  return {
    ok: true,
    comparison: compareEntryKeys(selection, {
      route: selection.route,
      state: parsed.state,
      viewport: parsed.viewport
    })
  };
}

/** Where a route's coverage verdict is recorded, beside its entries. */
export function coveragePath(projectRoot: string, route: string): string {
  return join(graphRoot(projectRoot), routeSlug(route), COVERAGE_FILE);
}

/** The route's verdict from one row per expected key; a short matrix is never complete. */
export function routeCoverage(
  route: string,
  keys: readonly CoverageKey[],
  expectedKeys: number
): RouteCoverage {
  const completeKeys = keys.filter((key) => key.verdict === 'real').length;
  return {
    route,
    complete: completeKeys === expectedKeys && keys.length === expectedKeys,
    completeKeys,
    expectedKeys,
    missing: keys
      .filter((key) => key.verdict !== 'real')
      .map((key) => `${key.state}@${viewportKey(key.viewport)}`),
    keys: [...keys]
  };
}

/** The one stable spelling of an entry key, used in index files and as a map key. */
export function keyText(key: EntryKey): string {
  return `${key.route} ${key.state}@${viewportKey(key.viewport)}`;
}

/** A state name that is safe as one path segment and in an `index.txt` row. */
export function safeStateName(state: string): boolean {
  return STATE_PATTERN.test(state);
}

/**
 * The digest of one entry file as an index row records it. A file that cannot be
 * read is `null`, which every caller turns into a named refusal or a fallback.
 */
export function entryDigest(projectRoot: string, key: EntryKey): string | null {
  let text: string | null = null;
  try {
    text = readFileSync(entryPath(projectRoot, key), 'utf8');
  } catch {
    text = null;
  }
  if (text === null) return null;
  return createHash('sha256').update(text).digest('hex').slice(0, DIGEST_LENGTH);
}

/** Why an entry key cannot name a file, or null when it can. */
export function keyRefusal(key: EntryKey): string | null {
  if (key.route.trim() === '') return 'route is empty';
  if (!safeStateName(key.state)) return `state "${key.state}" is not a file-safe name`;
  if (!Number.isInteger(key.viewport.width) || !Number.isInteger(key.viewport.height)) {
    return 'viewport is not two whole numbers';
  }
  if (key.viewport.width < 1 || key.viewport.height < 1) return 'viewport has no area';
  return null;
}

/**
 * The index beside the route directories: every entry on disk, in one
 * deterministic order, rebuilt after each write. Reading it never consults the
 * entries, and a damaged entry makes the scan refuse rather than skip it.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseEntry } from './layout-graph-parse.js';
import { DIGEST_PATTERN } from './layout-graph-fields.js';
import {
  INDEX_FILE,
  INDEX_MAGIC,
  entryDigest,
  entryPath,
  graphRoot,
  keyText,
  safeStateName,
  viewportKey,
  type EntryKey,
  type IndexedEntry,
  type StoreWrite
} from './layout-graph-paths.js';

const VIEWPORT_NAME = /^(\d+)x(\d+)$/;
/** An `entry` row carries the coordinate and the digest of the bytes it names. */
const ENTRY_FIELD_COUNT = 2;

export type IndexRead = { ok: true; entries: IndexedEntry[] } | { ok: false; reason: string };

export type ScanRead = { ok: true; entries: EntryKey[] } | { ok: false; reason: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Locale-independent text order, so a graph does not depend on the host locale. */
function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

type DirRead = { ok: true; entries: EntryKey[] } | { ok: false; reason: string };

/** The entries under one route directory; a damaged entry refuses the scan. */
function scanDir(root: string, dir: string): DirRead {
  let files: string[];
  try {
    files = readdirSync(join(root, dir))
      .filter((name) => name.endsWith('.txt'))
      .sort(compareText);
  } catch (error) {
    return { ok: false, reason: `${dir} could not be read (${errorText(error)})` };
  }
  const found: EntryKey[] = [];
  for (const file of files) {
    const relative = join(dir, file).split('\\').join('/');
    let text: string;
    try {
      text = readFileSync(join(root, dir, file), 'utf8');
    } catch (error) {
      return { ok: false, reason: `${relative} could not be read (${errorText(error)})` };
    }
    const read = parseEntry(text);
    if (!read.ok)
      return { ok: false, reason: `${relative} is not a readable entry (${read.reason})` };
    found.push({
      route: read.entry.route,
      state: read.entry.state,
      viewport: read.entry.viewport
    });
  }
  return { ok: true, entries: found };
}

/** Every entry file currently on disk, in deterministic order. */
export function scanEntries(projectRoot: string): ScanRead {
  const root = graphRoot(projectRoot);
  if (!existsSync(root)) return { ok: true, entries: [] };
  let dirs: string[];
  try {
    dirs = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareText);
  } catch (error) {
    return { ok: false, reason: `the graph root could not be read (${errorText(error)})` };
  }
  const found: EntryKey[] = [];
  for (const dir of dirs) {
    const read = scanDir(root, dir);
    if (!read.ok) return read;
    found.push(...read.entries);
  }
  return {
    ok: true,
    entries: found.sort(
      (left, right) =>
        compareText(left.route, right.route) ||
        compareText(left.state, right.state) ||
        left.viewport.width - right.viewport.width ||
        left.viewport.height - right.viewport.height
    )
  };
}

function indexLines(entries: readonly IndexedEntry[]): string[] {
  const routes = new Map<string, IndexedEntry[]>();
  for (const entry of entries) {
    const list = routes.get(entry.route) ?? [];
    list.push(entry);
    routes.set(entry.route, list);
  }
  const lines = [INDEX_MAGIC];
  for (const [route, list] of routes) {
    lines.push(`route ${route}`, `entry-count ${String(list.length)}`);
    for (const entry of list) {
      lines.push(`entry ${entry.state}@${viewportKey(entry.viewport)} ${entry.digest}`);
    }
  }
  lines.push(`routes ${String(routes.size)}`);
  return lines;
}

/** Rewrite the index from the entries on disk, each row carrying its file's digest. */
export function writeIndex(projectRoot: string): StoreWrite {
  const scanned = scanEntries(projectRoot);
  if (!scanned.ok) return scanned;
  const rows: IndexedEntry[] = [];
  for (const key of scanned.entries) {
    const digest = entryDigest(projectRoot, key);
    if (digest === null) {
      return { ok: false, reason: `${keyText(key)} could not be read for the index` };
    }
    rows.push({ ...key, path: entryPath(projectRoot, key), digest });
  }
  const path = join(graphRoot(projectRoot), INDEX_FILE);
  try {
    mkdirSync(graphRoot(projectRoot), { recursive: true });
    writeFileSync(path, `${indexLines(rows).join('\n')}\n`, 'utf8');
    return { ok: true, path };
  } catch (error) {
    return { ok: false, reason: `the graph index could not be written (${errorText(error)})` };
  }
}

type IndexState = {
  route: string | null;
  expected: number;
  seen: number;
  routes: number;
  entries: IndexedEntry[];
};

function closeRoute(state: IndexState): string | null {
  if (state.route === null) return null;
  return state.seen === state.expected
    ? null
    : `route ${state.route} declares ${String(state.expected)} and lists ${String(state.seen)}`;
}

function applyRoute(state: IndexState, line: string): string | null {
  const problem = closeRoute(state);
  if (problem !== null) return problem;
  const route = line.slice('route '.length);
  if (route.trim() === '') return 'the graph index names an empty route';
  state.route = route;
  state.expected = -1;
  state.seen = 0;
  state.routes += 1;
  return null;
}

function applyCount(state: IndexState, line: string): string | null {
  const digits = line.slice('entry-count '.length);
  if (!/^\d+$/.test(digits) || state.route === null) return 'the graph index has a stray count';
  state.expected = Number(digits);
  return null;
}

function applyRoutes(state: IndexState, line: string): string | null {
  const declared = Number(line.slice('routes '.length));
  return declared === state.routes ? null : 'the graph index miscounts its routes';
}

type EntryRow = { state: string; width: string; height: string; digest: string };

/** The `<state>@WxH` half of a row, or null when it is malformed. */
function parseCoordinate(name: string): { state: string; width: string; height: string } | null {
  const at = name.indexOf('@');
  const match = at === -1 ? null : VIEWPORT_NAME.exec(name.slice(at + 1));
  const state = at === -1 ? null : name.slice(0, at);
  const width = match?.[1];
  const height = match?.[2];
  if (state === null || !safeStateName(state) || width === undefined || height === undefined) {
    return null;
  }
  return { state, width, height };
}

/** One `entry` row: coordinate, viewport and the digest of the bytes it names. */
function parseEntryRow(line: string): EntryRow | null {
  const fields = line.slice('entry '.length).split(' ');
  const name = fields[0];
  const digest = fields[1];
  if (name === undefined || digest === undefined || fields.length !== ENTRY_FIELD_COUNT) {
    return null;
  }
  const coordinate = parseCoordinate(name);
  if (coordinate === null || !DIGEST_PATTERN.test(digest)) return null;
  return { ...coordinate, digest };
}

function applyEntry(state: IndexState, line: string, projectRoot: string): string | null {
  if (state.route === null || state.expected < 0)
    return 'the graph index has an entry outside a route';
  const row = parseEntryRow(line);
  if (row === null) return `the graph index entry "${line}" is unreadable`;
  const key = {
    route: state.route,
    state: row.state,
    viewport: { width: Number(row.width), height: Number(row.height) }
  };
  state.entries.push({ ...key, path: entryPath(projectRoot, key), digest: row.digest });
  state.seen += 1;
  return null;
}

function applyLine(state: IndexState, line: string, projectRoot: string): string | null {
  if (line.startsWith('route ')) return applyRoute(state, line);
  if (line.startsWith('entry-count ')) return applyCount(state, line);
  if (line.startsWith('routes ')) return applyRoutes(state, line);
  if (line.startsWith('entry ')) return applyEntry(state, line, projectRoot);
  return `the graph index line "${line}" is unreadable`;
}

/** Read the index file without consulting the entries themselves. */
export function readIndex(projectRoot: string): IndexRead {
  const path = join(graphRoot(projectRoot), INDEX_FILE);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { ok: false, reason: 'the graph index is missing; build the graph first' };
  }
  if (!text.endsWith('\n')) return { ok: false, reason: `the graph index is not ${INDEX_MAGIC}` };
  const lines = text.slice(0, -1).split('\n');
  if (lines[0] !== INDEX_MAGIC)
    return { ok: false, reason: `the graph index is not ${INDEX_MAGIC}` };
  const state: IndexState = { route: null, expected: -1, seen: 0, routes: 0, entries: [] };
  for (const line of lines.slice(1)) {
    const problem = applyLine(state, line, projectRoot);
    if (problem !== null) return { ok: false, reason: problem };
  }
  const problem = closeRoute(state);
  if (problem !== null) return { ok: false, reason: problem };
  return { ok: true, entries: state.entries };
}

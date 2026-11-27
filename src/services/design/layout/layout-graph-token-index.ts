/**
 * The token reverse index beside the entry index: one `token` group per cited
 * name, one `ref` line per citing entry at the value it cited. The writer and
 * the reader share the format; a damaged file is a refusal the caller may fall
 * back from, never a throw.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { scanEntries } from './layout-graph-index.js';
import { parseEntry } from './layout-graph-parse.js';
import {
  entryPath,
  graphRoot,
  keyText,
  type EntryKey,
  type StoreWrite
} from './layout-graph-paths.js';
import { citedTokens, type CitedToken, type LayoutEntry } from './layout-graph.js';

export const TOKEN_INDEX_FILE = 'tokens.txt';
export const TOKEN_INDEX_MAGIC = 'lgt 1';

const VIEWPORT_NAME = /^(\d+)x(\d+)$/;
/** A ref line carries exactly route, coordinate and value. */
const REF_FIELD_COUNT = 3;

export type TokenRef = { key: EntryKey; value: string };

export type TokenIndexRead =
  { ok: true; tokens: Map<string, TokenRef[]> } | { ok: false; reason: string };

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function keyOf(entry: LayoutEntry): EntryKey {
  return { route: entry.route, state: entry.state, viewport: entry.viewport };
}

/** The declared tokens an entry cites, by the rule the freshness digest uses. */
export function referencedTokens(entry: LayoutEntry): CitedToken[] {
  return citedTokens(entry.nodes, entry.tokens);
}

/** The reverse index over a set of entries: token name to every citing entry. */
export function tokenIndexFromEntries(entries: readonly LayoutEntry[]): Map<string, TokenRef[]> {
  const tokens = new Map<string, TokenRef[]>();
  for (const entry of entries) {
    const key = keyOf(entry);
    for (const cite of referencedTokens(entry)) {
      const refs = tokens.get(cite.name) ?? [];
      refs.push({ key, value: cite.value });
      tokens.set(cite.name, refs);
    }
  }
  return tokens;
}

type EntriesRead = { ok: true; entries: LayoutEntry[] } | { ok: false; reason: string };

/** Every entry on disk, parsed; the route directories are the truth, not the index file. */
function readIndexedEntries(projectRoot: string): EntriesRead {
  const scanned = scanEntries(projectRoot);
  if (!scanned.ok) return scanned;
  const entries: LayoutEntry[] = [];
  for (const key of scanned.entries) {
    let text: string;
    try {
      text = readFileSync(entryPath(projectRoot, key), 'utf8');
    } catch (error) {
      return { ok: false, reason: `${keyText(key)} could not be read (${errorText(error)})` };
    }
    const parsed = parseEntry(text);
    if (!parsed.ok) {
      return { ok: false, reason: `${keyText(key)} is not readable (${parsed.reason})` };
    }
    entries.push(parsed.entry);
  }
  return { ok: true, entries };
}

function indexLines(tokens: ReadonlyMap<string, TokenRef[]>): string[] {
  const lines = [TOKEN_INDEX_MAGIC];
  let refs = 0;
  for (const name of [...tokens.keys()].sort(compareText)) {
    lines.push(`token ${name}`);
    const sorted = [...(tokens.get(name) ?? [])].sort(
      (left, right) =>
        compareText(keyText(left.key), keyText(right.key)) || compareText(left.value, right.value)
    );
    for (const ref of sorted) {
      lines.push(`ref ${keyText(ref.key)} ${ref.value}`);
      refs += 1;
    }
  }
  lines.push(`tokens ${String(tokens.size)}`, `refs ${String(refs)}`);
  return lines;
}

/** Rebuild the reverse index from the entry files, without the persisted file. */
export function tokenIndexFromDisk(projectRoot: string): TokenIndexRead {
  const read = readIndexedEntries(projectRoot);
  return read.ok ? { ok: true, tokens: tokenIndexFromEntries(read.entries) } : read;
}

/** Rewrite the token reverse index from the entries on disk. */
export function writeTokenIndex(projectRoot: string): StoreWrite {
  const read = readIndexedEntries(projectRoot);
  if (!read.ok) return read;
  const path = join(graphRoot(projectRoot), TOKEN_INDEX_FILE);
  try {
    mkdirSync(graphRoot(projectRoot), { recursive: true });
    writeFileSync(path, `${indexLines(tokenIndexFromEntries(read.entries)).join('\n')}\n`, 'utf8');
    return { ok: true, path };
  } catch (error) {
    return { ok: false, reason: `the token index could not be written (${errorText(error)})` };
  }
}

function parseRefKey(route: string, stateAt: string): EntryKey | null {
  const at = stateAt.indexOf('@');
  const match = at === -1 ? null : VIEWPORT_NAME.exec(stateAt.slice(at + 1));
  const width = match?.[1];
  const height = match?.[2];
  if (at === -1 || width === undefined || height === undefined) return null;
  return {
    route,
    state: stateAt.slice(0, at),
    viewport: { width: Number(width), height: Number(height) }
  };
}

type TokenIndexState = {
  name: string | null;
  tokens: number;
  refs: number;
  expectedTokens: number;
  expectedRefs: number;
  tokensSeen: Map<string, TokenRef[]>;
};

function applyTokenLine(state: TokenIndexState, line: string): string | null {
  const name = line.slice('token '.length);
  if (name.trim() === '') return 'the token index names an empty token';
  if (state.tokensSeen.has(name)) return `the token index repeats ${name}`;
  state.name = name;
  state.tokensSeen.set(name, []);
  state.tokens += 1;
  return null;
}

function applyRefLine(state: TokenIndexState, line: string): string | null {
  if (state.name === null) return 'the token index has a ref outside a token';
  const fields = line.slice('ref '.length).split(' ');
  const route = fields[0];
  const stateAt = fields[1];
  const value = fields[2];
  if (
    route === undefined ||
    stateAt === undefined ||
    value === undefined ||
    fields.length !== REF_FIELD_COUNT
  ) {
    return `the token index ref "${line}" is unreadable`;
  }
  const key = parseRefKey(route, stateAt);
  if (key === null) return `the token index ref "${line}" names no coordinate`;
  state.tokensSeen.get(state.name)?.push({ key, value });
  state.refs += 1;
  return null;
}

function applyTokenIndexLine(state: TokenIndexState, line: string): string | null {
  if (line.startsWith('token ')) return applyTokenLine(state, line);
  if (line.startsWith('ref ')) return applyRefLine(state, line);
  if (line.startsWith('tokens ')) {
    state.expectedTokens = Number(line.slice('tokens '.length));
    return null;
  }
  if (line.startsWith('refs ')) {
    state.expectedRefs = Number(line.slice('refs '.length));
    return null;
  }
  return `the token index line "${line}" is unreadable`;
}

/** Read the token reverse index; a refusal is a fallback signal, not a throw. */
export function readTokenIndex(projectRoot: string): TokenIndexRead {
  const path = join(graphRoot(projectRoot), TOKEN_INDEX_FILE);
  if (!existsSync(path)) return { ok: false, reason: 'the token index is missing' };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { ok: false, reason: `the token index could not be read (${errorText(error)})` };
  }
  if (!text.endsWith('\n')) {
    return { ok: false, reason: `the token index is not ${TOKEN_INDEX_MAGIC}` };
  }
  const lines = text.slice(0, -1).split('\n');
  if (lines[0] !== TOKEN_INDEX_MAGIC) {
    return { ok: false, reason: `the token index is not ${TOKEN_INDEX_MAGIC}` };
  }
  const state: TokenIndexState = {
    name: null,
    tokens: 0,
    refs: 0,
    expectedTokens: -1,
    expectedRefs: -1,
    tokensSeen: new Map()
  };
  for (const line of lines.slice(1)) {
    const problem = applyTokenIndexLine(state, line);
    if (problem !== null) return { ok: false, reason: problem };
  }
  if (state.tokens !== state.expectedTokens || state.refs !== state.expectedRefs) {
    return { ok: false, reason: 'the token index miscounts its lines' };
  }
  return { ok: true, tokens: state.tokensSeen };
}

/**
 * The reading half of the ASCII entry format. Every field is checked, and a
 * damaged line is a reason value rather than a throw or a guess. Anchors are
 * derived from the parsed nodes and the stored token table, then the stored ids
 * are checked against a fresh cut, so a hand-edited text or parent is refused
 * instead of silently renumbering.
 */
/* eslint-disable complexity -- every branch below rejects one malformed input; the branch count is the grammar. */
import { buildLayoutIndex } from './layout-align.js';
import {
  citedTokens,
  dependencyFingerprint,
  entryGeometry,
  type GraphNode,
  type LayoutEntry
} from './layout-graph.js';
import { safeStateName } from './layout-graph-paths.js';
import type { SpacingToken } from './layout-tokens.js';
import {
  ABSENT,
  DIGEST_PATTERN,
  ID_PATTERN,
  MAGIC,
  NUMBER_PATTERN,
  PX_PATTERN,
  ROLE_PATTERN,
  SAME_TEXT,
  TAG_PATTERN,
  decodeText,
  numbersOf,
  singleToken,
  splitFields
} from './layout-graph-fields.js';

export type AsciiRead = { ok: true; entry: LayoutEntry } | { ok: false; reason: string };

const NODE_FIELD_COUNT = 10;
const NODE_START = 7;
const COUNT_OFFSET = 6;
const FOOTER_OFFSET = 8;
const KIND_OF: Readonly<Record<string, GraphNode['kind']>> = { o: 'object', c: 'container' };

type Header = {
  route: string;
  state: string;
  viewport: LayoutEntry['viewport'];
  captureVersion?: string;
  fingerprint: string;
  tokens: SpacingToken[];
};

type NodeRead = { ok: true; node: GraphNode } | { ok: false; reason: string };

function parseNode(parts: readonly string[]): NodeRead {
  if (parts.length !== NODE_FIELD_COUNT)
    return { ok: false, reason: 'a node line needs 10 fields' };
  const [, id, kind, tag, role, boxField, parent, paddingField, ownField, textField] = parts;
  if (id === undefined || !ID_PATTERN.test(id))
    return { ok: false, reason: 'a node id is malformed' };
  const kindName = kind === undefined ? undefined : KIND_OF[kind];
  if (kindName === undefined) return { ok: false, reason: `node ${id} has no valid kind` };
  if (tag === undefined || !TAG_PATTERN.test(tag)) {
    return { ok: false, reason: `node ${id} has no valid tag` };
  }
  if (role === undefined || !ROLE_PATTERN.test(role)) {
    return { ok: false, reason: `node ${id} has no valid role` };
  }
  const box = boxField === undefined ? null : numbersOf(boxField, true);
  if (box === null) return { ok: false, reason: `node ${id} has no integer box` };
  const padding = paddingField === undefined ? null : numbersOf(paddingField, false);
  if (padding === null) return { ok: false, reason: `node ${id} has no numeric padding` };
  if (ownField === undefined || ownField === SAME_TEXT) {
    return { ok: false, reason: `node ${id} has no readable own text` };
  }
  const ownText = decodeText(ownField, '');
  if (ownText === null) return { ok: false, reason: `node ${id} has an unreadable own text` };
  const text = textField === undefined ? null : decodeText(textField, ownText);
  if (text === null) return { ok: false, reason: `node ${id} has an unreadable text` };
  return {
    ok: true,
    node: {
      id,
      kind: kindName,
      tag,
      role,
      box: { left: box[0] ?? 0, top: box[1] ?? 0, right: box[2] ?? 0, bottom: box[3] ?? 0 },
      padding: {
        top: padding[0] ?? 0,
        right: padding[1] ?? 0,
        bottom: padding[2] ?? 0,
        left: padding[3] ?? 0
      },
      ownText,
      text,
      parentId: parent === ABSENT ? null : (parent ?? null)
    }
  };
}

function after(line: string | undefined, prefix: string): string | null {
  return line !== undefined && line.startsWith(prefix) ? line.slice(prefix.length) : null;
}

function parseTokens(value: string | null): SpacingToken[] | null {
  if (value === null) return null;
  if (value === ABSENT) return [];
  const tokens: SpacingToken[] = [];
  for (const part of value.split(' ')) {
    const cut = part.indexOf('=');
    if (cut <= 0) return null;
    const name = part.slice(0, cut);
    const declared = part.slice(cut + 1);
    const digits = declared.replace(/px$/, '');
    if (!name.startsWith('space.') || !PX_PATTERN.test(declared) || !NUMBER_PATTERN.test(digits)) {
      return null;
    }
    tokens.push({ name, value: declared, px: Number(digits) });
  }
  return tokens;
}

function parseViewport(value: string | null): LayoutEntry['viewport'] | null {
  const match = value === null ? null : /^(\d+)x(\d+)$/.exec(value);
  const width = match?.[1];
  const height = match?.[2];
  if (width === undefined || height === undefined) return null;
  return { width: Number(width), height: Number(height) };
}

function parseHeader(
  lines: readonly string[]
): { ok: true; header: Header } | { ok: false; reason: string } {
  const route = after(lines[1], 'route ');
  const state = after(lines[2], 'state ');
  const viewport = parseViewport(after(lines[3], 'viewport '));
  const fingerprint = after(lines[4], 'fingerprint ');
  const tokens = parseTokens(after(lines[5], 'tokens '));
  if (route === null || !singleToken(route)) return { ok: false, reason: 'no readable route' };
  if (state === null || !safeStateName(state)) return { ok: false, reason: 'no readable state' };
  if (viewport === null) return { ok: false, reason: 'no readable viewport' };
  if (fingerprint === null || !DIGEST_PATTERN.test(fingerprint)) {
    return { ok: false, reason: 'no source fingerprint' };
  }
  if (tokens === null) return { ok: false, reason: 'no readable token table' };
  return { ok: true, header: { route, state, viewport, fingerprint, tokens } };
}

function countAfter(line: string | undefined, prefix: string): number {
  const value = after(line, prefix);
  if (value === null || !/^\d+$/.test(value)) return Number.NaN;
  return Number(value);
}

function readNodes(lines: readonly string[], count: number): GraphNode[] | string {
  const nodes: GraphNode[] = [];
  for (let index = 0; index < count; index += 1) {
    const read = parseNode(splitFields(lines[NODE_START + index] ?? ''));
    if (!read.ok) return read.reason;
    if (nodes.some((known) => known.id === read.node.id)) return `node id ${read.node.id} repeats`;
    if (read.node.parentId !== null && !nodes.some((known) => known.id === read.node.parentId)) {
      return `node ${read.node.id} names a parent that is absent or later`;
    }
    nodes.push(read.node);
  }
  return nodes;
}

/**
 * The closing line. An entry written before the format carried a capture
 * version closes with the bare `end <count>` and reads as versionless.
 */
function parseClose(
  line: string | undefined,
  count: number
): { ok: true; captureVersion?: string } | { ok: false; reason: string } {
  const end = `end ${String(count)}`;
  if (line === end) return { ok: true };
  const prefix = `${end} capture `;
  if (line !== undefined && line.startsWith(prefix)) {
    const version = line.slice(prefix.length);
    if (singleToken(version)) return { ok: true, captureVersion: version };
    return { ok: false, reason: 'the capture version is not one field' };
  }
  return { ok: false, reason: `the entry does not close with "${end}"` };
}

/** Re-cut the stored nodes; a mismatch means the entry no longer numbers itself. */
function deriveAnchors(
  header: Header,
  nodes: readonly GraphNode[]
): { ok: true; entry: LayoutEntry } | { ok: false; reason: string } {
  const draft: LayoutEntry = {
    ...header,
    tokensFingerprint: dependencyFingerprint(citedTokens(nodes, header.tokens)),
    nodes: [...nodes],
    anchors: []
  };
  const geometry = entryGeometry(draft);
  if (!geometry.ok) return geometry;
  const index = buildLayoutIndex({ geometry: geometry.geometry, spacingTokens: header.tokens });
  if (index.nodes.length !== nodes.length) {
    return { ok: false, reason: 'the stored nodes do not cut to the same set' };
  }
  for (let position = 0; position < nodes.length; position += 1) {
    const stored = nodes[position];
    const cut = index.nodes[position];
    if (stored === undefined || cut === undefined) continue;
    if (
      stored.id !== cut.id ||
      stored.kind !== cut.kind ||
      stored.parentId !== cut.parentId ||
      stored.ownText !== cut.ownText ||
      stored.text !== cut.text
    ) {
      return { ok: false, reason: `node ${stored.id} no longer matches its own text or parent` };
    }
  }
  return { ok: true, entry: { ...draft, anchors: index.anchors } };
}

/** Read the entry back; every field is checked, so a damaged file is a reason. */
export function parseEntry(text: string): AsciiRead {
  if (!text.endsWith('\n')) return { ok: false, reason: 'the entry does not end with a newline' };
  if (text.includes('\r')) return { ok: false, reason: 'the entry is not newline-normalised' };
  const lines = text.slice(0, -1).split('\n');
  if (lines[0] !== MAGIC) return { ok: false, reason: `the entry is not ${MAGIC}` };
  const header = parseHeader(lines);
  if (!header.ok) return header;
  const nodeCount = countAfter(lines[COUNT_OFFSET], 'nodes ');
  if (!Number.isInteger(nodeCount) || nodeCount < 1) {
    return { ok: false, reason: 'the entry declares no nodes' };
  }
  const nodes = readNodes(lines, nodeCount);
  if (typeof nodes === 'string') return { ok: false, reason: nodes };
  const close = parseClose(lines[NODE_START + nodeCount], nodeCount);
  if (!close.ok) return close;
  if (lines.length !== FOOTER_OFFSET + nodeCount) {
    return { ok: false, reason: 'the entry carries lines past its close' };
  }
  const withVersion: Header =
    close.captureVersion === undefined
      ? header.header
      : { ...header.header, captureVersion: close.captureVersion };
  return deriveAnchors(withVersion, nodes);
}

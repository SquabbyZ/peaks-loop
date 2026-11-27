/**
 * The writing half of the ASCII entry format. It is line-oriented and
 * field-oriented so a parser needs no inference: the header fixes route, state,
 * viewport, the source digest and the declared spacing token table; node lines
 * carry everything a rebuild needs. Anchors are not written: they are a pure
 * function of the node lines and that token table, so storing them would be a
 * second copy of the same facts.
 */
import { formatNumber, type GraphNode, type LayoutEntry } from './layout-graph.js';
import type { SpacingToken } from './layout-tokens.js';
import {
  ABSENT,
  ID_PATTERN,
  MAGIC,
  ROLE_PATTERN,
  SAME_TEXT,
  TAG_PATTERN,
  singleToken
} from './layout-graph-fields.js';

export type AsciiWrite = { ok: true; text: string } | { ok: false; reason: string };

const NODE_KIND: Readonly<Record<GraphNode['kind'], string>> = { object: 'o', container: 'c' };

function boxText(node: GraphNode): string {
  return [node.box.left, node.box.top, node.box.right, node.box.bottom].map(formatNumber).join(',');
}

function paddingText(node: GraphNode): string {
  return [node.padding.top, node.padding.right, node.padding.bottom, node.padding.left]
    .map(formatNumber)
    .join(',');
}

function encodeText(value: string): string {
  return value === '' ? ABSENT : JSON.stringify(value);
}

function serializeNode(node: GraphNode): string {
  return [
    'n',
    node.id,
    NODE_KIND[node.kind],
    node.tag,
    node.role,
    boxText(node),
    node.parentId ?? ABSENT,
    paddingText(node),
    encodeText(node.ownText),
    node.text === node.ownText ? SAME_TEXT : encodeText(node.text)
  ].join(' ');
}

/** Why a node cannot be written as one line, or null when it can. */
function nodeRefusal(node: GraphNode): string | null {
  if (!ID_PATTERN.test(node.id)) return `node id ${node.id} is not a structural id`;
  if (!TAG_PATTERN.test(node.tag)) return `tag "${node.tag}" has characters a line cannot carry`;
  if (!ROLE_PATTERN.test(node.role))
    return `role "${node.role}" has characters a line cannot carry`;
  return null;
}

/** Why a token cannot be written as one field, or null when it can. */
function tokenRefusal(token: SpacingToken): string | null {
  if (!singleToken(token.name)) return `token name "${token.name}" is not one field`;
  if (!singleToken(token.value)) return `token value "${token.value}" is not one field`;
  return null;
}

/** The closing line, carrying the capture format when the entry declares one. */
function closeLine(entry: LayoutEntry): string {
  const close = `end ${String(entry.nodes.length)}`;
  return entry.captureVersion === undefined ? close : `${close} capture ${entry.captureVersion}`;
}

/** One entry as the bytes both a parser and a reader of the graph see. */
export function serializeEntry(entry: LayoutEntry): AsciiWrite {
  if (!singleToken(entry.route)) return { ok: false, reason: 'route is empty or holds whitespace' };
  if (!singleToken(entry.state)) return { ok: false, reason: 'state is empty or holds whitespace' };
  if (entry.captureVersion !== undefined && !singleToken(entry.captureVersion)) {
    return { ok: false, reason: 'the capture version is not one field' };
  }
  for (const node of entry.nodes) {
    const refusal = nodeRefusal(node);
    if (refusal !== null) return { ok: false, reason: refusal };
  }
  for (const token of entry.tokens) {
    const refusal = tokenRefusal(token);
    if (refusal !== null) return { ok: false, reason: refusal };
  }
  const tokenFields = entry.tokens.map((token) => `${token.name}=${token.value}`).join(' ');
  const lines = [
    MAGIC,
    `route ${entry.route}`,
    `state ${entry.state}`,
    `viewport ${String(entry.viewport.width)}x${String(entry.viewport.height)}`,
    `fingerprint ${entry.fingerprint}`,
    `tokens ${tokenFields === '' ? ABSENT : tokenFields}`,
    `nodes ${String(entry.nodes.length)}`,
    ...entry.nodes.map(serializeNode),
    closeLine(entry)
  ];
  return { ok: true, text: `${lines.join('\n')}\n` };
}

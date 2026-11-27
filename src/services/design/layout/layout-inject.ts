/**
 * The fragment a reader gets instead of the graph tree: one entry trimmed to the
 * question, at most two kilobytes, and never presenting a stale entry's edges as
 * current alignment evidence.
 */
import {
  citedTokens,
  type EntryFreshness,
  type GraphNode,
  type LayoutEntry
} from './layout-graph.js';
import type { AnchorSource, LayoutAnchor } from './layout-align.js';

// eslint-disable-next-line no-magic-numbers -- the fragment bound is a declared contract: two kibibytes.
export const MAX_FRAGMENT_BYTES = 2 * 1024;

const TRUNCATION_RESERVE = 48;
const OBJECT_ID = /[0-9a-f]{12}/;
const EDGE_CUE = /(align|edge|left|top|anchor|对齐|边缘)/i;
const TOKEN_CUE = /(token|spacing|padding|间距|内边距)/i;

export type SliceRequest = {
  question?: string;
  objectId?: string;
  edge?: 'left' | 'top';
};

export type SliceFocus = 'object' | 'edge' | 'tokens' | 'overview';

export type SliceRead = {
  text: string;
  bytes: number;
  truncated: boolean;
  status: EntryFreshness['status'];
  reasons: string[];
};

/** Which view of one entry the request asks for; the cues are word-anchored. */
export function focusOf(request: SliceRequest): SliceFocus {
  const asked = request.objectId ?? request.question ?? '';
  if (request.objectId !== undefined || OBJECT_ID.test(asked)) return 'object';
  if (EDGE_CUE.test(asked)) return 'edge';
  if (TOKEN_CUE.test(asked)) return 'tokens';
  return 'overview';
}

function viewportLabel(entry: LayoutEntry): string {
  return `${entry.state}@${String(entry.viewport.width)}x${String(entry.viewport.height)}`;
}

function sourceText(source: AnchorSource | null): string {
  if (source === null) return '-';
  if (source.token === null) return `${source.parentId}@${source.value}(no-token)`;
  return `${source.parentId}/${source.token.name}=${source.token.value}`;
}

function nodeLine(node: GraphNode): string {
  const kind = node.kind === 'object' ? 'object' : 'container';
  return `${kind} ${node.id} ${node.role} parent=${node.parentId ?? '-'} ${JSON.stringify(node.text)}`;
}

function anchorLine(anchor: LayoutAnchor): string {
  return [
    'anchor',
    anchor.objectId,
    anchor.sharedWith,
    anchor.edge,
    anchor.verdict,
    `src=${sourceText(anchor.source)}`,
    `other=${sourceText(anchor.otherSource)}`
  ].join(' ');
}

function headerLines(entry: LayoutEntry, freshness: EntryFreshness): string[] {
  const objects = entry.nodes.filter((node) => node.kind === 'object').length;
  const header = [
    `graph ${entry.route} ${viewportLabel(entry)}`,
    `nodes=${String(entry.nodes.length)} objects=${String(objects)} anchors=${String(entry.anchors.length)}`,
    `status=${freshness.status}`,
    `fingerprint=${entry.fingerprint}`
  ];
  if (freshness.status !== 'current') {
    header.push(`evidence=refused reason=${freshness.reasons.join(',')}`);
    header.push(
      'this entry is not current alignment evidence: do not cite its edges as aligned now'
    );
  }
  return header;
}

function objectView(entry: LayoutEntry, id: string): string[] {
  const node = entry.nodes.find((candidate) => candidate.id === id);
  if (node === undefined) return [`object ${id} is not in this entry`];
  return [
    nodeLine(node),
    `chain=${node.parentId === null ? '-' : node.parentId}`,
    ...entry.anchors
      .filter((anchor) => anchor.objectId === id || anchor.sharedWith === id)
      .map(anchorLine)
  ];
}

function edgeView(entry: LayoutEntry, edge?: 'left' | 'top'): string[] {
  const anchors =
    edge === undefined ? entry.anchors : entry.anchors.filter((anchor) => anchor.edge === edge);
  return anchors.length === 0 ? ['no shared edge in this entry'] : anchors.map(anchorLine);
}

function tokenView(entry: LayoutEntry): string[] {
  return [
    ...citedTokens(entry.nodes, entry.tokens).map((token) => `token ${token.name}=${token.value}`),
    ...entry.anchors.map(anchorLine)
  ];
}

function overview(entry: LayoutEntry): string[] {
  return [
    ...entry.nodes.filter((node) => node.kind === 'object').map(nodeLine),
    ...entry.anchors.filter((anchor) => anchor.verdict === 'not-aligned').map(anchorLine)
  ];
}

function bodyLines(entry: LayoutEntry, freshness: EntryFreshness, request: SliceRequest): string[] {
  if (freshness.status !== 'current') return entry.nodes.map(nodeLine);
  switch (focusOf(request)) {
    case 'object': {
      const asked = request.objectId ?? OBJECT_ID.exec(request.question ?? '')?.[0] ?? '';
      return objectView(entry, asked);
    }
    case 'edge':
      return edgeView(entry, request.edge);
    case 'tokens':
      return tokenView(entry);
    default:
      return overview(entry);
  }
}

function fitFragment(lines: readonly string[]): { text: string; truncated: boolean } {
  const whole = `${lines.join('\n')}\n`;
  if (Buffer.byteLength(whole, 'utf8') <= MAX_FRAGMENT_BYTES)
    return { text: whole, truncated: false };
  const kept: string[] = [];
  for (const line of lines) {
    const candidate = `${[...kept, line].join('\n')}\n`;
    if (Buffer.byteLength(candidate, 'utf8') > MAX_FRAGMENT_BYTES - TRUNCATION_RESERVE) break;
    kept.push(line);
  }
  const omitted = lines.length - kept.length;
  return {
    text: `${[...kept, `... ${String(omitted)} more lines omitted`].join('\n')}\n`,
    truncated: true
  };
}

/** One entry as the bounded fragment a reader may see. */
export function sliceEntry(
  entry: LayoutEntry,
  freshness: EntryFreshness,
  request: SliceRequest = {}
): SliceRead {
  const fitted = fitFragment([
    ...headerLines(entry, freshness),
    ...bodyLines(entry, freshness, request)
  ]);
  return {
    text: fitted.text,
    bytes: Buffer.byteLength(fitted.text, 'utf8'),
    truncated: fitted.truncated,
    status: freshness.status,
    reasons: freshness.reasons
  };
}

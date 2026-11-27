/**
 * The round-trip judgement: rebuild the preview from an entry, measure the
 * rebuilt page, and demand that the numbered nodes, their parent chains and the
 * shared-edge anchors come back unchanged. Box coordinates are compared only
 * through the relations they produce, so the assertion stays about layout
 * structure rather than pixel identity.
 */
import { buildLayoutIndex, type LayoutAnchor, type LayoutIndex } from './layout-align.js';
import { chainsOf, indexFromEntry, type GraphNode, type LayoutEntry } from './layout-graph.js';
import { rebuildHtml } from './layout-preview.js';
import { readPreviewGeometry } from './layout-preview-read.js';
import { estimateTokens } from '../../memory/llm-reranker-core.js';

const MAX_MISMATCHES = 10;

function sourceKey(source: LayoutAnchor['source']): string {
  if (source === null) return '-';
  return [
    source.parentId,
    source.property,
    source.value,
    source.token?.name ?? '-',
    source.token?.value ?? '-'
  ].join('|');
}

function anchorKey(anchor: LayoutAnchor): string {
  return [
    anchor.objectId,
    anchor.sharedWith,
    anchor.edge,
    anchor.verdict,
    sourceKey(anchor.source),
    sourceKey(anchor.otherSource)
  ].join(';');
}

function nodeKey(node: GraphNode, chain: readonly string[]): string {
  return [
    node.id,
    node.kind,
    node.tag,
    node.role,
    node.parentId ?? '-',
    chain.join('>'),
    node.text
  ].join('|');
}

/**
 * Nodes are compared by id, structure and text. `ownText` is not compared: a
 * folded object reproduces its id from its subtree text, and the rebuilt page
 * cannot tell which part of that text was direct. A container's id is numbered
 * from its direct text, so its own-text fidelity is already inside the id.
 */
function compareNodeLists(
  storedNodes: readonly GraphNode[],
  storedChains: ReadonlyMap<string, string[]>,
  rebuilt: readonly GraphNode[],
  rebuiltChains: ReadonlyMap<string, string[]>
): string[] {
  const mismatches: string[] = [];
  if (storedNodes.length !== rebuilt.length) {
    mismatches.push(
      `node count ${String(storedNodes.length)} stored, ${String(rebuilt.length)} rebuilt`
    );
  }
  const count = Math.min(storedNodes.length, rebuilt.length);
  for (let index = 0; index < count; index += 1) {
    const stored = storedNodes[index];
    const cut = rebuilt[index];
    if (stored === undefined || cut === undefined) continue;
    const expected = nodeKey(stored, storedChains.get(stored.id) ?? []);
    const actual = nodeKey(cut, rebuiltChains.get(cut.id) ?? []);
    if (expected !== actual) mismatches.push(`node ${String(index)}: ${expected} != ${actual}`);
  }
  return mismatches;
}

function compareNodes(entry: LayoutEntry, after: LayoutIndex): string[] {
  return compareNodeLists(
    entry.nodes,
    chainsOf(entry.nodes),
    after.nodes,
    new Map(after.nodes.map((node) => [node.id, node.parentChain]))
  );
}

function compareAnchors(entry: LayoutEntry, after: LayoutIndex): string[] {
  const mismatches: string[] = [];
  if (entry.anchors.length !== after.anchors.length) {
    mismatches.push(
      `anchor count ${String(entry.anchors.length)} stored, ${String(after.anchors.length)} rebuilt`
    );
  }
  const count = Math.min(entry.anchors.length, after.anchors.length);
  for (let index = 0; index < count; index += 1) {
    const stored = entry.anchors[index];
    const rebuilt = after.anchors[index];
    if (stored === undefined || rebuilt === undefined) continue;
    const expected = anchorKey(stored);
    const actual = anchorKey(rebuilt);
    if (expected !== actual) mismatches.push(`anchor ${String(index)}: ${expected} != ${actual}`);
  }
  return mismatches;
}

/** The stored nodes must re-cut to themselves before any rebuild is trusted. */
function selfCheck(entry: LayoutEntry): string[] {
  const before = indexFromEntry(entry);
  if (!before.ok) return [before.reason];
  return compareNodeLists(
    entry.nodes,
    chainsOf(entry.nodes),
    before.index.nodes,
    new Map(before.index.nodes.map((node) => [node.id, node.parentChain]))
  ).map((line) => `stored entry disagrees with its nodes: ${line}`);
}

export type RoundTrip =
  { ok: true; nodes: number; anchors: number } | { ok: false; mismatches: string[] };

/** Rebuild, measure the rebuild, and demand the stored relations come back. */
export function verifyRoundTrip(entry: LayoutEntry): RoundTrip {
  const mismatches = selfCheck(entry);
  const rebuilt = rebuildHtml(entry);
  if (!rebuilt.ok) return { ok: false, mismatches: [...mismatches, rebuilt.reason] };
  const measured = readPreviewGeometry(rebuilt.html, entry.route, entry.viewport);
  if (!measured.ok) return { ok: false, mismatches: [...mismatches, measured.reason] };
  const after = buildLayoutIndex({ geometry: measured.geometry, spacingTokens: entry.tokens });
  mismatches.push(...compareNodes(entry, after), ...compareAnchors(entry, after));
  if (mismatches.length > 0) return { ok: false, mismatches: mismatches.slice(0, MAX_MISMATCHES) };
  return { ok: true, nodes: entry.nodes.length, anchors: entry.anchors.length };
}

export type Density = {
  asciiBytes: number;
  asciiTokens: number;
  htmlBytes: number;
  htmlTokens: number;
  /** True only when the graph really is the smaller reading surface. */
  denser: boolean;
};

/** Bytes and estimated tokens of the graph versus the page it describes. */
export function densityOf(asciiText: string, renderedHtml: string): Density {
  const asciiBytes = Buffer.byteLength(asciiText, 'utf8');
  const htmlBytes = Buffer.byteLength(renderedHtml, 'utf8');
  const asciiTokens = estimateTokens(asciiText);
  const htmlTokens = estimateTokens(renderedHtml);
  return { asciiBytes, asciiTokens, htmlBytes, htmlTokens, denser: asciiTokens < htmlTokens };
}

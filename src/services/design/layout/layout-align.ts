/**
 * Compares objects that share a role and ancestor chain: stacked pairs by left
 * edge, side-by-side pairs by top edge, after whole-pixel rounding with no
 * tolerance. Anchors name the parent container and its spacing token; findings
 * are non-blocking data that never reaches a design-check verdict.
 */
import type { LayoutGeometry, Viewport } from './layout-geometry.js';
import { cutVisualObjects, type CutNode, type LayoutNode } from './layout-objects.js';
import type { SpacingToken } from './layout-tokens.js';

export type AnchorSource = {
  /** The parent container's node id, so the finding names a numbered object. */
  parentId: string;
  property: 'padding-left' | 'padding-top';
  /** The computed value, e.g. `16px`. */
  value: string;
  /** The declared token that value resolves to, or null when none matches. */
  token: SpacingToken | null;
};

export type LayoutAnchor = {
  objectId: string;
  sharedWith: string;
  edge: 'left' | 'top';
  verdict: 'aligned' | 'not-aligned';
  value: number;
  otherValue: number;
  source: AnchorSource | null;
  otherSource: AnchorSource | null;
};

export type LayoutFinding = {
  code: 'layout-not-aligned';
  edge: 'left' | 'top';
  objectId: string;
  otherId: string;
  value: number;
  otherValue: number;
  difference: number;
  source: AnchorSource | null;
  otherSource: AnchorSource | null;
  /** Human-facing, non-blocking text (QD3); machine fields stay separate. */
  humanText: string;
};

export type LayoutIndex = {
  route: string;
  viewport: Viewport;
  nodes: LayoutNode[];
  anchors: LayoutAnchor[];
  findings: LayoutFinding[];
};

export type BuildLayoutInput = {
  geometry: LayoutGeometry;
  spacingTokens: readonly SpacingToken[];
};

/** Two computed pixels are the same token value when they differ by no fraction. */
const PX_EPSILON = 0.01;

function publicNode(node: CutNode): LayoutNode {
  return {
    id: node.id,
    kind: node.kind,
    tag: node.tag,
    role: node.role,
    ownText: node.ownText,
    text: node.text,
    box: node.box,
    padding: node.padding,
    parentId: node.parentId,
    parentChain: node.parentChain
  };
}

function formatPx(px: number): string {
  return `${String(Math.round(px * 100) / 100)}px`;
}

/**
 * The declared token a computed value equals. When a contract declares several
 * names for one value, the lexicographically smallest name is chosen so the
 * attribution is deterministic rather than dependent on file order.
 */
export function tokenFor(tokens: readonly SpacingToken[], px: number): SpacingToken | null {
  let picked: SpacingToken | null = null;
  for (const token of tokens) {
    if (Math.abs(token.px - px) > PX_EPSILON) continue;
    if (picked === null || token.name.localeCompare(picked.name) < 0) picked = token;
  }
  return picked;
}

/** The edge a pair of boxes is expected to share, or null when they are neither. */
function expectedEdge(left: CutNode, right: CutNode): 'left' | 'top' | null {
  const stacked = left.box.bottom <= right.box.top || right.box.bottom <= left.box.top;
  if (stacked) return 'left';
  const sideBySide = left.box.right <= right.box.left || right.box.right <= left.box.left;
  if (sideBySide) return 'top';
  return null;
}

function sourceOf(
  node: CutNode,
  edge: 'left' | 'top',
  nodesById: ReadonlyMap<string, CutNode>,
  tokens: readonly SpacingToken[]
): AnchorSource | null {
  if (node.parentId === null) return null;
  const parent = nodesById.get(node.parentId);
  if (parent === undefined) return null;
  const px = edge === 'left' ? parent.padding.left : parent.padding.top;
  return {
    parentId: parent.id,
    property: edge === 'left' ? 'padding-left' : 'padding-top',
    value: formatPx(px),
    token: tokenFor(tokens, px)
  };
}

function describeSource(source: AnchorSource | null): string {
  if (source === null) return '没有可指认的父容器';
  if (source.token === null) {
    return `父容器 ${source.parentId} 的 ${source.property} = ${source.value}（未匹配已声明 token）`;
  }
  return `父容器 ${source.parentId} 的 ${source.property} token ${source.token.name} = ${source.token.value}`;
}

function humanText(
  pair: { left: CutNode; right: CutNode; edge: 'left' | 'top'; difference: number },
  source: AnchorSource | null,
  otherSource: AnchorSource | null
): string {
  return (
    `对象 ${pair.left.id} 与 ${pair.right.id} 的 ${pair.edge} 边缘未对齐：` +
    `${String(pair.left.box[pair.edge])}px vs ${String(pair.right.box[pair.edge])}px，相差 ${String(pair.difference)}px。` +
    `来源：${describeSource(source)}；对端：${describeSource(otherSource)}。` +
    '这是非阻塞提示，不进入 design check 判定。'
  );
}

function findingOf(
  pair: { left: CutNode; right: CutNode; edge: 'left' | 'top' },
  source: AnchorSource | null,
  otherSource: AnchorSource | null
): LayoutFinding {
  const value = pair.left.box[pair.edge];
  const otherValue = pair.right.box[pair.edge];
  const difference = Math.abs(value - otherValue);
  return {
    code: 'layout-not-aligned',
    edge: pair.edge,
    objectId: pair.left.id,
    otherId: pair.right.id,
    value,
    otherValue,
    difference,
    source,
    otherSource,
    humanText: humanText({ ...pair, difference }, source, otherSource)
  };
}

type Pair = { left: CutNode; right: CutNode; edge: 'left' | 'top' };

/** Consecutive same-kind, same-ancestor-chain objects that can share an edge. */
function comparablePairs(
  objects: readonly CutNode[],
  nodesById: ReadonlyMap<string, CutNode>
): Pair[] {
  const groups = new Map<string, CutNode[]>();
  for (const object of objects) {
    const chainKey = object.parentChain.map((id) => nodesById.get(id)?.role ?? '').join('>');
    const key = `${chainKey}|${object.role}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [object]);
    else group.push(object);
  }
  const pairs: Pair[] = [];
  for (const group of groups.values()) {
    for (let index = 0; index + 1 < group.length; index += 1) {
      const left = group[index];
      const right = group[index + 1];
      if (left === undefined || right === undefined) continue;
      const edge = expectedEdge(left, right);
      if (edge !== null) pairs.push({ left, right, edge });
    }
  }
  return pairs;
}

/**
 * Build the numbered layout index for one measured route. Pure and
 * deterministic: the same input yields the same ids, anchors and findings.
 */
export function buildLayoutIndex(input: BuildLayoutInput): LayoutIndex {
  const cut = cutVisualObjects(input.geometry);
  const nodesById = new Map(cut.map((node) => [node.id, node]));
  const objects = cut.filter((node) => node.kind === 'object');
  const anchors: LayoutAnchor[] = [];
  const findings: LayoutFinding[] = [];
  for (const pair of comparablePairs(objects, nodesById)) {
    const source = sourceOf(pair.left, pair.edge, nodesById, input.spacingTokens);
    const otherSource = sourceOf(pair.right, pair.edge, nodesById, input.spacingTokens);
    const verdict =
      pair.left.box[pair.edge] === pair.right.box[pair.edge] ? 'aligned' : 'not-aligned';
    anchors.push({
      objectId: pair.left.id,
      sharedWith: pair.right.id,
      edge: pair.edge,
      verdict,
      value: pair.left.box[pair.edge],
      otherValue: pair.right.box[pair.edge],
      source,
      otherSource
    });
    if (verdict === 'not-aligned') findings.push(findingOf(pair, source, otherSource));
  }
  return {
    route: input.geometry.route,
    viewport: input.geometry.viewport,
    nodes: cut.map(publicNode),
    anchors,
    findings
  };
}

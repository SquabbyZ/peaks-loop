/**
 * The block model shared by prototype generation, filtering and mixing: one
 * block per visual-region node, with its box, ancestor role chain and the two
 * edge sources a direction may override.
 */
import { tokenFor } from './layout-align.js';
import { formatNumber, type GraphNode, type LayoutEntry } from './layout-graph.js';
import type { ElementBox } from './layout-geometry.js';

export type BlockSource = {
  parentId: string | null;
  property: 'padding-left' | 'padding-top';
  value: string;
  tokenName: string | null;
};

export type BlockSources = { left: BlockSource; top: BlockSource };

export type PrototypeBlock = {
  blockId: string;
  role: string;
  text: string;
  box: ElementBox;
  chainRoles: string[];
  sources: BlockSources;
};

export type ViolationCode =
  'contract-violation' | 'parent-chain-broken' | 'anchor-self-contradiction' | 'missing-block';

export type Violation = { code: ViolationCode; blockId: string; detail: string };

export type PrototypeSection = {
  id: string;
  value: string;
  tokenName: string | null;
  flat: boolean;
};

export type Prototype = {
  name: string;
  html: string;
  marker: string;
  section: PrototypeSection;
  blocks: PrototypeBlock[];
  violations: Violation[];
};

export type PrototypeDirection = {
  name: string;
  tokenName: string | null;
  parentPrefix: string | null;
  flat: boolean;
  outline: boolean;
};

/** The five directions a route is rendered as in one pass, in handoff order. */
export const PROTOTYPE_DIRECTIONS: readonly PrototypeDirection[] = [
  { name: 'stack', tokenName: null, parentPrefix: null, flat: false, outline: false },
  { name: 'outline', tokenName: null, parentPrefix: null, flat: false, outline: true },
  { name: 'roomy', tokenName: 'space.roomy', parentPrefix: 'roomy', flat: false, outline: false },
  {
    name: 'compact',
    tokenName: 'space.page',
    parentPrefix: 'compact',
    flat: false,
    outline: false
  },
  { name: 'flat', tokenName: 'space.page', parentPrefix: null, flat: true, outline: false }
];

export const FALLBACK_TOKEN_VALUE = '12px';
export const DEFAULT_SECTION_VALUE = '16px';

function parentOf(entry: LayoutEntry, node: GraphNode): GraphNode | null {
  if (node.parentId === null) return null;
  return entry.nodes.find((candidate) => candidate.id === node.parentId) ?? null;
}

/** Ancestor roles, root first, direct parent last. */
function chainRolesOf(entry: LayoutEntry, node: GraphNode): string[] {
  const roles: string[] = [];
  let current = parentOf(entry, node);
  while (current !== null) {
    roles.push(current.role);
    current = parentOf(entry, current);
  }
  return roles.reverse();
}

function pxText(px: number): string {
  return `${formatNumber(px)}px`;
}

function graphSourceFor(entry: LayoutEntry, node: GraphNode, edge: 'left' | 'top'): BlockSource {
  const property = edge === 'left' ? 'padding-left' : 'padding-top';
  const parent = parentOf(entry, node);
  if (parent === null) return { parentId: null, property, value: '0px', tokenName: null };
  const px = edge === 'left' ? parent.padding.left : parent.padding.top;
  const token = tokenFor(entry.tokens, px);
  return { parentId: parent.id, property, value: pxText(px), tokenName: token?.name ?? null };
}

export function declaredValue(entry: LayoutEntry, tokenName: string): string {
  const token = entry.tokens.find((candidate) => candidate.name === tokenName);
  return token?.value ?? FALLBACK_TOKEN_VALUE;
}

function sourceFor(
  entry: LayoutEntry,
  node: GraphNode,
  direction: PrototypeDirection,
  edge: 'left' | 'top'
): BlockSource {
  const property = edge === 'left' ? 'padding-left' : 'padding-top';
  if (direction.flat) {
    const body = entry.nodes.find((candidate) => candidate.tag === 'body');
    return {
      parentId: body?.id ?? null,
      property,
      value: direction.tokenName === null ? '0px' : declaredValue(entry, direction.tokenName),
      tokenName: direction.tokenName
    };
  }
  const base = graphSourceFor(entry, node, edge);
  const parentId =
    direction.parentPrefix === null
      ? base.parentId
      : `${direction.parentPrefix}:${base.parentId ?? 'root'}`;
  if (direction.tokenName === null) return { ...base, parentId };
  return {
    parentId,
    property,
    value: declaredValue(entry, direction.tokenName),
    tokenName: direction.tokenName
  };
}

export function blockFor(
  entry: LayoutEntry,
  node: GraphNode,
  direction: PrototypeDirection
): PrototypeBlock {
  const chain = chainRolesOf(entry, node);
  return {
    blockId: node.id,
    role: node.role,
    text: node.text,
    box: node.box,
    chainRoles: direction.flat ? chain.slice(0, 1) : chain,
    sources: {
      left: sourceFor(entry, node, direction, 'left'),
      top: sourceFor(entry, node, direction, 'top')
    }
  };
}

/** The edge two boxes are expected to share: left when stacked, top when side by side. */
export function sharedEdge(
  left: { box: ElementBox },
  right: { box: ElementBox }
): 'left' | 'top' | null {
  if (left.box.bottom <= right.box.top || right.box.bottom <= left.box.top) return 'left';
  if (left.box.right <= right.box.left || right.box.right <= left.box.left) return 'top';
  return null;
}

export function sourceOn(block: PrototypeBlock, edge: 'left' | 'top'): BlockSource {
  return edge === 'left' ? block.sources.left : block.sources.top;
}

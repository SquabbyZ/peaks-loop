/**
 * Numbering the cut objects and containers (QD11).
 *
 * The id is a structural fingerprint: route + ancestor role chain + own role +
 * text summary. A DOM position is never part of it. Two structurally identical
 * twins would collide, so the second occurrence in document order gets a `-2`
 * suffix — an equality-group ordinal, not a DOM index, and deterministic for
 * the same input.
 *
 * Every object's ancestors are emitted as `container` nodes, so the parent
 * chain is complete and the container that decides an edge can be named by id.
 * A container's own text is its DIRECT text only, so a child's copy change does
 * not renumber the container above it.
 */
import { createHash } from 'node:crypto';

import { roleOf, selectObjects } from './layout-cut.js';
import type { ElementBox, LayoutElement, LayoutGeometry, PaddingSides } from './layout-geometry.js';

export type NodeKind = 'object' | 'container';

/** One numbered node; `element` is an internal join key, never an id component. */
export type CutNode = {
  id: string;
  kind: NodeKind;
  tag: string;
  role: string;
  /** Direct text only; a container is numbered by this, so child copy cannot move it. */
  ownText: string;
  text: string;
  box: ElementBox;
  padding: PaddingSides;
  parentId: string | null;
  /** Every ancestor node id, root first, direct parent last. */
  parentChain: string[];
  /** Index into the captured elements; used only to link nodes and look up parents. */
  element: number;
};

/** The public node shape: no DOM index escapes the cut. */
export type LayoutNode = Omit<CutNode, 'element'>;

/** The id's text summary is capped so one long paragraph cannot bloat it. */
const ID_TEXT_CAP = 80;
/** Twelve hex chars keep an id readable while the collision space stays huge. */
const ID_LENGTH = 12;

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function summarize(text: string): string {
  return collapse(text).slice(0, ID_TEXT_CAP);
}

/** The structural fingerprint; no DOM position, no class name, no geometry. */
export function structuralId(
  route: string,
  chain: readonly string[],
  role: string,
  text: string
): string {
  const digest = createHash('sha256')
    .update([route, chain.join('>'), role, summarize(text)].join('\u0000'))
    .digest('hex');
  return digest.slice(0, ID_LENGTH);
}

/** Ancestor roles, root first, direct parent last; excludes the element itself. */
function ancestorRoles(index: number, elements: readonly LayoutElement[]): string[] {
  const roles: string[] = [];
  let parent = elements[index]?.parent ?? -1;
  while (parent >= 0) {
    const element = elements[parent];
    if (element !== undefined) roles.push(roleOf(element.tag, element.ariaRole));
    parent = element?.parent ?? -1;
  }
  return roles.reverse();
}

function roundedBox(box: ElementBox): ElementBox {
  return {
    left: Math.round(box.left),
    top: Math.round(box.top),
    right: Math.round(box.right),
    bottom: Math.round(box.bottom)
  };
}

type PendingNode = {
  element: number;
  kind: NodeKind;
  role: string;
  ownText: string;
  text: string;
  chain: readonly string[];
  box: ElementBox;
  padding: PaddingSides;
};

function pendingFor(
  index: number,
  kind: NodeKind,
  text: string,
  elements: readonly LayoutElement[]
): PendingNode {
  const element = elements[index];
  if (element === undefined) throw new Error(`layout cut lost element ${String(index)}`);
  return {
    element: index,
    kind,
    role: roleOf(element.tag, element.ariaRole),
    ownText: element.ownText,
    text,
    chain: ancestorRoles(index, elements),
    box: roundedBox(element.box),
    padding: element.padding
  };
}

/** Every ancestor element of every object, excluding object elements and html. */
function containerElements(
  objects: ReadonlySet<number>,
  elements: readonly LayoutElement[]
): Set<number> {
  const containers = new Set<number>();
  for (const object of objects) {
    let parent = elements[object]?.parent ?? -1;
    while (parent >= 0) {
      const element = elements[parent];
      if (element === undefined || element.tag === 'html') break;
      containers.add(parent);
      parent = element.parent;
    }
  }
  for (const object of objects) containers.delete(object);
  return containers;
}

type Identified = { pending: PendingNode; id: string };

/** Assign ids in document order; exact structural twins get a deterministic suffix. */
function assignIds(route: string, pending: readonly PendingNode[]): Identified[] {
  const seen = new Map<string, number>();
  return pending.map((node) => {
    const base = structuralId(route, node.chain, node.role, node.text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { pending: node, id: count === 0 ? base : `${base}-${String(count + 1)}` };
  });
}

/** Link each node to its nearest identified ancestor and record the full chain. */
function linkNodes(
  identified: readonly Identified[],
  elements: readonly LayoutElement[]
): CutNode[] {
  const nodes: CutNode[] = identified.map((entry) => ({
    id: entry.id,
    kind: entry.pending.kind,
    tag: elements[entry.pending.element]?.tag ?? '',
    role: entry.pending.role,
    ownText: entry.pending.ownText,
    text: entry.pending.text,
    box: entry.pending.box,
    padding: entry.pending.padding,
    parentId: null,
    parentChain: [],
    element: entry.pending.element
  }));
  const byElement = new Map<number, CutNode>();
  for (const node of nodes) byElement.set(node.element, node);
  for (const node of nodes) {
    const chain: string[] = [];
    let parent = elements[node.element]?.parent ?? -1;
    while (parent >= 0) {
      const found = byElement.get(parent);
      if (found !== undefined) {
        if (node.parentId === null) node.parentId = found.id;
        chain.push(found.id);
      }
      parent = elements[parent]?.parent ?? -1;
    }
    node.parentChain = chain.reverse();
  }
  return nodes;
}

/**
 * Cut one measured document into numbered objects and their numbered
 * containers, parent-linked, in document order.
 */
export function cutVisualObjects(geometry: LayoutGeometry): CutNode[] {
  const elements = geometry.elements;
  const objects = selectObjects(elements);
  const containers = containerElements(objects, elements);
  const pending: PendingNode[] = [
    ...[...containers].map((index) =>
      pendingFor(index, 'container', elements[index]?.ownText ?? '', elements)
    ),
    ...[...objects].map((index) =>
      pendingFor(index, 'object', elements[index]?.text ?? '', elements)
    )
  ].sort((left, right) => left.element - right.element);
  return linkNodes(assignIds(geometry.route, pending), elements);
}

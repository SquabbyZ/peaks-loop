/**
 * ARIA snapshot pruner (slice S1, AC2 — the mechanism).
 *
 * Pure and browser-free by design (tech-doc §4.2): it operates on the object
 * tree `locator.ariaSnapshotJSON()` returns, so it is fully unit-testable with
 * fixture trees and needs no Playwright at all.
 *
 * Three caps, applied in this order (tech-doc §4.3):
 *   1. drop + hoist unnamed noise-role nodes;
 *   2. depth cap — a truncated parent gets a single `…` child marker;
 *   3. node cap — one `… [N more nodes]` marker is appended.
 *
 * The byte ceiling is NOT here: `capText(renderSnapshot(...), MAX_SNAP_BYTES)`
 * is applied by the caller, because only a byte count can bound the rendering.
 */
import { MAX_SNAP_DEPTH, MAX_SNAP_NODES } from './bounded-output.js';

/**
 * A node of the `ariaSnapshotJSON()` tree. Fields follow the documented format
 * (`role` is `"text"` for static text fragments; state flags and element
 * attributes are optional).
 */
export interface AriaNode {
  readonly role: string;
  readonly name?: string;
  readonly text?: string;
  readonly children?: readonly AriaNode[];
  readonly checked?: boolean | 'mixed';
  readonly disabled?: boolean;
  readonly expanded?: boolean;
  readonly active?: boolean;
  readonly invalid?: boolean | 'mixed';
  readonly level?: number;
  readonly pressed?: boolean | 'mixed';
  readonly selected?: boolean;
  readonly url?: string;
  readonly placeholder?: string;
  readonly ref?: string;
  readonly cursor?: string;
}

/**
 * Roles that carry no information on their own. A node of one of these roles
 * is removed and its children are hoisted into its parent when it also has no
 * name, no text and no state flags — this is the single largest size win, and
 * it is exactly what the MCP snapshot cannot do.
 */
export const SNAPSHOT_NOISE_ROLES: ReadonlySet<string> = new Set<string>([
  'generic',
  'none',
  'presentation',
  'InlineTextBox',
  'LineBreak',
  'strong',
  'emphasis',
  'code',
  'paragraph',
  'StaticText'
]);

export interface SnapshotPruneResult {
  readonly nodes: readonly AriaNode[];
  /** Nodes removed by the drop+hoist pass. */
  readonly droppedNodes: number;
  /** True when at least one node's children were replaced by a `…` marker. */
  readonly depthCapped: boolean;
  /** True when the node cap stopped emission and the `[N more nodes]` marker was appended. */
  readonly nodeCapped: boolean;
}

const TRUNCATION_TEXT = '…';
const MAX_ATTRIBUTE_CHARS = 80;

/** Prune `nodes` under the three caps. Deterministic: the same tree in, the same tree out. */
export function pruneAriaSnapshot(nodes: readonly AriaNode[]): SnapshotPruneResult {
  const hoistCounter = { dropped: 0 };
  const hoisted = dropAndHoist(nodes, hoistCounter);

  let depthCapped = false;
  const depthCappedNodes = applyDepthCap(hoisted, 1, MAX_SNAP_DEPTH, () => {
    depthCapped = true;
  });

  let droppedByNodeCap = 0;
  const cappedNodes = applyNodeCap(depthCappedNodes, MAX_SNAP_NODES, { emitted: 0 }, (count) => {
    droppedByNodeCap += count;
  });

  const nodeCapped = droppedByNodeCap > 0;
  const pruned = nodeCapped
    ? [...cappedNodes, { role: 'text', text: `${TRUNCATION_TEXT} [${droppedByNodeCap} more nodes]` }]
    : cappedNodes;

  return {
    nodes: pruned,
    droppedNodes: hoistCounter.dropped,
    depthCapped,
    nodeCapped
  };
}

function hasStateFlags(node: AriaNode): boolean {
  return (
    node.checked !== undefined ||
    node.disabled !== undefined ||
    node.expanded !== undefined ||
    node.active !== undefined ||
    node.invalid !== undefined ||
    node.level !== undefined ||
    node.pressed !== undefined ||
    node.selected !== undefined
  );
}

function isDroppable(node: AriaNode): boolean {
  if (!SNAPSHOT_NOISE_ROLES.has(node.role)) {
    return false;
  }
  if (node.name !== undefined && node.name !== '') {
    return false;
  }
  if (node.text !== undefined && node.text !== '') {
    return false;
  }
  return !hasStateFlags(node);
}

/**
 * Pass 1 — remove droppable nodes, splicing their children into the parent list.
 *
 * Runs on the RAW page tree, before any cap applies, so it must survive shapes
 * the caps would have removed: an explicit stack rather than recursion (a
 * ~5 000-deep chain overflows the call stack) and per-element assignment rather
 * than `push(...children)` (a ~125 000-sibling list hits V8's argument-count
 * limit). Both were measured RangeErrors on a page-controlled tree.
 */
function dropAndHoist(list: readonly AriaNode[], counter: { dropped: number }): AriaNode[] {
  const root: AriaNode[] = [];
  const stack: Array<{ source: readonly AriaNode[]; index: number; out: AriaNode[] }> = [
    { source: list, index: 0, out: root },
  ];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined || frame.index >= frame.source.length) {
      stack.pop();
      continue;
    }
    const node = frame.source[frame.index];
    frame.index += 1;
    if (node === undefined) {
      continue;
    }
    const children = node.children ?? [];
    if (isDroppable(node)) {
      counter.dropped += 1;
      if (children.length > 0) {
        // Hoisted children splice into the CURRENT output, so this frame feeds
        // the parent's array rather than one of its own.
        stack.push({ source: children, index: 0, out: frame.out });
      }
      continue;
    }
    if (children.length === 0) {
      frame.out.push(node);
      continue;
    }
    const hoisted: AriaNode[] = [];
    frame.out.push({ ...node, children: hoisted });
    stack.push({ source: children, index: 0, out: hoisted });
  }
  return root;
}

/** Pass 2 — stop descending at `maxDepth`, replacing the children with one `…` marker. */
function applyDepthCap(
  list: readonly AriaNode[],
  depth: number,
  maxDepth: number,
  onCap: () => void
): AriaNode[] {
  return list.map((node) => {
    const children = node.children ?? [];
    if (children.length === 0) {
      return node;
    }
    if (depth >= maxDepth) {
      onCap();
      return { ...node, children: [{ role: 'text', text: TRUNCATION_TEXT }] };
    }
    return { ...node, children: applyDepthCap(children, depth + 1, maxDepth, onCap) };
  });
}

/** Pass 3 — stop emitting once `maxNodes` real nodes are kept. */
function applyNodeCap(
  list: readonly AriaNode[],
  maxNodes: number,
  state: { emitted: number },
  onDrop: (droppedCount: number) => void
): AriaNode[] {
  const out: AriaNode[] = [];
  for (const node of list) {
    if (state.emitted >= maxNodes) {
      onDrop(countNodes(node));
      continue;
    }
    state.emitted += 1;
    const children = node.children ?? [];
    out.push(children.length > 0 ? { ...node, children: applyNodeCap(children, maxNodes, state, onDrop) } : node);
  }
  return out;
}

function countNodes(node: AriaNode): number {
  const children = node.children ?? [];
  return 1 + children.reduce((total, child) => total + countNodes(child), 0);
}

/**
 * Render the pruned tree as one line per node: `- <role> "<name>"` plus inline
 * state flags and (for links / inputs) `url` / `placeholder` truncated to 80
 * chars. Names are JSON-quoted, so a name containing a newline cannot break the
 * one-line-per-node contract.
 */
export function renderSnapshot(nodes: readonly AriaNode[]): string {
  const lines: string[] = [];
  const walk = (list: readonly AriaNode[], depth: number): void => {
    for (const node of list) {
      lines.push(renderNode(node, depth));
      const children = node.children ?? [];
      if (children.length > 0) {
        walk(children, depth + 1);
      }
    }
  };
  walk(nodes, 0);
  return lines.join('\n');
}

function renderNode(node: AriaNode, depth: number): string {
  const indent = '  '.repeat(depth);
  const label = node.name ?? node.text;
  let line = `${indent}- ${node.role}`;
  if (label !== undefined && label !== '') {
    line += ` ${JSON.stringify(label)}`;
  }
  for (const flag of stateFlags(node)) {
    line += ` [${flag}]`;
  }
  if (node.url !== undefined && node.url !== '') {
    line += ` url=${truncate(node.url, MAX_ATTRIBUTE_CHARS)}`;
  }
  if (node.placeholder !== undefined && node.placeholder !== '') {
    line += ` placeholder=${truncate(node.placeholder, MAX_ATTRIBUTE_CHARS)}`;
  }
  return line;
}

/**
 * Renders every flag `hasStateFlags` counts, in the same order — a flag that
 * protects a node from pruning must also be visible in the output, or the
 * caller cannot tell which of eight identically-named tabs is the selected one.
 */
function stateFlags(node: AriaNode): string[] {
  const flags: string[] = [];
  if (node.checked === true) {
    flags.push('checked');
  } else if (node.checked === 'mixed') {
    flags.push('checked=mixed');
  }
  if (node.disabled === true) {
    flags.push('disabled');
  }
  if (node.expanded === true) {
    flags.push('expanded');
  }
  if (node.active === true) {
    flags.push('active');
  }
  if (node.invalid === true) {
    flags.push('invalid');
  } else if (node.invalid === 'mixed') {
    flags.push('invalid=mixed');
  }
  if (typeof node.level === 'number') {
    flags.push(`level=${node.level}`);
  }
  if (node.pressed === true) {
    flags.push('pressed');
  } else if (node.pressed === 'mixed') {
    flags.push('pressed=mixed');
  }
  if (node.selected === true) {
    flags.push('selected');
  }
  return flags;
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars);
}

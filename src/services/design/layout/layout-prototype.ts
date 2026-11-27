/**
 * Direction prototypes for one graph entry: several independently openable
 * preview pages over the same block set, plus the structural filter that
 * decides which of them reach the human handoff.
 */
import { formatNumber, type GraphNode, type LayoutEntry } from './layout-graph.js';
import { PREVIEW_MARKER } from './layout-preview.js';
import {
  DEFAULT_SECTION_VALUE,
  PROTOTYPE_DIRECTIONS,
  blockFor,
  declaredValue,
  sharedEdge,
  sourceOn,
  type Prototype,
  type PrototypeBlock,
  type PrototypeDirection,
  type PrototypeSection,
  type Violation
} from './layout-prototype-model.js';
import { renderPrototypePage } from './layout-prototype-render.js';

export * from './layout-prototype-model.js';
export { renderPrototypePage };

/** QD17 keeps the human handoff at two; the rest stay clean alternatives. */
export const PROTOTYPE_HANDOFF_LIMIT = 2;

function sectionValue(entry: LayoutEntry, direction: PrototypeDirection): string {
  if (direction.tokenName !== null) return declaredValue(entry, direction.tokenName);
  const first = entry.nodes.find((node) => node.kind === 'object');
  if (first === undefined) return DEFAULT_SECTION_VALUE;
  const parent = entry.nodes.find((node) => node.id === first.parentId);
  return parent === undefined ? DEFAULT_SECTION_VALUE : `${formatNumber(parent.padding.left)}px`;
}

function sectionFor(entry: LayoutEntry, direction: PrototypeDirection): PrototypeSection {
  if (direction.flat) {
    return {
      id: entry.nodes.find((node) => node.tag === 'body')?.id ?? 'body',
      value: declaredValue(entry, direction.tokenName ?? 'space.page'),
      tokenName: direction.tokenName,
      flat: true
    };
  }
  return {
    id: direction.parentPrefix === null ? 'section:graph' : `${direction.parentPrefix}:section`,
    value: sectionValue(entry, direction),
    tokenName: direction.tokenName,
    flat: false
  };
}

/** A prototype contradicts itself when a shared edge has two different sources. */
function selfContradiction(block: PrototypeBlock, peers: readonly PrototypeBlock[]): boolean {
  for (const peer of peers) {
    if (peer.blockId === block.blockId) continue;
    const edge = sharedEdge(block, peer);
    if (edge === null) continue;
    const mine = sourceOn(block, edge);
    const theirs = sourceOn(peer, edge);
    if (mine.parentId !== theirs.parentId && mine.value !== theirs.value) return true;
  }
  return false;
}

function blockViolations(
  actual: PrototypeBlock,
  peers: readonly PrototypeBlock[],
  declared: ReadonlySet<string>
): Violation[] {
  const violations: Violation[] = [];
  for (const source of [actual.sources.left, actual.sources.top]) {
    if (source.tokenName === null || !declared.has(source.tokenName)) {
      violations.push({
        code: 'contract-violation',
        blockId: actual.blockId,
        detail: `block ${actual.blockId} uses undeclared spacing token ${source.tokenName ?? 'none'} on ${source.property}`
      });
    }
  }
  const mismatched = peers.find(
    (peer) =>
      peer.blockId !== actual.blockId && peer.chainRoles.join('>') !== actual.chainRoles.join('>')
  );
  if (mismatched !== undefined) {
    violations.push({
      code: 'parent-chain-broken',
      blockId: actual.blockId,
      detail: `block ${actual.blockId} keeps ${actual.chainRoles.join('>') || '(root)'} while ${mismatched.blockId} keeps ${mismatched.chainRoles.join('>') || '(root)'}`
    });
  }
  if (selfContradiction(actual, peers)) {
    violations.push({
      code: 'anchor-self-contradiction',
      blockId: actual.blockId,
      detail: `block ${actual.blockId} shares an edge whose two sides resolve to different parents and token values`
    });
  }
  return violations;
}

function violationsOf(
  entry: LayoutEntry,
  objects: readonly GraphNode[],
  blocks: readonly PrototypeBlock[]
): Violation[] {
  const declared = new Set(entry.tokens.map((token) => token.name));
  const violations: Violation[] = [];
  for (const node of objects) {
    const actual = blocks.find((block) => block.blockId === node.id);
    if (actual === undefined) {
      violations.push({
        code: 'missing-block',
        blockId: node.id,
        detail: `the prototype has no block for ${node.id}`
      });
      continue;
    }
    violations.push(...blockViolations(actual, blocks, declared));
  }
  return violations;
}

export type GeneratedPrototypes =
  { ok: true; prototypes: Prototype[] } | { ok: false; reason: string };

/** One preview per direction, all sharing the entry's block set. */
export function generatePrototypes(entry: LayoutEntry): GeneratedPrototypes {
  const objects = entry.nodes.filter((node) => node.kind === 'object');
  if (objects.length === 0)
    return { ok: false, reason: 'the entry has no visual object to prototype' };
  const prototypes = PROTOTYPE_DIRECTIONS.map((direction) => {
    const blocks = objects.map((node) => blockFor(entry, node, direction));
    const section = sectionFor(entry, direction);
    return {
      name: direction.name,
      html: renderPrototypePage(direction.name, blocks, section, direction.outline),
      marker: PREVIEW_MARKER,
      section,
      blocks,
      violations: violationsOf(entry, objects, blocks)
    };
  });
  return { ok: true, prototypes };
}

export type PrototypeFilter = {
  kept: Prototype[];
  capped: Array<{ name: string; reason: string }>;
  dropped: Array<{ name: string; violations: Violation[] }>;
};

/**
 * Keep the first two structurally clean prototypes in direction order; the rest
 * are reported as capped, and a violation is reported under its own code.
 */
export function filterPrototypes(prototypes: readonly Prototype[]): PrototypeFilter {
  const kept: Prototype[] = [];
  const capped: PrototypeFilter['capped'] = [];
  const dropped: PrototypeFilter['dropped'] = [];
  for (const prototype of prototypes) {
    if (prototype.violations.length > 0) {
      dropped.push({ name: prototype.name, violations: prototype.violations });
    } else if (kept.length < PROTOTYPE_HANDOFF_LIMIT) {
      kept.push(prototype);
    } else {
      capped.push({
        name: prototype.name,
        reason: `handoff cap is ${String(PROTOTYPE_HANDOFF_LIMIT)}`
      });
    }
  }
  return { kept, capped, dropped };
}

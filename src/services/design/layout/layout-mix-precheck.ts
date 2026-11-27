/**
 * The two pre-check layers in QD18 order: contract first, then the parent
 * chain, then the shared-edge source. A pair picks its edge from the boxes; a
 * lone candidate is checked against the page block it replaces.
 */
import {
  sharedEdge,
  sourceOn,
  type BlockSource,
  type PrototypeBlock
} from './layout-prototype-model.js';

export type SourceRef = BlockSource & { blockId: string };

export type AnchorConflict = {
  edge: 'left' | 'top';
  candidate: SourceRef;
  neighbour: SourceRef;
  detail: string;
};

export type MixPrecheck =
  | { layer: 'anchor'; verdict: 'allow'; detail: string }
  | {
      layer: 'anchor';
      verdict: 'conflict';
      code: 'ANCHOR_SOURCE_CONFLICT';
      conflict: AnchorConflict;
    }
  | {
      layer: 'contract' | 'anchor';
      verdict: 'refuse';
      code: 'CONTRACT_TOKEN_UNDECLARED' | 'PARENT_CHAIN_BROKEN';
      detail: string;
    };

function sourceRef(blockId: string, source: BlockSource): SourceRef {
  return { blockId, ...source };
}

function tokenRefusal(
  block: PrototypeBlock,
  edge: 'left' | 'top',
  declared: ReadonlySet<string>,
  label: string
): string | null {
  const token = sourceOn(block, edge).tokenName;
  return token !== null && declared.has(token)
    ? null
    : `${label} ${block.blockId} has no declared ${edge}-edge token (${token ?? 'none'})`;
}

function conflictOrAllow(
  candidate: PrototypeBlock,
  neighbour: PrototypeBlock,
  edge: 'left' | 'top'
): MixPrecheck {
  const mine = sourceOn(candidate, edge);
  const theirs = sourceOn(neighbour, edge);
  if (mine.parentId === theirs.parentId || mine.value === theirs.value) {
    return {
      layer: 'anchor',
      verdict: 'allow',
      detail: `blocks ${candidate.blockId} and ${neighbour.blockId} both take the ${edge} edge from ${mine.value}`
    };
  }
  const detail =
    `candidate ${candidate.blockId} expects the ${edge} edge from parent ${String(mine.parentId)} token ${String(mine.tokenName)}=${mine.value}; ` +
    `neighbour ${neighbour.blockId} expects it from parent ${String(theirs.parentId)} token ${String(theirs.tokenName)}=${theirs.value}`;
  return {
    layer: 'anchor',
    verdict: 'conflict',
    code: 'ANCHOR_SOURCE_CONFLICT',
    conflict: {
      edge,
      candidate: sourceRef(candidate.blockId, mine),
      neighbour: sourceRef(neighbour.blockId, theirs),
      detail
    }
  };
}

/** Contract, parent chain, shared-edge source; the first failing layer decides. */
export function precheckPair(
  candidate: PrototypeBlock,
  neighbour: PrototypeBlock,
  declared: ReadonlySet<string>
): MixPrecheck {
  const edge = sharedEdge(candidate, neighbour);
  if (edge === null) {
    return {
      layer: 'anchor',
      verdict: 'allow',
      detail: `blocks ${candidate.blockId} and ${neighbour.blockId} do not share an edge`
    };
  }
  const refusal =
    tokenRefusal(candidate, edge, declared, 'block') ??
    tokenRefusal(neighbour, edge, declared, 'neighbour');
  if (refusal !== null) {
    return {
      layer: 'contract',
      verdict: 'refuse',
      code: 'CONTRACT_TOKEN_UNDECLARED',
      detail: refusal
    };
  }
  if (candidate.chainRoles.join('>') !== neighbour.chainRoles.join('>')) {
    return {
      layer: 'anchor',
      verdict: 'refuse',
      code: 'PARENT_CHAIN_BROKEN',
      detail: `block ${candidate.blockId} keeps the chain ${candidate.chainRoles.join('>') || '(root)'} but neighbour ${neighbour.blockId} sits on ${neighbour.chainRoles.join('>') || '(root)'}; the original parent chain cannot be preserved`
    };
  }
  return conflictOrAllow(candidate, neighbour, edge);
}

/** A lone candidate is checked against the page block it replaces, not waved through. */
export function validateIsolated(
  current: PrototypeBlock,
  candidate: PrototypeBlock,
  declared: ReadonlySet<string>
): MixPrecheck {
  const refusal = tokenRefusal(candidate, 'left', declared, 'block');
  if (refusal !== null) {
    return {
      layer: 'contract',
      verdict: 'refuse',
      code: 'CONTRACT_TOKEN_UNDECLARED',
      detail: refusal
    };
  }
  if (candidate.chainRoles.join('>') !== current.chainRoles.join('>')) {
    return {
      layer: 'anchor',
      verdict: 'refuse',
      code: 'PARENT_CHAIN_BROKEN',
      detail: `block ${candidate.blockId} keeps the chain ${candidate.chainRoles.join('>') || '(root)'} but the page block ${current.blockId} sits on ${current.chainRoles.join('>') || '(root)'}; the original parent chain cannot be preserved`
    };
  }
  return {
    layer: 'anchor',
    verdict: 'allow',
    detail: `block ${candidate.blockId} keeps the page chain ${current.chainRoles.join('>') || '(root)'}`
  };
}

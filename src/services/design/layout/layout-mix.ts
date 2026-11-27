/**
 * Block-level mixing: one move replaces one block, and the replacement is
 * pre-checked against both adjacent blocks before the next move. A failed
 * sequence yields no page, so a chain break cannot degrade into a normal page.
 */
import type { LayoutEntry } from './layout-graph.js';
import {
  precheckPair,
  validateIsolated,
  type AnchorConflict,
  type MixPrecheck
} from './layout-mix-precheck.js';
import { renderPrototypePage, type Prototype, type PrototypeBlock } from './layout-prototype.js';

export { precheckPair, validateIsolated };
export type { AnchorConflict, MixPrecheck, SourceRef } from './layout-mix-precheck.js';

export type MixMove = { blockId: string; from: string };

export type MixStep = { move: MixMove; blockId: string; precheck: MixPrecheck };

export type MixFailureCode =
  | 'CONTRACT_BASE_MISSING'
  | 'CONTRACT_BASE_INVALID'
  | 'CONTRACT_PROTOTYPE_MISSING'
  | 'CONTRACT_BLOCK_MISSING'
  | 'CONTRACT_ROLE_MISMATCH'
  | 'CONTRACT_TOKEN_UNDECLARED'
  | 'PARENT_CHAIN_BROKEN'
  | 'ANCHOR_SOURCE_CONFLICT';

export type MixResult =
  | { ok: true; html: string; blocks: PrototypeBlock[]; steps: MixStep[] }
  | {
      ok: false;
      code: MixFailureCode;
      message: string;
      steps: MixStep[];
      conflict: AnchorConflict | null;
    };

function failure(code: MixFailureCode, message: string, steps: MixStep[]): MixResult {
  return { ok: false, code, message, steps, conflict: null };
}

function conflictFailure(
  check: Extract<MixPrecheck, { verdict: 'conflict' }>,
  steps: MixStep[]
): MixResult {
  return {
    ok: false,
    code: 'ANCHOR_SOURCE_CONFLICT',
    message: check.conflict.detail,
    steps,
    conflict: check.conflict
  };
}

type MoveTarget =
  | { ok: true; candidate: PrototypeBlock; index: number }
  | { ok: false; code: MixFailureCode; message: string };

function targetOf(
  blocks: readonly PrototypeBlock[],
  move: MixMove,
  catalog: ReadonlyMap<string, Prototype>
): MoveTarget {
  const from = catalog.get(move.from);
  if (from === undefined) {
    return {
      ok: false,
      code: 'CONTRACT_PROTOTYPE_MISSING',
      message: `no prototype named ${move.from}`
    };
  }
  const candidate = from.blocks.find((block) => block.blockId === move.blockId);
  const index = blocks.findIndex((block) => block.blockId === move.blockId);
  const current = blocks[index];
  if (candidate === undefined || current === undefined) {
    return {
      ok: false,
      code: 'CONTRACT_BLOCK_MISSING',
      message: `no block ${move.blockId} on ${move.from} or the base`
    };
  }
  if (candidate.role !== current.role) {
    return {
      ok: false,
      code: 'CONTRACT_ROLE_MISMATCH',
      message: `block ${move.blockId} is ${candidate.role} on ${move.from} and ${current.role} on the base`
    };
  }
  return { ok: true, candidate, index };
}

function neighboursOf(blocks: readonly PrototypeBlock[], index: number): PrototypeBlock[] {
  return [blocks[index - 1], blocks[index + 1]].filter(
    (block): block is PrototypeBlock => block !== undefined
  );
}

type AdvanceContext = {
  move: MixMove;
  declared: ReadonlySet<string>;
  steps: MixStep[];
};

function checkAdvance(
  blocks: readonly PrototypeBlock[],
  target: { candidate: PrototypeBlock; index: number },
  context: AdvanceContext
): MixResult | PrototypeBlock[] {
  const { move, declared, steps } = context;
  const current = blocks[target.index];
  if (current === undefined) {
    return failure('CONTRACT_BLOCK_MISSING', `no block ${move.blockId} on the base`, steps);
  }
  const neighbours = neighboursOf(blocks, target.index);
  const checks =
    neighbours.length === 0
      ? [validateIsolated(current, target.candidate, declared)]
      : neighbours.map((neighbour) => precheckPair(target.candidate, neighbour, declared));
  const check = checks.find((candidate) => candidate.verdict !== 'allow') ?? checks[0];
  if (check === undefined) {
    return failure('CONTRACT_BLOCK_MISSING', `no block ${move.blockId} on the base`, steps);
  }
  steps.push({ move, blockId: target.candidate.blockId, precheck: check });
  if (check.verdict === 'conflict') return conflictFailure(check, steps);
  if (check.verdict === 'refuse') return failure(check.code, check.detail, steps);
  return blocks.map((block, position) => (position === target.index ? target.candidate : block));
}

/**
 * Apply moves one block at a time: replace, pre-check against both adjacent
 * blocks, and stop on the first refusal or conflict. A failed sequence yields
 * no page, and a base that already violates a structural rule is refused.
 */
export function mixSequence(
  entry: LayoutEntry,
  prototypes: readonly Prototype[],
  baseName: string,
  moves: readonly MixMove[]
): MixResult {
  const catalog = new Map(prototypes.map((prototype) => [prototype.name, prototype]));
  const base = catalog.get(baseName);
  if (base === undefined)
    return failure('CONTRACT_BASE_MISSING', `no prototype named ${baseName}`, []);
  if (base.violations.length > 0) {
    return failure(
      'CONTRACT_BASE_INVALID',
      `prototype ${baseName} already violates ${base.violations[0]?.code ?? 'a structural rule'}`,
      []
    );
  }
  const declared = new Set(entry.tokens.map((token) => token.name));
  const steps: MixStep[] = [];
  let blocks = [...base.blocks];
  for (const move of moves) {
    const target = targetOf(blocks, move, catalog);
    if (!target.ok) return failure(target.code, target.message, steps);
    const next = checkAdvance(blocks, target, { move, declared, steps });
    if (!Array.isArray(next)) return next;
    blocks = next;
  }
  return {
    ok: true,
    html: renderPrototypePage('mixed', blocks, base.section, false),
    blocks,
    steps
  };
}

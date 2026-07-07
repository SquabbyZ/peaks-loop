/**
 * Slice DAG model — 2.7.0 slice-dag-dispatcher MVP (slice 1.2.a).
 *
 * Pure function module. No I/O. No external state.
 *
 * Types:
 *   - `SliceNode` — a single unit of work (e.g. "implement CLI dispatch").
 *   - `DependsOn` — directed edge from `to` to `from` (i.e. `to` runs after `from`).
 *   - `SliceDag` — `{ nodes, edges }`. The graph MUST be a DAG.
 *
 * Constraints (validated by `validateDag`):
 *   1. No cycles.
 *   2. Node IDs are globally unique.
 *   3. Every edge endpoints reference existing node IDs.
 *   4. Node `role` is a non-empty string (whitelist hint, not a strict check).
 *
 * Why this lives outside `sub-agent-dispatcher.ts`:
 *   The dispatcher is a per-IDE adapter; the DAG is a logical plan. Keeping
 *   them split keeps the adapter file IDE-shape-focused and the DAG file
 *   plan-shape-focused. Both are pure.
 *
 * Hash stability:
 *   `serializeDag` sorts nodes by `id` and edges by `(from, to)` so the
 *   resulting JSON string is stable across object-literal ordering. The
 *   SHA-256 hash is therefore reproducible for the same logical DAG.
 */
import { createHash } from 'node:crypto';

/**
 * Slice complexity tier (v2.15.0 follow-up, G2 in 12 Gaps).
 * Used by Code to schedule complex slices during user-attended hours
 * and trivial / simple slices overnight.
 */
export type SliceComplexity = 'trivial' | 'simple' | 'complex';

export const SLICE_COMPLEXITIES: readonly SliceComplexity[] = [
  'trivial',
  'simple',
  'complex'
] as const;

export function isSliceComplexity(value: string): value is SliceComplexity {
  return (SLICE_COMPLEXITIES as readonly string[]).includes(value);
}

export interface SliceNode {
  readonly id: string;
  readonly role: string;
  /** Human-readable label, optional. */
  readonly label?: string;
  /** Optional prompt override; dispatch falls back to a default placeholder. */
  readonly prompt?: string;
  /**
   * v2.15.0 follow-up — G12: foundation slice. Foundation slices run before
   * business slices in the layered DAG. Business slices do NOT wait for
   * ALL foundation slices — they wait only for the foundation subset
   * they declare as `dependsOn`. Optional; default false.
   */
  readonly foundation?: boolean;
  /**
   * v2.15.0 follow-up — G11: upstream sync slice. Marks a slice that
   * syncs an upstream fork (e.g. hermes) to a new tag. UpstreamSync
   * slices take priority within their topological level. Optional.
   */
  readonly upstreamSync?: boolean;
  /**
   * v2.15.0 follow-up — G2: complexity tier. Drives Code's scheduling
   * (complex = user-attended, simple/trivial = overnight). Optional.
   */
  readonly complexity?: SliceComplexity;
}

export interface DependsOn {
  readonly from: string;
  readonly to: string;
}

export interface SliceDag {
  readonly nodes: readonly SliceNode[];
  readonly edges: readonly DependsOn[];
}

/** Thrown by `validateDag` when the graph violates one of the constraints. */
export class InvalidSliceDagError extends Error {
  readonly code = 'INVALID_SLICE_DAG' as const;
  constructor(message: string, public readonly path?: readonly string[]) {
    super(message);
    this.name = 'InvalidSliceDagError';
  }
}

/** Thrown by `topologicalLevels` when the graph has a cycle (defensive). */
export class SliceDagCycleError extends Error {
  readonly code = 'SLICE_DAG_CYCLE' as const;
  constructor(public readonly cyclePath: readonly string[]) {
    super(`cycle detected in slice DAG: ${cyclePath.join(' -> ')}`);
    this.name = 'SliceDagCycleError';
  }
}

/**
 * Validate a SliceDag. Throws `InvalidSliceDagError` on the first violation.
 * Pure. Cheap. No I/O.
 */
export function validateDag(dag: SliceDag): void {
  if (!dag || !Array.isArray(dag.nodes) || !Array.isArray(dag.edges)) {
    throw new InvalidSliceDagError('dag must have nodes and edges arrays');
  }
  if (dag.nodes.length === 0) {
    throw new InvalidSliceDagError('dag must have at least one node');
  }

  const seen = new Set<string>();
  for (const n of dag.nodes) {
    if (!n || typeof n.id !== 'string' || n.id.length === 0) {
      throw new InvalidSliceDagError('every node must have a non-empty id');
    }
    if (typeof n.role !== 'string' || n.role.length === 0) {
      throw new InvalidSliceDagError(`node ${n.id} must have a non-empty role`);
    }
    if (seen.has(n.id)) {
      throw new InvalidSliceDagError(`duplicate node id: ${n.id}`);
    }
    seen.add(n.id);
  }

  for (const e of dag.edges) {
    if (!e || typeof e.from !== 'string' || typeof e.to !== 'string') {
      throw new InvalidSliceDagError('every edge must have string from/to');
    }
    if (!seen.has(e.from)) {
      throw new InvalidSliceDagError(`edge references unknown node: ${e.from}`);
    }
    if (!seen.has(e.to)) {
      throw new InvalidSliceDagError(`edge references unknown node: ${e.to}`);
    }
    if (e.from === e.to) {
      throw new InvalidSliceDagError(`self-loop not allowed: ${e.from}`);
    }
  }

  // v2.15.0 follow-up — G12: validate optional new fields ONLY when present
  // (老 DAG 不强制要求新字段,保持向后兼容).
  for (const n of dag.nodes) {
    if (n.foundation !== undefined && typeof n.foundation !== 'boolean') {
      throw new InvalidSliceDagError(`node ${n.id} foundation must be boolean when present`);
    }
    if (n.upstreamSync !== undefined && typeof n.upstreamSync !== 'boolean') {
      throw new InvalidSliceDagError(`node ${n.id} upstreamSync must be boolean when present`);
    }
    if (n.complexity !== undefined && !isSliceComplexity(n.complexity)) {
      throw new InvalidSliceDagError(
        `node ${n.id} complexity must be one of ${SLICE_COMPLEXITIES.join('|')} when present`
      );
    }
  }

  // v2.15.0 follow-up — G12 defensive rule: foundation slice can only
  // depend on another foundation slice. Business depending on foundation
  // is the main use case; foundation depending on business is a smell.
  const foundationSet = new Set(
    dag.nodes.filter((n) => n.foundation === true).map((n) => n.id)
  );
  for (const e of dag.edges) {
    if (foundationSet.has(e.to) && !foundationSet.has(e.from)) {
      throw new InvalidSliceDagError(
        `foundation slice ${e.to} cannot depend on non-foundation slice ${e.from}`
      );
    }
  }
}

/**
 * Compute topological levels. Each level is an array of node IDs that can
 * run in parallel. Throws `SliceDagCycleError` on cycle (defensive;
 * `validateDag` should have caught it).
 *
 * Algorithm: Kahn's algorithm. O(V + E).
 */
export function topologicalLevels(dag: SliceDag): readonly (readonly string[])[] {
  validateDag(dag);
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  // v2.15.0 follow-up — G12: priority sets for foundation / upstreamSync.
  const foundationSet = new Set(
    dag.nodes.filter((n) => n.foundation === true).map((n) => n.id)
  );
  const upstreamSyncSet = new Set(
    dag.nodes.filter((n) => n.upstreamSync === true).map((n) => n.id)
  );
  for (const n of dag.nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of dag.edges) {
    // Edge `from -> to` means `to` depends on `from`; `to` has one more incoming.
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    adj.get(e.from)?.push(e.to);
  }

  const levels: string[][] = [];
  let frontier = dag.nodes.map((n) => n.id).filter((id) => (indeg.get(id) ?? 0) === 0);
  const consumed = new Set<string>();

  while (frontier.length > 0) {
    // v2.15.0 follow-up — G12: sort frontier by (foundation desc,
    // upstreamSync desc, id asc). Stable across calls.
    const sortedFrontier = [...frontier].sort((a, b) => {
      const aF = foundationSet.has(a) ? 1 : 0;
      const bF = foundationSet.has(b) ? 1 : 0;
      if (aF !== bF) return bF - aF;
      const aU = upstreamSyncSet.has(a) ? 1 : 0;
      const bU = upstreamSyncSet.has(b) ? 1 : 0;
      if (aU !== bU) return bU - aU;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    levels.push(sortedFrontier);
    const next: string[] = [];
    for (const id of sortedFrontier) {
      consumed.add(id);
      for (const succ of adj.get(id) ?? []) {
        const d = (indeg.get(succ) ?? 0) - 1;
        indeg.set(succ, d);
        if (d === 0 && !consumed.has(succ)) {
          next.push(succ);
        }
      }
    }
    frontier = next;
  }

  if (consumed.size !== dag.nodes.length) {
    // Find a cycle path for the error message.
    const remaining = dag.nodes.map((n) => n.id).filter((id) => !consumed.has(id));
    throw new SliceDagCycleError(remaining);
  }
  return levels;
}

/**
 * Return the next set of node IDs that are ready to run given the set of
 * completed node IDs. A node is ready when all of its `from` predecessors
 * are in `completed`.
 */
export function sliceReadyToRun(dag: SliceDag, completed: ReadonlySet<string>): readonly string[] {
  validateDag(dag);
  const done = new Set(completed);
  const predecessors = new Map<string, string[]>();
  for (const n of dag.nodes) {
    predecessors.set(n.id, []);
  }
  for (const e of dag.edges) {
    predecessors.get(e.to)?.push(e.from);
  }
  const ready: string[] = [];
  for (const n of dag.nodes) {
    if (done.has(n.id)) continue;
    const preds = predecessors.get(n.id) ?? [];
    if (preds.every((p) => done.has(p))) {
      ready.push(n.id);
    }
  }
  return ready.sort();
}

/**
 * Serialize the DAG into a deterministic JSON string. Node IDs are sorted;
 * edges are sorted by `(from, to)`. The result is suitable for SHA-256
 * hashing and for byte-stable diffs.
 */
export function serializeDag(dag: SliceDag): string {
  validateDag(dag);
  const nodes = [...dag.nodes]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((n) => ({
      id: n.id,
      role: n.role,
      ...(n.label !== undefined ? { label: n.label } : {}),
      ...(n.prompt !== undefined ? { prompt: n.prompt } : {}),
      // v2.15.0 follow-up — G12: include new fields in serialization
      // (only when present, preserving hash stability for old DAGs).
      ...(n.foundation !== undefined ? { foundation: n.foundation } : {}),
      ...(n.upstreamSync !== undefined ? { upstreamSync: n.upstreamSync } : {}),
      ...(n.complexity !== undefined ? { complexity: n.complexity } : {})
    }));
  const edges = [...dag.edges]
    .sort((a, b) => {
      if (a.from !== b.from) return a.from < b.from ? -1 : 1;
      if (a.to !== b.to) return a.to < b.to ? -1 : 1;
      return 0;
    })
    .map((e) => ({ from: e.from, to: e.to }));
  return JSON.stringify({ nodes, edges });
}

/** SHA-256 hash of the serialized DAG. Stable across runs. */
export function hashDag(dag: SliceDag): string {
  return createHash('sha256').update(serializeDag(dag)).digest('hex');
}

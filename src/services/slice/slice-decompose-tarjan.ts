/**
 * Tarjan SCC + summarisation helpers for the slice-decompose pipeline.
 * Extracted from `slice-decompose-service.ts` to keep that file under
 * the 800 LOC cap (mechanical verbatim move). `findSCCs` is the only
 * exported entry point; the rest are internal helpers.
 */

import type { DependencyEdge, SccAnalysis } from './slice-decompose-types.js';

export function findSCCs(nodeIds: readonly string[], edges: readonly DependencyEdge[]): SccAnalysis {
  const adj = buildAdjacencyList(nodeIds, edges);
  const sccs = runTarjan(nodeIds, adj);
  return summariseSccs(sccs, edges);
}

/** Build a forward adjacency map: nodeId → list of distinct neighbours. */
function buildAdjacencyList(nodeIds: readonly string[], edges: readonly DependencyEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    const list = adj.get(e.from);
    if (list && !list.includes(e.to)) list.push(e.to);
  }
  return adj;
}

/** Tarjan SCC visitor state. The recursive `strongconnect` reads/writes
 *  this object instead of capturing mutable counters via closure; that
 *  separation lets us split the body into `enterNode`, `relaxEdge`,
 *  and `finaliseRoot` so the per-iteration cyclomatic budget stays low. */
interface TarjanVisitor {
  index: number;
  idx: Map<string, number>;
  lowlink: Map<string, number>;
  onStack: Set<string>;
  stack: string[];
  sccs: string[][];
}

function createTarjanVisitor(): TarjanVisitor {
  return {
    index: 0,
    idx: new Map(),
    lowlink: new Map(),
    onStack: new Set(),
    stack: [],
    sccs: []
  };
}

function enterNode(visitor: TarjanVisitor, v: string): void {
  visitor.idx.set(v, visitor.index);
  visitor.lowlink.set(v, visitor.index);
  visitor.index++;
  visitor.stack.push(v);
  visitor.onStack.add(v);
}

function relaxEdge(
  visitor: TarjanVisitor,
  v: string,
  w: string,
  recurse: (next: string) => void
): void {
  if (!visitor.idx.has(w)) {
    recurse(w);
    visitor.lowlink.set(v, Math.min(visitor.lowlink.get(v) ?? 0, visitor.lowlink.get(w) ?? 0));
  } else if (visitor.onStack.has(w)) {
    visitor.lowlink.set(v, Math.min(visitor.lowlink.get(v) ?? 0, visitor.idx.get(w) ?? 0));
  }
}

function finaliseRoot(visitor: TarjanVisitor, v: string): void {
  if ((visitor.lowlink.get(v) ?? 0) !== (visitor.idx.get(v) ?? 0)) return;
  const component: string[] = [];
  let w: string;
  do {
    w = visitor.stack.pop()!;
    visitor.onStack.delete(w);
    component.push(w);
  } while (w !== v);
  visitor.sccs.push(component);
}

/** Run Tarjan's SCC algorithm; returns the list of components in
 *  discovery order. Visitor state is hoisted to a named struct
 *  (`TarjanVisitor`) so the recursive body can be split into
 *  enterNode / relaxEdge / finaliseRoot without parameter sprawl. */
function runTarjan(nodeIds: readonly string[], adj: ReadonlyMap<string, readonly string[]>): string[][] {
  const visitor = createTarjanVisitor();

  const strongconnect = (v: string): void => {
    enterNode(visitor, v);
    for (const w of adj.get(v) ?? []) {
      relaxEdge(visitor, v, w, strongconnect);
    }
    finaliseRoot(visitor, v);
  };

  for (const id of nodeIds) {
    if (!visitor.idx.has(id)) strongconnect(id);
  }
  return visitor.sccs;
}

function summariseSccs(sccs: readonly string[][], edges: readonly DependencyEdge[]): SccAnalysis {
  const trivial: string[] = [];
  const nonTrivial: string[] = [];
  for (const scc of sccs) {
    if (scc.length === 1) trivial.push(scc[0]!);
    else nonTrivial.push(...scc);
  }

  let condensationEdges = 0;
  for (const e of edges) {
    if (!sameScc(sccs, e.from, e.to)) condensationEdges++;
  }

  return {
    sccCount: sccs.length,
    trivialSCCs: trivial,
    nonTrivialSCCs: nonTrivial,
    condensationEdges
  };
}

function sameScc(sccs: readonly string[][], a: string, b: string): boolean {
  for (const scc of sccs) {
    if (scc.includes(a) && scc.includes(b)) return true;
  }
  return false;
}

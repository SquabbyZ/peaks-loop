/**
 * Workflow graph store (RD §2, §4 — slice 4.0.8 presence-lease-graph).
 *
 * Safe-path, locked, atomic graph persistence. Reads fail closed on
 * malformed JSON / schema violation / cycle / unknown node id. Writes
 * use a tmp+rename primitive to guarantee no half-written graph on
 * crash. The store never inspects vendor env vars and never falls
 * back to a legacy marker when the canonical graph is unreadable —
 * canonical corruption is surfaced with `PEAKS_GRAPH_CORRUPTED`.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname } from 'node:path';
import { isArray } from '../../shared/array-guards.js';
import {
  type WorkflowGraph,
  type WorkflowGraphEdge,
  type WorkflowId,
  type NodeId,
  WORKFLOW_ID_REGEX,
  NODE_ID_REGEX
} from './workflow-graph-types.js';
import {
  detectCycle,
  graphPathFor,
  makeError,
  PEAKS_GRAPH_NOT_FOUND,
  PEAKS_GRAPH_CORRUPTED,
  PEAKS_GRAPH_REF_BROKEN
} from './workflow-graph-store-helpers.js';
export {
  PEAKS_GRAPH_NOT_FOUND,
  PEAKS_GRAPH_CORRUPTED,
  PEAKS_GRAPH_CYCLE,
  PEAKS_GRAPH_REF_BROKEN,
  PEAKS_GRAPH_NODE_REQUIRED,
  PEAKS_GRAPH_NODE_NOT_PREPARED,
  PEAKS_GRAPH_NODE_KIND_INVALID,
  PEAKS_NODE_EXISTS,
  PEAKS_NODE_TRANSITION_INVALID,
  PEAKS_ENVELOPE_NOT_RECEIVED,
  PEAKS_ENVELOPE_GRAPH_MISMATCH,
  PEAKS_TERMINAL_REASON_INVALID,
  PEAKS_TERMINALIZE_ATOMICITY_FAILED,
  PEAKS_UNCONSUMED_ENVELOPE,
  PEAKS_DEPENDENCY_NOT_CONSUMED,
  PEAKS_WORKFLOW_OWNS_PRESENCE_CLEAR,
  PEAKS_SESSION_NOT_BOUND,
  PEAKS_CALLER_NOT_RESOLVED,
  graphPathFor,
  emptyGraph
} from './workflow-graph-store-helpers.js';
export type { GraphStoreError } from './workflow-graph-store-helpers.js';

/** Atomically write a graph: tmp + rename. */
function writeAtomic(targetPath: string, body: string): void {
  const dir = dirname(targetPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(tmpPath, body, 'utf8');
  renameSync(tmpPath, targetPath);
}

/** Acquire a short-lived atomic update lock. */
function acquireLock(lockPath: string, holder: string, ttlMs = 30_000): void {
  const lockDir = dirname(lockPath);
  if (!existsSync(lockDir)) mkdirSync(lockDir, { recursive: true });
  if (existsSync(lockPath)) {
    const stat = statSync(lockPath);
    if (stat.mtimeMs + ttlMs < Date.now()) {
      // Stale lock — remove and continue.
      try {
        unlinkSync(lockPath);
      } catch {
        /* swallow */
      }
    } else {
      throw makeError('PEAKS_GRAPH_LOCK_HELD', `graph lock held: ${lockPath}`);
    }
  }
  writeFileSync(lockPath, holder, 'utf8');
}

function releaseLock(lockPath: string): void {
  try {
    if (existsSync(lockPath)) unlinkSync(lockPath);
  } catch {
    /* swallow */
  }
}

/** Validate a graph shape; throw `PEAKS_GRAPH_CORRUPTED` on any violation. */
export function validateGraph(graph: unknown): WorkflowGraph {
  if (typeof graph !== 'object' || graph === null) {
    throw makeError(PEAKS_GRAPH_CORRUPTED, 'graph is not an object');
  }
  const g = graph as Partial<WorkflowGraph>;
  if (typeof g.workflowId !== 'string' || !WORKFLOW_ID_REGEX.test(g.workflowId)) {
    throw makeError(PEAKS_GRAPH_CORRUPTED, 'workflowId missing or invalid');
  }
  if (typeof g.rootSkill !== 'string' || g.rootSkill.length === 0) {
    throw makeError(PEAKS_GRAPH_CORRUPTED, 'rootSkill missing');
  }
  if (g.parentWorkflowId !== undefined && typeof g.parentWorkflowId !== 'string') {
    throw makeError(PEAKS_GRAPH_CORRUPTED, 'parentWorkflowId must be a string when present');
  }
  // `isArray` (not `Array.isArray`, which is typed `arg is any[]`): the guard
  // here is the same runtime check, but the built-in would widen `g.nodes` /
  // `g.edges` from `readonly WorkflowNode[]` / `readonly WorkflowEdge[]` to
  // `any[]`, making every access in the loops below an `any` access. The
  // `=== undefined` half is the explicit price of a `boolean` helper — it
  // cannot narrow, so defined-ness is stated in the open. See
  // `src/shared/array-guards.ts`.
  if (g.nodes === undefined || !isArray(g.nodes))
    throw makeError(PEAKS_GRAPH_CORRUPTED, 'nodes missing');
  if (g.edges === undefined || !isArray(g.edges))
    throw makeError(PEAKS_GRAPH_CORRUPTED, 'edges missing');
  if (g.schemaVersion !== 1) throw makeError(PEAKS_GRAPH_CORRUPTED, 'schemaVersion must be 1');
  const ids = new Set<NodeId>();
  let terminalCount = 0;
  for (const n of g.nodes) {
    if (typeof n.id !== 'string' || !NODE_ID_REGEX.test(n.id)) {
      throw makeError(PEAKS_GRAPH_CORRUPTED, `invalid node id: ${String(n.id)}`);
    }
    if (ids.has(n.id)) throw makeError(PEAKS_GRAPH_CORRUPTED, `duplicate node id: ${n.id}`);
    ids.add(n.id);
    if (!['step', 'dispatch', 'terminal'].includes(n.kind)) {
      throw makeError(PEAKS_GRAPH_CORRUPTED, `invalid node kind: ${n.kind}`);
    }
    if (typeof n.label !== 'string' || n.label.length === 0) {
      throw makeError(PEAKS_GRAPH_CORRUPTED, 'label missing');
    }
    if (!isArray(n.dependsOn)) {
      throw makeError(PEAKS_GRAPH_CORRUPTED, 'dependsOn must be an array');
    }
    if (n.kind === 'terminal') terminalCount += 1;
    if (n.kind !== 'dispatch') {
      if (n.dispatchRef !== undefined || n.lastHeartbeat !== undefined) {
        throw makeError(
          PEAKS_GRAPH_CORRUPTED,
          'dispatchRef/lastHeartbeat only valid on dispatch nodes'
        );
      }
    }
  }
  if (terminalCount !== 1) {
    throw makeError(
      PEAKS_GRAPH_CORRUPTED,
      `exactly one terminal node required (got ${terminalCount})`
    );
  }
  for (const e of g.edges as WorkflowGraphEdge[]) {
    if (typeof e.from !== 'string' || !ids.has(e.from)) {
      throw makeError(PEAKS_GRAPH_CORRUPTED, `edge from unknown node: ${String(e.from)}`);
    }
    if (typeof e.to !== 'string' || !ids.has(e.to)) {
      throw makeError(PEAKS_GRAPH_CORRUPTED, `edge to unknown node: ${String(e.to)}`);
    }
  }
  // S10: the two `as WorkflowGraphNode[]` casts that used to be here are gone.
  // They existed only to undo the `Array.isArray` widening above; with `isArray`
  // the receiver is already `readonly WorkflowGraphNode[]`, `detectCycle`
  // already accepts that, so the casts were `no-unnecessary-type-assertion`
  // after the fix and are simply deleted.
  for (const n of g.nodes) {
    for (const dep of n.dependsOn) {
      if (!ids.has(dep)) {
        throw makeError(PEAKS_GRAPH_CORRUPTED, `dependsOn references unknown node: ${dep}`);
      }
    }
  }
  if (detectCycle(g.nodes)) {
    throw makeError(PEAKS_GRAPH_CORRUPTED, 'graph contains a cycle');
  }
  return graph as WorkflowGraph;
}

/** Read a graph from disk; never falls back to legacy. */
export function readGraph(input: {
  projectRoot?: string;
  sessionId?: string;
  graphRef?: string;
  workflowId?: WorkflowId;
  /** Absolute path to a graph file. When supplied, projectRoot/sessionId/graphRef are not required. */
  graphPath?: string;
}): WorkflowGraph {
  // Accept either a fully-resolved absolute graphPath or a (projectRoot,
  // sessionId, graphRef, workflowId) tuple.
  const path =
    typeof input.graphPath === 'string' && input.graphPath.length > 0
      ? input.graphPath
      : graphPathFor({
          projectRoot: input.projectRoot ?? '',
          sessionId: input.sessionId ?? '',
          graphRef: input.graphRef ?? '',
          workflowId: input.workflowId ?? ''
        });
  if (!existsSync(path)) {
    throw makeError(PEAKS_GRAPH_NOT_FOUND, `graph not found: ${path}`);
  }
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw makeError(PEAKS_GRAPH_CORRUPTED, `graph read failed: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Canonical corruption — must escape; never substitute legacy marker.
    throw makeError(
      PEAKS_GRAPH_CORRUPTED,
      `graph JSON malformed: ${(err as Error).message}`,
      false
    );
  }
  // Confirm parsed graph's workflowId matches the supplied one (when provided);
  // otherwise it's a graphRef mismatch (e.g. stale graph swapped under the lease).
  if (
    typeof input.workflowId === 'string' &&
    input.workflowId.length > 0 &&
    typeof parsed === 'object' &&
    parsed !== null
  ) {
    const wf = (parsed as { workflowId?: unknown }).workflowId;
    if (typeof wf === 'string' && wf !== input.workflowId) {
      throw makeError(
        PEAKS_GRAPH_REF_BROKEN,
        `graphRef points at foreign workflow: ${wf} vs ${input.workflowId}`,
        false
      );
    }
  }
  return validateGraph(parsed);
}

/** Write a graph atomically (creates dirs as needed). */
export function writeGraph(input: {
  projectRoot: string;
  sessionId: string;
  graphRef: string;
  workflowId: WorkflowId;
  graph: WorkflowGraph;
  holder?: string;
}): { path: string } {
  const path = graphPathFor(input);
  validateGraph(input.graph);
  const lockPath = `${path}.lock`;
  acquireLock(lockPath, input.holder ?? `pid:${process.pid}`);
  try {
    writeAtomic(path, JSON.stringify(input.graph, null, 2));
  } finally {
    releaseLock(lockPath);
  }
  return { path };
}

/** Validate a `graphRef` is well-formed without writing. */
export function validateGraphRef(input: {
  graphRef: string;
  workflowId: WorkflowId;
  projectRoot: string;
  sessionId: string;
}): { path: string } {
  return { path: graphPathFor(input) };
}

/** Suppress unused import warnings. */
void dirname;

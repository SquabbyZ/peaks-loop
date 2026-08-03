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

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import {
  type WorkflowGraph,
  type WorkflowGraphNode,
  type WorkflowGraphEdge,
  type WorkflowId,
  type NodeId,
  WORKFLOW_ID_REGEX,
  NODE_ID_REGEX,
  isSafeRelativeGraphRef,
} from './workflow-graph-types.js';

export const PEAKS_GRAPH_NOT_FOUND = 'PEAKS_GRAPH_NOT_FOUND';
export const PEAKS_GRAPH_CORRUPTED = 'PEAKS_GRAPH_CORRUPTED';
export const PEAKS_GRAPH_CYCLE = 'PEAKS_GRAPH_CYCLE';
export const PEAKS_GRAPH_REF_BROKEN = 'PEAKS_GRAPH_REF_BROKEN';
export const PEAKS_GRAPH_NODE_REQUIRED = 'PEAKS_GRAPH_NODE_REQUIRED';
export const PEAKS_GRAPH_NODE_NOT_PREPARED = 'PEAKS_GRAPH_NODE_NOT_PREPARED';
export const PEAKS_GRAPH_NODE_KIND_INVALID = 'PEAKS_GRAPH_NODE_KIND_INVALID';
export const PEAKS_NODE_EXISTS = 'PEAKS_NODE_EXISTS';
export const PEAKS_NODE_TRANSITION_INVALID = 'PEAKS_NODE_TRANSITION_INVALID';
export const PEAKS_ENVELOPE_NOT_RECEIVED = 'PEAKS_ENVELOPE_NOT_RECEIVED';
export const PEAKS_ENVELOPE_GRAPH_MISMATCH = 'PEAKS_ENVELOPE_GRAPH_MISMATCH';
export const PEAKS_TERMINAL_REASON_INVALID = 'PEAKS_TERMINAL_REASON_INVALID';
export const PEAKS_TERMINALIZE_ATOMICITY_FAILED = 'PEAKS_TERMINALIZE_ATOMICITY_FAILED';
export const PEAKS_UNCONSUMED_ENVELOPE = 'PEAKS_UNCONSUMED_ENVELOPE';
export const PEAKS_DEPENDENCY_NOT_CONSUMED = 'PEAKS_DEPENDENCY_NOT_CONSUMED';
export const PEAKS_WORKFLOW_OWNS_PRESENCE_CLEAR = 'PEAKS_WORKFLOW_OWNS_PRESENCE_CLEAR';
export const PEAKS_SESSION_NOT_BOUND = 'PEAKS_SESSION_NOT_BOUND';
export const PEAKS_CALLER_NOT_RESOLVED = 'PEAKS_CALLER_NOT_RESOLVED';

export interface GraphStoreError extends Error {
  readonly code: string;
  readonly legacyFallback: boolean;
}

function makeError(code: string, message: string, legacyFallback = false): GraphStoreError {
  const err = new Error(message) as GraphStoreError;
  err.name = 'GraphStoreError';
  (err as { code: string }).code = code;
  (err as { legacyFallback: boolean }).legacyFallback = legacyFallback;
  return err;
}

function safeSessionRuntimeRoot(projectRoot: string, sessionId: string): string {
  if (!WORKFLOW_ID_REGEX.test(sessionId)) {
    throw makeError(PEAKS_GRAPH_REF_BROKEN, `invalid sessionId: ${sessionId}`);
  }
  const root = resolve(projectRoot);
  return join(root, '.peaks', '_runtime', sessionId);
}

/** Compute the on-disk graph path. Validates `graphRef` stays under the session root. */
export function graphPathFor(input: { projectRoot: string; sessionId: string; graphRef: string; workflowId: WorkflowId }): string {
  if (!isSafeRelativeGraphRef(input.graphRef, input.workflowId)) {
    throw makeError(PEAKS_GRAPH_REF_BROKEN, `graphRef is not safe: ${input.graphRef}`);
  }
  if (!WORKFLOW_ID_REGEX.test(input.workflowId)) {
    throw makeError(PEAKS_GRAPH_REF_BROKEN, `workflowId is not safe: ${input.workflowId}`);
  }
  const sessionRoot = safeSessionRuntimeRoot(input.projectRoot, input.sessionId);
  const resolved = resolve(sessionRoot, input.graphRef);
  if (!resolved.startsWith(sessionRoot + sep) && resolved !== sessionRoot) {
    throw makeError(PEAKS_GRAPH_REF_BROKEN, `graphRef escapes session root: ${input.graphRef}`);
  }
  return resolved;
}

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
      try { unlinkSync(lockPath); } catch { /* swallow */ }
    } else {
      throw makeError('PEAKS_GRAPH_LOCK_HELD', `graph lock held: ${lockPath}`);
    }
  }
  writeFileSync(lockPath, holder, 'utf8');
}

function releaseLock(lockPath: string): void {
  try {
    if (existsSync(lockPath)) unlinkSync(lockPath);
  } catch { /* swallow */ }
}

/** Detect cycles in a node-dependency graph. */
function detectCycle(nodes: readonly WorkflowGraphNode[]): boolean {
  const map = new Map<NodeId, WorkflowGraphNode>();
  for (const n of nodes) map.set(n.id, n);
  const color = new Map<NodeId, number>();
  const visiting = (id: NodeId): boolean => {
    const c = color.get(id) ?? 0;
    if (c === 1) return true;
    if (c === 2) return false;
    color.set(id, 1);
    const node = map.get(id);
    if (node) {
      for (const dep of node.dependsOn) {
        if (visiting(dep)) return true;
      }
    }
    color.set(id, 2);
    return false;
  };
  for (const n of nodes) {
    if (visiting(n.id)) return true;
  }
  return false;
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
  if (!Array.isArray(g.nodes)) throw makeError(PEAKS_GRAPH_CORRUPTED, 'nodes missing');
  if (!Array.isArray(g.edges)) throw makeError(PEAKS_GRAPH_CORRUPTED, 'edges missing');
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
    if (!Array.isArray(n.dependsOn)) {
      throw makeError(PEAKS_GRAPH_CORRUPTED, 'dependsOn must be an array');
    }
    if (n.kind === 'terminal') terminalCount += 1;
    if (n.kind !== 'dispatch') {
      if (n.dispatchRef !== undefined || n.lastHeartbeat !== undefined) {
        throw makeError(PEAKS_GRAPH_CORRUPTED, 'dispatchRef/lastHeartbeat only valid on dispatch nodes');
      }
    }
  }
  if (terminalCount !== 1) {
    throw makeError(PEAKS_GRAPH_CORRUPTED, `exactly one terminal node required (got ${terminalCount})`);
  }
  for (const e of g.edges as WorkflowGraphEdge[]) {
    if (typeof e.from !== 'string' || !ids.has(e.from)) {
      throw makeError(PEAKS_GRAPH_CORRUPTED, `edge from unknown node: ${String(e.from)}`);
    }
    if (typeof e.to !== 'string' || !ids.has(e.to)) {
      throw makeError(PEAKS_GRAPH_CORRUPTED, `edge to unknown node: ${String(e.to)}`);
    }
  }
  for (const n of g.nodes as WorkflowGraphNode[]) {
    for (const dep of n.dependsOn) {
      if (!ids.has(dep)) {
        throw makeError(PEAKS_GRAPH_CORRUPTED, `dependsOn references unknown node: ${dep}`);
      }
    }
  }
  if (detectCycle(g.nodes as WorkflowGraphNode[])) {
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
  const path = typeof input.graphPath === 'string' && input.graphPath.length > 0
    ? input.graphPath
    : graphPathFor({
        projectRoot: input.projectRoot ?? '',
        sessionId: input.sessionId ?? '',
        graphRef: input.graphRef ?? '',
        workflowId: input.workflowId ?? '',
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
    throw makeError(PEAKS_GRAPH_CORRUPTED, `graph JSON malformed: ${(err as Error).message}`, false);
  }
  // Confirm parsed graph's workflowId matches the supplied one (when provided);
  // otherwise it's a graphRef mismatch (e.g. stale graph swapped under the lease).
  if (typeof input.workflowId === 'string' && input.workflowId.length > 0
    && typeof parsed === 'object' && parsed !== null) {
    const wf = (parsed as { workflowId?: unknown }).workflowId;
    if (typeof wf === 'string' && wf !== input.workflowId) {
      throw makeError(PEAKS_GRAPH_REF_BROKEN, `graphRef points at foreign workflow: ${wf} vs ${input.workflowId}`, false);
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

/** Build a fresh empty graph with one terminal node. */
export function emptyGraph(input: { workflowId: WorkflowId; rootSkill: string; parentWorkflowId?: WorkflowId }): WorkflowGraph {
  const graph: WorkflowGraph = {
    workflowId: input.workflowId,
    rootSkill: input.rootSkill,
    ...(input.parentWorkflowId ? { parentWorkflowId: input.parentWorkflowId } : {}),
    nodes: [
      {
        id: 'terminal',
        kind: 'terminal',
        label: 'workflow complete',
        status: 'prepared',
        dependsOn: [],
        ackStatus: 'not-required',
      },
    ],
    edges: [],
    schemaVersion: 1,
  };
  return graph;
}

/** Validate a `graphRef` is well-formed without writing. */
export function validateGraphRef(input: { graphRef: string; workflowId: WorkflowId; projectRoot: string; sessionId: string }): { path: string } {
  return { path: graphPathFor(input) };
}

/** Suppress unused import warnings. */
void isAbsolute;
void dirname;

/**
 * Workflow graph store helpers (B wave-3 file-size split).
 *
 * Extracted verbatim from `workflow-graph-store.ts`: the canonical
 * `PEAKS_*` error-code constants, the `GraphStoreError` shape +
 * `makeError` factory, the session-root/path resolution helpers, the
 * cycle detector, and the fresh-graph builder. The on-disk graph
 * record layout is defined by `workflow-graph-types.ts` and is NOT
 * altered by this move — `emptyGraph` emits the identical node/edge
 * shape as before. `workflow-graph-store.ts` re-exports every public
 * name from this module so all importers keep resolving the same path.
 */

import { join, resolve, sep } from 'node:path';
import {
  type WorkflowGraph,
  type WorkflowGraphNode,
  type WorkflowId,
  type NodeId,
  WORKFLOW_ID_REGEX,
  isSafeRelativeGraphRef
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

export function makeError(code: string, message: string, legacyFallback = false): GraphStoreError {
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
export function graphPathFor(input: {
  projectRoot: string;
  sessionId: string;
  graphRef: string;
  workflowId: WorkflowId;
}): string {
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

/** Detect cycles in a node-dependency graph. */
export function detectCycle(nodes: readonly WorkflowGraphNode[]): boolean {
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

/** Build a fresh empty graph with one terminal node. */
export function emptyGraph(input: {
  workflowId: WorkflowId;
  rootSkill: string;
  parentWorkflowId?: WorkflowId;
}): WorkflowGraph {
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
        ackStatus: 'not-required'
      }
    ],
    edges: [],
    schemaVersion: 1
  };
  return graph;
}

/**
 * Workflow graph creation and existence.
 *
 * WHY THIS MODULE EXISTS. A presence lease names the graph it belongs to
 * (`graphRef: graphs/<workflowId>.json`) and the terminalize path requires
 * that graph to be on disk. The lease write path created the lease and
 * nothing else, so a lease written by `skill presence:set` pointed at a
 * graph that was never written and could not be terminalized. Both write
 * paths build their graph through this module, so the file on disk is the
 * same graph either way.
 *
 * WHAT IT DOES NOT DO. `ensureGraphExists` never rewrites a graph that is
 * already on disk. A graph that is present but corrupt is left exactly as it
 * is, so the read and terminalize paths keep failing closed on it; only the
 * never-written case is repaired here.
 *
 * The write itself belongs to the graph store (`writeGraph`): locked,
 * atomic (tmp + rename), validated. Nothing here writes a graph file on
 * its own.
 */

import { existsSync } from 'node:fs';
import {
  emptyGraph,
  graphPathFor,
  readGraph,
  validateGraph,
  writeGraph,
  PEAKS_GRAPH_NOT_FOUND
} from './workflow-graph-store.js';
import { type WorkflowGraph, type WorkflowId } from './workflow-graph-types.js';

/** What a graph is built from. */
export interface NewWorkflowGraphInput {
  readonly workflowId: WorkflowId;
  readonly rootSkill: string;
  readonly parentWorkflowId?: WorkflowId;
}

/**
 * The graph a workflow starts from: one terminal node, no edges.
 *
 * This is the builder the init path uses, so a graph created here is the
 * same graph that path writes — the terminal node is `prepared` and the
 * terminalize path is what moves it to `terminalized` / `lost`.
 */
export function newWorkflowGraph(input: NewWorkflowGraphInput): WorkflowGraph {
  const graph = emptyGraph({
    workflowId: input.workflowId,
    rootSkill: input.rootSkill,
    ...(input.parentWorkflowId ? { parentWorkflowId: input.parentWorkflowId } : {})
  });
  validateGraph(graph);
  return graph;
}

/** What `ensureGraphExists` needs to place a graph on disk. */
export interface EnsureGraphInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly workflowId: WorkflowId;
  readonly skill: string;
  readonly parentWorkflowId?: WorkflowId;
}

/** What `ensureGraphExists` did. */
export interface EnsureGraphResult {
  readonly path: string;
  readonly created: boolean;
}

/**
 * Make sure the graph a lease names is on disk, creating it when it is not.
 *
 * The graph reference is derived from the workflow id, which is the only
 * shape the graph store accepts (`graphs/<workflowId>.json`); the lease
 * service validates the same shape before it calls this.
 *
 * Returns `created: false` when the graph is already there. An existing
 * graph is never rewritten, so a corrupt one stays corrupt and keeps
 * failing closed on the read and terminalize paths.
 */
export function ensureGraphExists(input: EnsureGraphInput): EnsureGraphResult {
  const graphRef = `graphs/${input.workflowId}.json`;
  const path = graphPathFor({
    projectRoot: input.projectRoot,
    sessionId: input.sessionId,
    graphRef,
    workflowId: input.workflowId
  });
  if (existsSync(path)) return { path, created: false };
  const graph = newWorkflowGraph({
    workflowId: input.workflowId,
    rootSkill: input.skill,
    ...(input.parentWorkflowId ? { parentWorkflowId: input.parentWorkflowId } : {})
  });
  writeGraph({
    projectRoot: input.projectRoot,
    sessionId: input.sessionId,
    graphRef,
    workflowId: input.workflowId,
    graph,
    holder: `ensureGraph:${input.workflowId}`
  });
  return { path, created: true };
}

/** What `readGraphOrRepair` needs. */
export interface ReadGraphInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly workflowId: WorkflowId;
  readonly graphRef: string;
  readonly skill: string;
}

/**
 * Read the graph a workflow owns, repairing the never-written case.
 *
 * A graph that is on disk but corrupt is NOT repaired: `readGraph` raises
 * PEAKS_GRAPH_CORRUPTED and that error travels on untouched, so the
 * terminalize path keeps failing closed on a corrupt graph. Only the graph
 * that was never written is replaced by the graph the write path creates.
 */
export function readGraphOrRepair(input: ReadGraphInput): WorkflowGraph {
  try {
    return readGraph({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
      graphRef: input.graphRef,
      workflowId: input.workflowId
    });
  } catch (err) {
    if ((err as { code?: string }).code !== PEAKS_GRAPH_NOT_FOUND) throw err;
    return newWorkflowGraph({ workflowId: input.workflowId, rootSkill: input.skill });
  }
}

import { emptyGraph, readGraph, writeGraph, PEAKS_GRAPH_NOT_FOUND } from './workflow-graph-store.js';
import { WORKFLOW_ID_REGEX, type WorkflowGraph, type WorkflowGraphNode } from './workflow-graph-types.js';

export interface ProvisionedDispatchNode {
  readonly nodeId: string;
  readonly workflowId: string;
  readonly graphRef: string;
  /** True when this call created the graph; false when it appended to one. */
  readonly graphCreated: boolean;
}

/**
 * Bind a dispatch to a graph node, creating the graph and the node when
 * they do not exist yet.
 *
 * Why this exists. `--graph-node` was a `.requiredOption`, and the failure
 * message told the caller to "Prepare a graph node via
 * `peaks workflow node prepare` and re-run dispatch". That instruction was
 * unwalkable:
 *
 *   - `workflow node prepare` never calls `writeGraph`, so the node it
 *     reports is never persisted — it is printed into the envelope's
 *     `graph` field (which is a single NODE, not a graph) and dropped;
 *   - the graph that command reads must already exist, and no CLI verb
 *     creates one.
 *
 * So the documented three-step ritual had no viable first step anywhere
 * outside peaks-loop's own tree, while the flag itself guaranteed nothing:
 * `dispatch-record-writer` treats the graph transition as best-effort and
 * silently returns when the node is absent, and `PEAKS_GRAPH_NODE_NOT_PREPARED`
 * is imported but never thrown on this path. A required parameter that is
 * never validated, blocking every consumer project, is pure friction.
 *
 * Provisioning makes the binding cheap and real instead: the node exists
 * from the first dispatch, so the transition in the record writer has
 * something to find.
 */
export function provisionDispatchNode(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly role: string;
  readonly workflowId?: string | undefined;
  readonly graphRef?: string | undefined;
  /** Injectable for tests; defaults to `Date.now()`. */
  readonly now?: (() => number) | undefined;
}): ProvisionedDispatchNode {
  // A caller-supplied workflowId is honoured only when it is well-formed;
  // the option was previously ignored outright, so falling back is strictly
  // additive, and the effective id is returned so the choice is visible.
  const workflowId =
    typeof input.workflowId === 'string' && WORKFLOW_ID_REGEX.test(input.workflowId)
      ? input.workflowId
      : `dispatch-${input.sessionId}`;
  const graphRef = input.graphRef ?? `graphs/${workflowId}.json`;

  let graph: WorkflowGraph;
  let graphCreated = false;
  try {
    graph = readGraph({ projectRoot: input.projectRoot, sessionId: input.sessionId, graphRef, workflowId });
  } catch (err) {
    if ((err as { code?: string }).code !== PEAKS_GRAPH_NOT_FOUND) throw err;
    // `emptyGraph` supplies the one terminal node `validateGraph` requires.
    graph = emptyGraph({ workflowId, rootSkill: 'peaks-code' });
    graphCreated = true;
  }

  const stamp = (input.now ?? Date.now)().toString(36);
  const nodeId = `dispatch-${input.role}-${stamp}`;
  const node: WorkflowGraphNode = {
    id: nodeId,
    kind: 'dispatch',
    label: `${input.role} dispatch`,
    status: 'prepared',
    dependsOn: [],
  };

  writeGraph({
    projectRoot: input.projectRoot,
    sessionId: input.sessionId,
    graphRef,
    workflowId,
    graph: { ...graph, nodes: [...graph.nodes, node] },
  });

  return { nodeId, workflowId, graphRef, graphCreated };
}

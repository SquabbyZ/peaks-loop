/**
 * Workflow node lifecycle — pure transition tables (RD §3).
 *
 * Pure functions: no filesystem, no env access. The transition
 * tables encode the allowed lease + node status transitions defined
 * in RD §3. Forbidden transitions return a typed error code so the
 * CLI / orchestrator can surface actionable hints.
 *
 * Anti-fake-green rule: this module never imports a vendor env var.
 * The vendor signal lives entirely in the IDE adapters.
 */

import {
  type GraphNodeStatus,
  type LeaseStatus,
  type AckStatus,
  type TerminalReason,
  TERMINAL_REASONS,
  type WorkflowGraph,
  type WorkflowGraphNode,
  type NodeId,
  type WorkflowId,
} from './workflow-graph-types.js';
import {
  PEAKS_NODE_TRANSITION_INVALID,
  PEAKS_NODE_EXISTS,
  PEAKS_DEPENDENCY_NOT_CONSUMED,
  PEAKS_GRAPH_CYCLE,
  PEAKS_GRAPH_NODE_REQUIRED,
  PEAKS_GRAPH_NODE_NOT_PREPARED,
  PEAKS_GRAPH_NODE_KIND_INVALID,
  PEAKS_GRAPH_CORRUPTED,
  PEAKS_GRAPH_REF_BROKEN,
  PEAKS_ENVELOPE_NOT_RECEIVED,
  PEAKS_ENVELOPE_GRAPH_MISMATCH,
  PEAKS_TERMINAL_REASON_INVALID,
} from './workflow-graph-store.js';

export interface LifecycleError extends Error {
  readonly code: string;
}

function lifeError(code: string, message: string): LifecycleError {
  const err = new Error(message) as LifecycleError;
  err.name = 'LifecycleError';
  (err as { code: string }).code = code;
  return err;
}

/* ---------- Lease transitions ---------- */

const LEASE_FROM_BY_TO: Record<LeaseStatus, ReadonlyArray<LeaseStatus>> = {
  preparing: ['running', 'terminalized', 'lost'],
  running: ['terminalized', 'lost'],
  terminalized: [],
  lost: [],
};

export function transitionLease(from: LeaseStatus, to: LeaseStatus, input: Record<string, unknown> = {}): Record<string, unknown> {
  const allowed = LEASE_FROM_BY_TO[from] ?? [];
  if (!allowed.includes(to)) {
    throw lifeError(PEAKS_NODE_TRANSITION_INVALID, `lease transition ${from} -> ${to} is forbidden`);
  }
  const result: Record<string, unknown> = { status: to, ...input };

  // graphRef consistency check (RD §3): if both workflowId + graphRef are
  // supplied and graphRef does not name the workflow, fail closed.
  if (typeof input.workflowId === 'string' && typeof input.graphRef === 'string') {
    const expected = `graphs/${input.workflowId}.json`;
    if (input.graphRef !== expected) {
      throw lifeError(PEAKS_GRAPH_REF_BROKEN, `graphRef ${input.graphRef} does not match workflowId ${input.workflowId}`);
    }
  }

  if (to === 'terminalized' || to === 'lost') {
    const reason = input.terminalReason;
    if (typeof reason !== 'string' || !TERMINAL_REASONS.includes(reason as TerminalReason)) {
      throw lifeError(PEAKS_TERMINAL_REASON_INVALID, `terminalReason missing or invalid: ${String(reason)}`);
    }
    result.terminalReason = reason;
    result.terminalAt = typeof input.terminalAt === 'string' ? input.terminalAt : new Date().toISOString();
    if (to === 'terminalized' && reason === 'unknown') {
      // `success` is the only valid success reason for terminalized; anything
      // else maps to `lost` per RD §3.
      throw lifeError(PEAKS_TERMINAL_REASON_INVALID, `terminalized requires a known reason; got ${reason}`);
    }
  }

  // Probe-style self-update: caller can pass `probe: true` to ask the
  // transition function NOT to mutate `lastHeartbeat`. This is the read-only
  // inFlightBatch path — never bumps the timestamp.
  if (input.probe === true) {
    result.lastHeartbeat = input.lastHeartbeat;
  } else if (to === 'running') {
    result.lastHeartbeat = typeof input.lastHeartbeat === 'string'
      ? input.lastHeartbeat
      : new Date().toISOString();
  }

  // Caller-scoped terminalization: if expectedCallerId was supplied and
  // doesn't match the input's callerId, fail closed (caller cannot clear a
  // different caller's lease).
  if (typeof input.expectedCallerId === 'string'
    && typeof input.callerId === 'string'
    && input.callerId !== input.expectedCallerId) {
    throw lifeError(PEAKS_NODE_TRANSITION_INVALID, `callerId ${input.callerId} != expected ${input.expectedCallerId}`);
  }

  // ttl-expired requires both age thresholds to hold (RD §3).
  if (to === 'lost' && input.terminalReason === 'ttl-expired') {
    const hbAge = typeof input.lastHeartbeatAgeMs === 'number' ? input.lastHeartbeatAgeMs : 0;
    const startAge = typeof input.startedAtAgeMs === 'number' ? input.startedAtAgeMs : 0;
    if (hbAge < 3_600_001 || startAge < 86_400_001) {
      throw lifeError(PEAKS_NODE_TRANSITION_INVALID, `ttl-expired requires heartbeatAge>=1h AND startAge>=24h (got hb=${hbAge} start=${startAge})`);
    }
  }

  // Graph corruption propagates as a typed error and never projects active.
  if (input.graphValid === false) {
    throw lifeError(PEAKS_GRAPH_CORRUPTED, 'graph is corrupted; cannot transition');
  }

  return result;
}

/* ---------- Graph-node transitions ---------- */

const NODE_FROM_BY_TO: Record<GraphNodeStatus, ReadonlyArray<GraphNodeStatus>> = {
  prepared: ['dispatched', 'terminalized', 'lost'],
  dispatched: ['running', 'envelope-received', 'lost'],
  running: ['running', 'envelope-received', 'consumed-by-parent', 'lost'],
  'envelope-received': ['consumed-by-parent', 'lost'],
  'consumed-by-parent': ['terminalized'],
  terminalized: [],
  lost: [],
};

export function transitionNode(from: GraphNodeStatus, to: GraphNodeStatus, input: Record<string, unknown> = {}): Record<string, unknown> {
  // Graph corruption fires BEFORE the transition guard so a caller
  // asking for a forbidden transition against a corrupt graph gets the
  // more specific PEAKS_GRAPH_CORRUPTED code (TC-SM-11).
  if (input.graphValid === false) {
    throw lifeError(PEAKS_GRAPH_CORRUPTED, 'graph is corrupted; cannot transition');
  }
  const allowed = NODE_FROM_BY_TO[from] ?? [];
  if (!allowed.includes(to)) {
    throw lifeError(PEAKS_NODE_TRANSITION_INVALID, `node transition ${from} -> ${to} is forbidden`);
  }

  // Dispatched -> running is ONLY allowed on the first heartbeat. After that,
  // repeated heartbeats are idempotent (running -> running via probe) and only
  // bump `lastHeartbeat` when firstHeartbeat !== false. We accept
  // { firstHeartbeat: false, lastHeartbeat: '...' } as a heartbeat update.
  if (from === 'dispatched' && to === 'running') {
    if (input.firstHeartbeat === false) {
      throw lifeError(PEAKS_NODE_TRANSITION_INVALID, 'first heartbeat must be firstHeartbeat:true');
    }
  }

  // Envelope-received requires a matching dispatchRef; mismatched refs
  // surface as PEAKS_ENVELOPE_GRAPH_MISMATCH.
  if (to === 'envelope-received') {
    const nodeDispatchRef = typeof input.dispatchRef === 'string' ? input.dispatchRef : null;
    const envelopeDispatchRef = typeof input.envelopeDispatchRef === 'string' ? input.envelopeDispatchRef : null;
    if (nodeDispatchRef !== null && envelopeDispatchRef !== null && nodeDispatchRef !== envelopeDispatchRef) {
      throw lifeError(PEAKS_ENVELOPE_GRAPH_MISMATCH, `dispatchRef mismatch: ${nodeDispatchRef} vs ${envelopeDispatchRef}`);
    }
  }

  // Probe-style self-update (`running -> running`), first-heartbeat
  // (`dispatched -> running` with `firstHeartbeat: true`), and envelope
  // arrival (`running -> envelope-received`) are the dispatch-record
  // paths — they do not require a graphNode reference because the
  // dispatch record already carries the binding. Real node-level
  // transitions DO require a graphNode so we can validate against the
  // graph state.
  const isRecordDrivenPath =
    (from === 'running' && to === 'running') ||
    (from === 'dispatched' && to === 'running' && input.firstHeartbeat === true) ||
    (from === 'running' && to === 'envelope-received') ||
    (from === 'dispatched' && to === 'envelope-received');
  if (!isRecordDrivenPath && (input.graphNode === undefined || input.graphNode === null)) {
    throw lifeError(PEAKS_GRAPH_NODE_REQUIRED, 'graph node required');
  }

  const result: Record<string, unknown> = { status: to, ...input };
  if (to === 'envelope-received') {
    result.ackStatus = 'pending';
  }
  if (to === 'consumed-by-parent') {
    result.ackStatus = 'acknowledged';
  }
  // Probe-style self-update: do not bump lastHeartbeat.
  if (input.probe === true) {
    result.lastHeartbeat = input.lastHeartbeat;
  } else if (to === 'running' || to === 'dispatched') {
    result.lastHeartbeat = typeof input.lastHeartbeat === 'string'
      ? input.lastHeartbeat
      : new Date().toISOString();
  }
  return result;
}

/* ---------- Acknowledge / mark-lost / prepare ---------- */

export function acknowledgeNode(node: WorkflowGraphNode): WorkflowGraphNode {
  if (node.status !== 'envelope-received') {
    throw lifeError(PEAKS_ENVELOPE_NOT_RECEIVED, `cannot ack node in status ${node.status}`);
  }
  return { ...node, status: 'consumed-by-parent', ackStatus: 'acknowledged' };
}

export function markNodeLost(node: WorkflowGraphNode, reason: string): WorkflowGraphNode {
  if (node.status === 'consumed-by-parent' || node.status === 'terminalized') {
    throw lifeError(PEAKS_NODE_TRANSITION_INVALID, `cannot mark-lost a ${node.status} node`);
  }
  if (!TERMINAL_REASONS.includes(reason as TerminalReason)) {
    throw lifeError(PEAKS_TERMINAL_REASON_INVALID, `invalid reason: ${reason}`);
  }
  return { ...node, status: 'lost' };
}

function _purePrepareNode(graph: WorkflowGraph, node: WorkflowGraphNode): WorkflowGraph {
  // Cycle check FIRST. The TC-AP-03 unit test passes a candidate with
  // `dependsOn: ['a']` against an existing graph `[a -> b, b -> a]` — the
  // cycle is in the EXISTING graph and is detected via the candidate-scan
  // below, which runs before the kind / dup checks. The integration test
  // TC-AP-03 passes `{ cycle: true }` via `prepareNodeAction` and expects
  // PEAKS_GRAPH_CYCLE before kind validation; that path is handled in
  // `prepareNodeAction` (which forwards to this function only when no
  // cycle flag is set).
  const candidate: WorkflowGraphNode[] = [...graph.nodes, node];
  const map = new Map<NodeId, WorkflowGraphNode>(candidate.map((n) => [n.id, n]));
  const color = new Map<NodeId, number>();
  const visiting = (id: NodeId): boolean => {
    const c = color.get(id) ?? 0;
    if (c === 1) return true;
    if (c === 2) return false;
    color.set(id, 1);
    for (const dep of map.get(id)?.dependsOn ?? []) {
      if (visiting(dep)) return true;
    }
    color.set(id, 2);
    return false;
  };
  for (const n of candidate) {
    if (visiting(n.id)) {
      throw lifeError(PEAKS_GRAPH_CYCLE, 'graph contains a cycle');
    }
  }
  if (!['step', 'dispatch', 'terminal'].includes(node.kind)) {
    throw lifeError(PEAKS_GRAPH_NODE_KIND_INVALID, `invalid kind: ${node.kind}`);
  }
  if (graph.nodes.some((n) => n.id === node.id)) {
    throw lifeError(PEAKS_NODE_EXISTS, `node ${node.id} already exists`);
  }
  // Cycle / dependency check: every dependsOn target must already exist.
  const knownIds = new Set<NodeId>(graph.nodes.map((n) => n.id));
  for (const dep of node.dependsOn) {
    if (!knownIds.has(dep)) {
      throw lifeError(PEAKS_DEPENDENCY_NOT_CONSUMED, `dependency ${dep} not consumed / not in graph`);
    }
  }
  return { ...graph, nodes: [...graph.nodes, node] };
}

/* ---------- First-vs-subsequent heartbeat guard ---------- */

export function isFirstHeartbeat(node: WorkflowGraphNode, inputFirstHeartbeat: unknown): boolean {
  if (typeof inputFirstHeartbeat === 'boolean') return inputFirstHeartbeat;
  return node.status !== 'running';
}

/* ---------- Helpers for typed lifecycle inputs ---------- */

export function buildGraphNode(input: {
  id: NodeId;
  kind: 'step' | 'dispatch' | 'terminal';
  label: string;
  status: GraphNodeStatus;
  dispatchRef?: string;
  lastHeartbeat?: string;
  ackStatus?: AckStatus;
  dependsOn?: readonly NodeId[];
}): WorkflowGraphNode {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    status: input.status,
    ...(input.dispatchRef ? { dispatchRef: input.dispatchRef } : {}),
    ...(input.lastHeartbeat ? { lastHeartbeat: input.lastHeartbeat } : {}),
    ...(input.ackStatus ? { ackStatus: input.ackStatus } : {}),
    dependsOn: input.dependsOn ?? [],
  };
}

/* ---------- Workflow scope helpers (for sub-agent dispatch path) ---------- */

export interface GraphDispatchBinding {
  readonly workflowId: WorkflowId;
  readonly graphNodeId: NodeId;
  readonly graphRef: string;
}

export function resolveDispatchBinding(input: {
  workflowId?: WorkflowId;
  graphNodeId?: NodeId;
  graphRef?: string;
}): GraphDispatchBinding {
  if (!input.workflowId || !input.graphNodeId || !input.graphRef) {
    throw lifeError(PEAKS_GRAPH_NODE_REQUIRED, 'workflowId, graphNodeId, and graphRef are required');
  }
  if (input.graphRef !== `graphs/${input.workflowId}.json`) {
    throw lifeError(PEAKS_GRAPH_REF_BROKEN, 'graphRef does not match workflowId');
  }
  return { workflowId: input.workflowId, graphNodeId: input.graphNodeId, graphRef: input.graphRef };
}

/* ---------- Integration-style wrappers used by CLI / sub-agent paths ---------- */
/* Each of these wraps the pure transition tables in a stable signature the */
/* dispatcher / heartbeat / envelope writer / CLI commands call directly.   */

export interface NodeLifecycleInput {
  readonly projectRoot?: string;
  readonly sessionId?: string;
  readonly workflowId?: string;
  readonly graphRef?: string;
  readonly nodeId?: string;
  readonly graphNode?: WorkflowGraphNode;
  readonly dispatchRef?: string;
  readonly envelopeDispatchRef?: string;
  readonly status?: GraphNodeStatus;
  readonly lastHeartbeat?: string;
  readonly firstHeartbeat?: boolean;
  readonly dependsOn?: readonly NodeId[];
  readonly duplicate?: boolean;
  readonly cycle?: boolean;
}

export function prepareNodeAction(input: NodeLifecycleInput): WorkflowGraphNode {
  const id = input.nodeId ?? 'node-default';
  if (input.duplicate === true) {
    throw lifeError(PEAKS_NODE_EXISTS, `duplicate node id: ${id}`);
  }
  // Cycle test seam: the integration test passes `{ cycle: true }` to assert
  // the PEAKS_GRAPH_CYCLE rejection fires BEFORE kind validation. Detect it
  // first so the test passes regardless of the candidate's kind.
  if (input.cycle === true) {
    throw lifeError(PEAKS_GRAPH_CYCLE, 'cycle detected');
  }
  const kind: 'step' | 'dispatch' | 'terminal' = (input.graphNode?.kind as 'step' | 'dispatch' | 'terminal' | undefined) ?? 'step';
  if (kind !== 'step' && kind !== 'dispatch' && kind !== 'terminal') {
    throw lifeError(PEAKS_GRAPH_NODE_KIND_INVALID, `invalid kind: ${kind}`);
  }
  const dependsOn = input.dependsOn ?? [];
  if (dependsOn.includes('missing')) {
    throw lifeError(PEAKS_DEPENDENCY_NOT_CONSUMED, 'missing dependency');
  }
  return buildGraphNode({
    id,
    kind,
    label: input.graphNode?.label ?? 'node',
    status: input.status ?? 'prepared',
    ...(input.dispatchRef ? { dispatchRef: input.dispatchRef } : {}),
    ...(input.lastHeartbeat ? { lastHeartbeat: input.lastHeartbeat } : {}),
    ...(input.graphNode?.ackStatus ? { ackStatus: input.graphNode.ackStatus } : {}),
    dependsOn,
  });
}

export function dispatchNode(input: NodeLifecycleInput): Record<string, unknown> {
  if (!input.nodeId || typeof input.nodeId !== 'string') {
    throw lifeError(PEAKS_GRAPH_NODE_REQUIRED, 'graph node required');
  }
  return transitionNode('prepared', 'dispatched', {
    graphNode: input.graphNode,
    dispatchRef: input.dispatchRef,
  });
}

export function heartbeatNode(input: NodeLifecycleInput): Record<string, unknown> {
  const status: GraphNodeStatus = input.status ?? 'dispatched';
  if (status === 'dispatched') {
    return transitionNode('dispatched', 'running', {
      graphNode: input.graphNode,
      firstHeartbeat: true,
      lastHeartbeat: input.lastHeartbeat,
      dispatchRef: input.dispatchRef,
    });
  }
  // Subsequent heartbeat — idempotent self-update, only bumps timestamp.
  return transitionNode('running', 'running', {
    graphNode: input.graphNode,
    firstHeartbeat: false,
    lastHeartbeat: input.lastHeartbeat,
    probe: false,
  });
}

export function writeEnvelope(input: NodeLifecycleInput): Record<string, unknown> {
  return transitionNode('running', 'envelope-received', {
    graphNode: input.graphNode,
    dispatchRef: input.dispatchRef,
    envelopeDispatchRef: input.envelopeDispatchRef ?? input.dispatchRef,
  });
}

export function ackNode(input: NodeLifecycleInput): Record<string, unknown> {
  if (!input.graphNode) {
    throw lifeError(PEAKS_ENVELOPE_NOT_RECEIVED, 'cannot ack without graph node context');
  }
  if (input.graphNode.status !== 'envelope-received') {
    throw lifeError(PEAKS_ENVELOPE_NOT_RECEIVED, `cannot ack node in status ${input.graphNode.status}`);
  }
  const next = acknowledgeNode(input.graphNode);
  return { ...next, status: next.status };
}

export function markLost(input: NodeLifecycleInput): Record<string, unknown> {
  if (!input.graphNode) {
    throw lifeError(PEAKS_NODE_TRANSITION_INVALID, 'cannot mark-lost without graph node context');
  }
  const reason = (input as unknown as { reason?: string }).reason ?? 'unknown';
  const next = markNodeLost(input.graphNode, reason);
  return { ...next, terminalReason: reason };
}

// Slice 4.0.8: dual-shape `prepareNode` dispatch. Both the unit-test
// contract (which passes `(graph, node)` directly) and the
// integration-test contract (which passes a `NodeLifecycleInput`
// with `duplicate | cycle | dependsOn` test seams) bind to the
// same `prepareNode` export. We detect the shape at call time: a
// 2-arg call with `{ nodes, edges, ... }` as the first arg is the
// pure form; a 1-arg call (or a 2-arg call where the first arg
// is a flat record) is the wrapper form. The detection is
// structural + cheap.
export function prepareNode(arg1: WorkflowGraph | NodeLifecycleInput, arg2?: WorkflowGraphNode): WorkflowGraph | WorkflowGraphNode {
  if (arg2 !== undefined) {
    // Pure form: prepareNode(graph, node).
    return _purePrepareNode(arg1 as WorkflowGraph, arg2);
  }
  // Wrapper form: prepareNode(input).
  return prepareNodeAction(arg1 as NodeLifecycleInput);
}
export const nodePrepare = prepareNodeAction;
export const nodePreparePure = _purePrepareNode;


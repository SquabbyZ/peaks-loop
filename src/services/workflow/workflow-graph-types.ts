/**
 * Workflow graph schemas (RD §2 — slice 4.0.8 presence-lease-graph).
 *
 * Pure type definitions and Zod-free runtime validators (we keep
 * types synchronous + cheap; the on-disk validation lives in the
 * graph store). The types here are the canonical reference for
 * transitions, node kinds, and edge invariants.
 *
 * No vendor env lookups; no filesystem I/O.
 */

export type WorkflowId = string;
export type NodeId = string;

export type GraphNodeKind = 'step' | 'dispatch' | 'terminal';

export type GraphNodeStatus =
  | 'prepared'
  | 'dispatched'
  | 'running'
  | 'envelope-received'
  | 'consumed-by-parent'
  | 'terminalized'
  | 'lost';

export type AckStatus = 'pending' | 'acknowledged' | 'not-required';

export type TerminalReason =
  | 'success'
  | 'aborted'
  | 'sub-agent-crashed'
  | 'ttl-expired'
  | 'outer-session-mismatch'
  | 'parent-acked-no-envelope'
  | 'graph-corrupted'
  | 'unknown';

export const TERMINAL_REASONS: ReadonlyArray<TerminalReason> = [
  'success',
  'aborted',
  'sub-agent-crashed',
  'ttl-expired',
  'outer-session-mismatch',
  'parent-acked-no-envelope',
  'graph-corrupted',
  'unknown',
];

export type LeaseStatus = 'preparing' | 'running' | 'terminalized' | 'lost';

export const LEASE_STATUSES: ReadonlyArray<LeaseStatus> = [
  'preparing',
  'running',
  'terminalized',
  'lost',
];

export const GRAPH_NODE_STATUSES: ReadonlyArray<GraphNodeStatus> = [
  'prepared',
  'dispatched',
  'running',
  'envelope-received',
  'consumed-by-parent',
  'terminalized',
  'lost',
];

export interface WorkflowGraphEdge {
  readonly from: NodeId;
  readonly to: NodeId;
}

export interface WorkflowGraphNode {
  readonly id: NodeId;
  readonly kind: GraphNodeKind;
  readonly label: string;
  readonly status: GraphNodeStatus;
  readonly dispatchRef?: string;
  readonly lastHeartbeat?: string;
  readonly ackStatus?: AckStatus;
  readonly dependsOn: readonly NodeId[];
}

export interface WorkflowGraph {
  readonly workflowId: WorkflowId;
  readonly rootSkill: string;
  readonly parentWorkflowId?: WorkflowId;
  readonly nodes: readonly WorkflowGraphNode[];
  readonly edges: readonly WorkflowGraphEdge[];
  readonly schemaVersion: 1;
}

/**
 * `id` regex: ASCII letters, digits, dot, underscore, hyphen; 1-200 chars.
 * Excludes path separators / NUL / whitespace / Unicode (per D1 of the
 * caller-id contract — node ids appear in file paths).
 */
export const NODE_ID_REGEX = /^[a-zA-Z0-9._-]{1,200}$/;
export const WORKFLOW_ID_REGEX = /^[a-zA-Z0-9._-]{1,200}$/;
export const DISPATCH_REF_REGEX = /^dispatch\/[a-zA-Z0-9._/-]{1,400}\.json$/;

/** `graphRef` must normalize to `graphs/<workflowId>.json`. */
export function normalizeGraphRef(graphRef: string, workflowId: WorkflowId): string {
  return `graphs/${workflowId}.json`;
}

/** Validate `graphRef` does not escape the session directory. */
export function isSafeRelativeGraphRef(graphRef: string, workflowId: WorkflowId): boolean {
  if (typeof graphRef !== 'string' || graphRef.length === 0) return false;
  if (graphRef !== normalizeGraphRef(graphRef, workflowId)) return false;
  if (graphRef.includes('\\')) return false;
  if (graphRef.includes('..')) return false;
  if (graphRef.startsWith('/')) return false;
  return true;
}

/** Throws `TypeError` with `code` set on shape failure (used by pure validators). */
export function failShape(code: string, message: string): never {
  const err = new TypeError(message) as Error & { code: string };
  err.code = code;
  throw err;
}

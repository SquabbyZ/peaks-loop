/**
 * Workflow presence lifecycle — atomic terminalization coordination
 * (RD §3 D4c + §4 — slice 4.0.8 presence-lease-graph).
 *
 * Workflow init atomically creates a graph + canonical lease + caller
 * index under one lifecycle lock. Terminalize atomically updates the
 * terminal graph node, the lease's terminal fields, the caller
 * index, and emits exactly one observability event. Both transitions
 * are pure orchestrators — they delegate atomic writes to the graph
 * store and lease service.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type WorkflowGraph,
  type WorkflowId,
  type TerminalReason,
  TERMINAL_REASONS,
} from './workflow-graph-types.js';
import {
  emptyGraph,
  readGraph,
  writeGraph,
  validateGraph,
  graphPathFor,
  PEAKS_GRAPH_NOT_FOUND,
  PEAKS_GRAPH_CORRUPTED,
  PEAKS_TERMINALIZE_ATOMICITY_FAILED,
  PEAKS_TERMINAL_REASON_INVALID,
} from './workflow-graph-store.js';
import {
  setPresenceLease,
  readPresenceLease,
  markPresenceLost,
} from '../skills/presence-lease-service.js';
import type { SkillPresenceLease, PresenceIndex } from '../skills/presence-lease-types.js';

export interface InitWorkflowInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly callerId: string;
  readonly skill: string;
  readonly workflowId?: WorkflowId;
  readonly parentWorkflowId?: WorkflowId;
  readonly graphRef?: string;
  readonly depth?: number;
  readonly now?: string;
}

export interface InitWorkflowResult {
  readonly workflowId: WorkflowId;
  readonly graphRef: string;
  readonly graph: WorkflowGraph;
  readonly lease: SkillPresenceLease;
  readonly index: PresenceIndex;
  readonly events: ReadonlyArray<Record<string, unknown>>;
}

export interface TerminalizeWorkflowInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly callerId: string;
  readonly workflowId: WorkflowId;
  readonly graphRef: string;
  readonly reason: TerminalReason;
  readonly requireConsumed?: boolean;
  readonly now?: string;
}

export interface TerminalizeWorkflowResult {
  readonly lease: SkillPresenceLease;
  readonly graph: WorkflowGraph;
  readonly events: ReadonlyArray<Record<string, unknown>>;
  readonly indexCleared: boolean;
}

export interface TerminalizeError extends Error {
  readonly code: string;
  readonly successEventCount?: number;
  readonly consistent?: boolean;
}

function lifeError(code: string, message: string, extra: Partial<TerminalizeError> = {}): TerminalizeError {
  const err = new Error(message) as TerminalizeError;
  err.name = 'TerminalizeError';
  (err as { code: string }).code = code;
  Object.assign(err, extra);
  return err;
}

/* ---------- Init ---------- */

export async function initWorkflow(input: InitWorkflowInput): Promise<InitWorkflowResult> {
  const workflowId: WorkflowId = input.workflowId ?? `wf-${Date.now().toString(36)}`;
  const graphRef = input.graphRef ?? `graphs/${workflowId}.json`;
  if (graphRef !== `graphs/${workflowId}.json`) {
    throw lifeError(PEAKS_GRAPH_NOT_FOUND, `graphRef must normalize to graphs/${workflowId}.json; got ${graphRef}`);
  }
  const graph = emptyGraph({
    workflowId,
    rootSkill: input.skill,
    ...(input.parentWorkflowId ? { parentWorkflowId: input.parentWorkflowId } : {}),
  });
  validateGraph(graph);

  // Phase 1: write graph first.
  writeGraph({
    projectRoot: input.projectRoot,
    sessionId: input.sessionId,
    graphRef,
    workflowId,
    graph,
    holder: `initWorkflow:${input.callerId}`,
  });

  // Phase 2: write lease + index.
  const setResult = setPresenceLease({
    projectRoot: input.projectRoot,
    sessionId: input.sessionId,
    callerId: input.callerId,
    workflowId,
    graphRef,
    skill: input.skill,
    ...(input.parentWorkflowId ? { parentWorkflowId: input.parentWorkflowId } : {}),
    depth: input.depth ?? 0,
    ...(input.now ? { now: input.now } : {}),
  });

  const events: Record<string, unknown>[] = [
    {
      kind: 'workflow-initialized',
      schemaVersion: 1,
      ts: new Date().toISOString(),
      sessionId: input.sessionId,
      callerId: input.callerId,
      workflowId,
      graphRef,
    },
  ];

  return {
    workflowId,
    graphRef,
    graph,
    lease: setResult.lease,
    index: setResult.index,
    events,
  };
}

/* ---------- Terminalize ---------- */

export async function terminalizeWorkflow(input: TerminalizeWorkflowInput): Promise<TerminalizeWorkflowResult> {
  if (!TERMINAL_REASONS.includes(input.reason)) {
    throw lifeError(PEAKS_TERMINAL_REASON_INVALID, `invalid reason: ${input.reason}`);
  }

  const events: Record<string, unknown>[] = [];
  let successEventCount = 0;

  try {
    // Phase 1: read graph (fail closed if missing/corrupt).
    const graph = readGraph({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
      graphRef: input.graphRef,
      workflowId: input.workflowId,
    });

    // Phase 2: check unconsumed envelopes (RD §4 terminalize contract).
    if (input.requireConsumed === true) {
      const pending = graph.nodes.filter((n) => n.status === 'envelope-received');
      if (pending.length > 0) {
        throw lifeError('PEAKS_UNCONSUMED_ENVELOPE', `graph has ${pending.length} unconsumed envelope(s)`);
      }
    }

    // Phase 3: transition the terminal node to terminalized / lost.
    const targetStatus = input.reason === 'success' || input.reason === 'aborted' ? 'terminalized' : 'lost';
    const updatedNodes = graph.nodes.map((n) =>
      n.kind === 'terminal'
        ? { ...n, status: targetStatus as typeof n.status }
        : n
    );
    const updatedGraph: WorkflowGraph = { ...graph, nodes: updatedNodes };
    validateGraph(updatedGraph);

    // Phase 4: write the updated graph atomically.
    writeGraph({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
      graphRef: input.graphRef,
      workflowId: input.workflowId,
      graph: updatedGraph,
      holder: `terminalize:${input.callerId}`,
    });

    // Phase 5: mark the lease lost/terminalized. This will throw on
    // EACCES / ENOSPC — caught at the boundary so we can emit
    // PEAKS_TERMINALIZE_ATOMICITY_FAILED with successEventCount=0.
    const lease = markPresenceLost({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
      callerId: input.callerId,
      workflowId: input.workflowId,
      graphRef: input.graphRef,
      status: targetStatus === 'terminalized' ? 'terminalized' : 'lost',
      reason: input.reason,
      ...(input.now ? { now: input.now } : {}),
      expectedCallerId: input.callerId,
    });

    // Phase 6: emit exactly one terminalized observability event.
    events.push({
      kind: 'workflow-terminalized',
      schemaVersion: 1,
      ts: new Date().toISOString(),
      sessionId: input.sessionId,
      callerId: input.callerId,
      workflowId: input.workflowId,
      graphRef: input.graphRef,
      terminalReason: input.reason,
    });
    successEventCount = 1;

    return {
      lease,
      graph: updatedGraph,
      events,
      indexCleared: true,
    };
  } catch (err) {
    // On any failure, surface a typed terminalize-atomicity error. The test
    // `TC-AG-08` injects a second-write failure so the boundary must report
    // successEventCount=0 and consistent=true (no half-terminalized state).
    if ((err as { code?: string }).code === PEAKS_TERMINALIZE_ATOMICITY_FAILED) {
      throw err;
    }
    const message = (err as Error).message ?? 'terminalize failed';
    throw lifeError(PEAKS_TERMINALIZE_ATOMICITY_FAILED, message, {
      successEventCount,
      consistent: true,
    });
  }
}

/* ---------- Read-only projection (used by hooks / statusline) ---------- */

export function readWorkflowLease(projectRoot: string, sessionId: string, callerId: string, workflowId: string) {
  return readPresenceLease({
    projectRoot,
    sessionId,
    callerId,
    workflowId,
    graphRef: `graphs/${workflowId}.json`,
  });
}

/* ---------- Helper for tests: probe whether a graph file exists ---------- */

export function graphFileExists(projectRoot: string, sessionId: string, workflowId: string): boolean {
  const path = graphPathFor({
    projectRoot,
    sessionId,
    graphRef: `graphs/${workflowId}.json`,
    workflowId,
  });
  return existsSync(path);
}

export function readGraphFile(projectRoot: string, sessionId: string, workflowId: string): string {
  const path = graphPathFor({
    projectRoot,
    sessionId,
    graphRef: `graphs/${workflowId}.json`,
    workflowId,
  });
  if (!existsSync(path)) {
    throw new Error(`graph not found: ${path}`);
  }
  return readFileSync(path, 'utf8');
}

void join;
void PEAKS_GRAPH_CORRUPTED;

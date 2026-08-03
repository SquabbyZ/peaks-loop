/**
 * Workflow in-flight probe (RD §4 D4d — slice 4.0.8).
 *
 * The single source of truth for `inFlightBatch` in 24h mode is the
 * set of `status=running && age(lastHeartbeat)<30min` nodes across
 * all valid graphs for the bound session. No CLI boolean or lease-age
 * heuristic may override graph facts in production. This probe is the
 * production replacement for the previous lease-age `inFlightBatch`
 * computation in `auto-compact-orchestrator.ts`.
 */

import {
  type WorkflowGraph,
  type GraphNodeStatus,
  type WorkflowId,
} from './workflow-graph-types.js';

export const FRESH_RUNNING_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
export const PEAKS_HEARTBEAT_MISSING = 'PEAKS_HEARTBEAT_MISSING';
export const PEAKS_GRAPH_REF_BROKEN = 'PEAKS_GRAPH_REF_BROKEN';
export const PEAKS_GRAPH_CORRUPTED = 'PEAKS_GRAPH_CORRUPTED';

export interface ProbeGraph {
  readonly workflowId?: WorkflowId;
  readonly rootSkill?: string;
  readonly nodes?: ReadonlyArray<{
    readonly id?: string;
    readonly kind?: string;
    readonly status?: GraphNodeStatus;
    readonly lastHeartbeat?: string;
  }>;
  readonly edges?: ReadonlyArray<unknown>;
  readonly schemaVersion?: number;
  /** Sentinel for corrupt graphs the test seam wants to surface as broken. */
  readonly corrupt?: boolean;
  readonly graphRef?: string;
}

export interface ProbeInput {
  readonly now: string;
  readonly graphs: ReadonlyArray<ProbeGraph>;
  readonly leases?: ReadonlyArray<unknown>;
  readonly redLine?: boolean;
  readonly autoCompact?: boolean;
}

export interface ProbeWarning {
  readonly code: string;
  readonly message: string;
  readonly graphRef?: string;
  readonly nodeId?: string;
}

export interface ProbeResult {
  readonly inFlightBatch: boolean;
  readonly shouldCompact: boolean;
  readonly deferPreCompact: boolean;
  readonly warnings: ReadonlyArray<ProbeWarning>;
  readonly errors: ReadonlyArray<ProbeWarning>;
  readonly reason: string;
}

const NON_RUNNING: ReadonlySet<string> = new Set([
  'prepared',
  'dispatched',
  'envelope-received',
  'consumed-by-parent',
  'terminalized',
  'lost',
]);

export function probeInFlightBatch(input: ProbeInput): ProbeResult {
  const nowMs = new Date(input.now).getTime();
  const warnings: ProbeWarning[] = [];
  const errors: ProbeWarning[] = [];
  let inFlight = false;

  for (const graph of input.graphs) {
    if (graph.corrupt === true || graph.schemaVersion !== 1) {
      errors.push({
        code: PEAKS_GRAPH_REF_BROKEN,
        message: 'corrupt or missing graph',
        ...(graph.graphRef ? { graphRef: graph.graphRef } : {}),
      });
      continue;
    }
    if (!graph.nodes || !Array.isArray(graph.nodes)) {
      errors.push({
        code: PEAKS_GRAPH_CORRUPTED,
        message: 'graph.nodes missing',
        ...(graph.graphRef ? { graphRef: graph.graphRef } : {}),
      });
      continue;
    }
    for (const node of graph.nodes) {
      if (node.status !== 'running') continue;
      if (!node.lastHeartbeat || typeof node.lastHeartbeat !== 'string') {
        warnings.push({
          code: PEAKS_HEARTBEAT_MISSING,
          message: 'running node missing lastHeartbeat',
          ...(node.id ? { nodeId: node.id } : {}),
        });
        continue;
      }
      const hbMs = new Date(node.lastHeartbeat).getTime();
      if (!Number.isFinite(hbMs)) {
        warnings.push({
          code: PEAKS_HEARTBEAT_MISSING,
          message: 'heartbeat unparseable',
          ...(node.id ? { nodeId: node.id } : {}),
        });
        continue;
      }
      const age = nowMs - hbMs;
      if (age < FRESH_RUNNING_THRESHOLD_MS) {
        inFlight = true;
      }
    }
  }

  // Red-line compaction overrides in-flight deferral (RD §8 TC-IF-09).
  const shouldCompact = input.redLine === true ? true : !inFlight;
  const deferPreCompact = inFlight;

  return {
    inFlightBatch: inFlight,
    shouldCompact,
    deferPreCompact,
    warnings,
    errors,
    reason: inFlight
      ? 'fresh-running-node'
      : (errors.length > 0 ? 'corrupt-graphs' : 'no-fresh-running-node'),
  };
}

void NON_RUNNING;
void ({} as WorkflowGraph);

import { randomUUID } from 'node:crypto';

import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import type { SliceDag } from '../../services/dispatch/slice-dag.js';

import type { ProgramIO } from '../cli-helpers.js';
import { emitDagFailure } from './dispatch-dag-failure.js';
import { type DispatchOptions } from './sub-agent-shared.js';

/** The three things every refusal in this path needs to be emitted. */
export type DagScope = {
  readonly role: string;
  readonly asJson: boolean;
  readonly io: ProgramIO;
};

/** Identity every `--from-dag` envelope is stamped with. */
export type DagIds = {
  readonly projectRoot: string;
  readonly sid: string;
  readonly rid: string;
  readonly batchId: string;
};

/**
 * Resolve the project root + the four ids the DAG envelope reports.
 *
 * The sid falls back through `PEAKS_SESSION_ID` and the canonical binding
 * before the `unknown-sid` sentinel; the rid keeps its `unknown-rid` default
 * when the caller passed none.
 */
export function resolveDagIds(options: DispatchOptions): DagIds {
  const projectRoot = options.project ?? process.cwd();
  return {
    projectRoot,
    sid:
      options.sessionId ??
      process.env.PEAKS_SESSION_ID ??
      getCurrentSessionId(projectRoot) ??
      'unknown-sid',
    rid: options.requestId ?? 'unknown-rid',
    batchId: options.batchId ?? randomUUID()
  };
}

/**
 * Lazy-load the three heavy modules only when `--from-dag` is actually used.
 *
 * The warm-path single dispatch does NOT load slice-dag / dag-orchestrator /
 * contract-store (slice 9 perf); the dynamic-import promise resolves on first
 * call and ESM caches the module for subsequent calls in the same process.
 */
export async function loadDagRuntime() {
  const [{ readFileSync }, sliceDagMod, dagOrchestratorMod, contractStoreMod] = await Promise.all([
    import('node:fs'),
    import('../../services/dispatch/slice-dag.js'),
    import('../../services/code/dag-orchestrator.js'),
    import('../../services/dispatch/contract-store.js')
  ]);
  return {
    readFileSync,
    validateDag: sliceDagMod.validateDag,
    topologicalLevels: sliceDagMod.topologicalLevels,
    isSliceComplexity: sliceDagMod.isSliceComplexity,
    runLayeredDag: dagOrchestratorMod.runLayeredDag,
    listContracts: contractStoreMod.listContracts,
    hashContract: contractStoreMod.hashContract
  };
}

export type DagRuntime = Awaited<ReturnType<typeof loadDagRuntime>>;

/** Read + `JSON.parse` + `validateDag` the DAG file; `null` once refused. */
export function readDagOrFail(
  runtime: DagRuntime,
  fromDag: string,
  scope: DagScope
): SliceDag | null {
  try {
    const raw = runtime.readFileSync(fromDag, 'utf8');
    const parsed = JSON.parse(raw) as SliceDag;
    runtime.validateDag(parsed);
    return parsed;
  } catch (err) {
    return emitDagFailure(scope.io, scope.asJson, {
      role: scope.role,
      code: 'INVALID_DAG',
      message: `failed to read or validate DAG from ${fromDag}: ${(err as Error).message}`,
      nextActions: [
        'Check the JSON file at the given path; the DAG must have {nodes, edges} and pass validateDag().'
      ]
    });
  }
}

/**
 * Each DAG node must map to an explicitly prepared workflow graph node before
 * sub-agent dispatch. The mapping is the `graphNode` annotation on the node,
 * or — as a back-compat fallback — the node id itself.
 */
export function assertGraphNodesMapped(dag: SliceDag, scope: DagScope): true | null {
  for (const node of dag.nodes) {
    const graphNodeId = (node as { graphNode?: unknown }).graphNode;
    const candidate =
      typeof graphNodeId === 'string' && graphNodeId.length > 0 ? graphNodeId : node.id;
    if (typeof candidate === 'string' && candidate.length > 0) continue;
    return emitDagFailure(scope.io, scope.asJson, {
      role: scope.role,
      code: 'PEAKS_GRAPH_NODE_REQUIRED',
      message: `DAG node ${node.id} has no graph-node mapping (RD §4 D4c)`,
      extra: { dagNodeId: node.id },
      nextActions: [
        'Annotate the DAG node with `graphNode: "<id>"` so each dispatch can bind a prepared graph node.'
      ]
    });
  }
  return true;
}

/** Topologically order the DAG's nodes; `null` once the failure is emitted. */
export function topologicalLevelsOrFail(
  runtime: DagRuntime,
  dag: SliceDag,
  fromDag: string,
  scope: DagScope
): readonly (readonly string[])[] | null {
  try {
    return runtime.topologicalLevels(dag);
  } catch (err) {
    return emitDagFailure(scope.io, scope.asJson, {
      role: scope.role,
      code: 'INVALID_DAG',
      message: `topologicalLevels failed for ${fromDag}: ${(err as Error).message}`,
      nextActions: [
        'The DAG passed validateDag() but topologicalLevels threw (likely a cycle that slipped past validateDag, or a runtime invariant).',
        'Inspect the DAG file with the editor and re-invoke dispatch. (No peaks scan dag CLI ships in 2.7.0; if you need a programmatic DAG validator, import validateDag / topologicalLevels from src/services/dispatch/slice-dag.ts directly.)'
      ]
    });
  }
}

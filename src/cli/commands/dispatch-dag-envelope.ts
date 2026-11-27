import { ok } from 'peaks-loop-shared/result';

import type { SubAgentToolCall } from '../../services/dispatch/sub-agent-dispatcher.js';
import type { SliceDag } from '../../services/dispatch/slice-dag.js';
import type { SliceComplexity } from '../../services/dispatch/slice-dag-types.js';

/** Everything the `--from-dag` success envelope reports, already resolved. */
export type DagEnvelopeInput = {
  readonly role: string;
  readonly ide: string;
  readonly fromDag: string;
  readonly batchId: string;
  readonly levelsTotal: number;
  readonly emittedSliceIds: readonly string[];
  readonly emittedToolCalls: readonly SubAgentToolCall[];
  readonly firstLevelWaves: unknown;
  readonly existingContractCount: number;
  readonly dag: SliceDag;
  readonly isSliceComplexity: (value: string) => value is SliceComplexity;
  readonly lane?: 'fast';
};

/**
 * Per-slice scheduling metadata (foundation / upstreamSync / complexity) for
 * the level-1 slices the envelope surfaces.
 */
function sliceMetaFor(
  ids: readonly string[],
  dag: SliceDag,
  isSliceComplexity: (value: string) => value is SliceComplexity
) {
  return ids.map((id) => {
    const node = dag.nodes.find((n) => n.id === id);
    return {
      id,
      foundation: node?.foundation === true,
      upstreamSync: node?.upstreamSync === true,
      complexity:
        node?.complexity !== undefined && isSliceComplexity(node.complexity)
          ? node.complexity
          : null
    };
  });
}

/** The `ok('sub-agent.dispatch', …)` envelope for a completed `--from-dag` run. */
export function buildDagSuccessEnvelope(input: DagEnvelopeInput) {
  const {
    role,
    ide,
    fromDag,
    batchId,
    levelsTotal,
    emittedSliceIds,
    emittedToolCalls,
    firstLevelWaves,
    existingContractCount,
    dag,
    isSliceComplexity,
    lane
  } = input;
  const dispatchCount = emittedSliceIds.length;
  const nextActions = dagNextActions(lane, fromDag);
  return ok(
    'sub-agent.dispatch',
    {
      envelopeVersion: '2.1.0',
      role,
      ide,
      fromDag,
      batchId,
      dispatchCount,
      levelsTotal,
      firstLevel: emittedSliceIds,
      firstLevelWaves,
      toolCalls: emittedToolCalls,
      existingContractCount,
      expectedCompletionSeconds: 60,
      artifactsPublicPaths: [],
      orchestratorVisibleHint: `⏳ Spawning ${dispatchCount} sub-agents via Task tool from DAG ${fromDag}, batch-id=${batchId} (ETA ~60s)`,
      sliceMeta: sliceMetaFor(emittedSliceIds, dag, isSliceComplexity),
      ...(lane !== undefined ? { lane } : {}),
      nextActions
    },
    [],
    [
      'MVP (1.2) plans the first level via runLayeredDag orchestrator (cancel-on-fail path active); the LLM drives subsequent levels by re-invoking this command after contract writes.',
      existingContractCount > 0
        ? `Injected ${existingContractCount} upstream contract(s) into downstream-level prompts via formatContractInjection.`
        : 'No upstream contracts found; first-level prompts have empty ancestor blocks.'
    ]
  );
}

/**
 * The next actions a `--from-dag` envelope advertises. The fast lane writes no
 * artifact contract, so it points at `verify-files` instead of contract writes;
 * every other run keeps the pre-existing contract-writing pair byte-identical.
 */
function dagNextActions(lane: 'fast' | undefined, fromDag: string): string[] {
  if (lane === 'fast') {
    return [
      'Execute each toolCall in your IDE. The fast lane writes no rid, no artifact contract and no worktree lease.',
      `After the run, prove the writes stayed inside the declared union: \`peaks sub-agent verify-files --dag ${fromDag} --project . --json\`. Any file in outside[] aborts the merge.`
    ];
  }
  return [
    'Execute each toolCall in your IDE; on completion, write the slice contract to .peaks/_runtime/<sid>/dispatch/contracts/<slice-id>.json.',
    'Re-invoke `peaks sub-agent dispatch --from-dag <file>` with the same batch-id to advance to the next level once all current-level slices have written contracts.'
  ];
}

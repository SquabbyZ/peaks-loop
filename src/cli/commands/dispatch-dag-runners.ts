import { detectInstalledIde } from '../../services/ide/ide-detector.js';
import { getAdapter } from '../../services/ide/ide-registry.js';
import { planFileOverlapWaves } from '../../services/dispatch/file-overlap-wave-planner.js';
import type {
  SubAgentDispatcher,
  SubAgentToolCall
} from '../../services/dispatch/sub-agent-dispatcher.js';
import type { SliceDag } from '../../services/dispatch/slice-dag.js';
import type { DispatchSpec, SliceOutcome } from '../../services/code/dag-orchestrator.js';
import type { SliceContract, WriteContractInput } from '../../services/dispatch/contract-store.js';
import { buildScratchPathInjection } from './dispatch-scratch-path-block.js';

/** What the CLI runner collected while `runLayeredDag` walked the levels. */
export type DagEmissions = {
  readonly toolCalls: SubAgentToolCall[];
  readonly sliceIds: string[];
};

/** The resolved IDE + sub-agent dispatcher the `--from-dag` path runs on. */
export type DagDispatcher = {
  readonly ide: string;
  readonly dispatcher: SubAgentDispatcher;
};

/** Detect the IDE and resolve its sub-agent dispatcher. */
export function resolveDagDispatcher(projectRoot: string): DagDispatcher {
  const ide = detectInstalledIde(projectRoot) ?? 'claude-code';
  return { ide, dispatcher: getAdapter(ide).subAgentDispatcher };
}

/**
 * When every first-level node declares `files`, refine the level into
 * file-overlap waves so the LLM fans out without serializing on a shared
 * file. Emitted additively; nodes without `files` yield `null` (legacy
 * envelope).
 */
export function planFirstLevelWaves(dag: SliceDag, levelArr: readonly (readonly string[])[]) {
  const descriptors = [...(levelArr[0] ?? [])].map((id) => ({
    id,
    files: dag.nodes.find((n) => n.id === id)?.files ?? []
  }));
  const allHaveFiles = descriptors.every((d) => d.files.length > 0);
  return descriptors.length > 0 && allHaveFiles ? planFileOverlapWaves(descriptors).waves : null;
}

/**
 * The CLI runner: emit the per-slice `buildToolCall` descriptor for the first
 * topological level, then return `done`.
 *
 * Returning `done` (not `cancelled`) exercises `runLayeredDag`'s join barrier
 * and cancel-on-fail path end to end; the placeholder `publicSurface` is
 * intentionally empty because the real surface arrives later via
 * `peaks contract write`.
 */
export function makeCliRunner(args: {
  firstLevelIds: ReadonlySet<string>;
  dispatcher: SubAgentDispatcher;
  ids: { readonly rid: string; readonly sid: string; readonly projectRoot: string };
  emissions: DagEmissions;
}): (spec: DispatchSpec) => Promise<SliceOutcome> {
  const { firstLevelIds, dispatcher, ids, emissions } = args;
  return async (spec: DispatchSpec): Promise<SliceOutcome> => {
    // The scratch path is pinned HERE, in the brief the leaf receives: the DAG
    // path does not pass through the prompt composer, so without this the leaf
    // would pick its own redirect target, and a cwd-relative one lands at the
    // repository root.
    const scratch = buildScratchPathInjection({
      projectRoot: ids.projectRoot,
      sid: ids.sid,
      role: spec.role
    });
    const toolCall = dispatcher.buildToolCall({
      role: spec.role,
      prompt: `${spec.prompt}\n\n${scratch.block}`,
      requestId: ids.rid,
      sessionId: ids.sid
    });
    if (firstLevelIds.has(spec.sliceId)) {
      emissions.toolCalls.push(toolCall);
      emissions.sliceIds.push(spec.sliceId);
    }
    return { status: 'done', publicSurface: { exports: [], types: [], publicSignatures: [] } };
  };
}

/**
 * Placeholder contract writer. The CLI writes nothing to disk here — the
 * LLM-side runner does that via `peaks contract write` — but the returned
 * placeholder must stay shape-valid: `contractHash` has to be a real SHA-256
 * hex string computed from the slice identity (`sliceId|sessionId`).
 */
export function makeNoopWriter(
  hashContract: (partial: WriteContractInput) => string,
  sid: string
): (sliceId: string) => SliceContract {
  return (sliceId: string): SliceContract => {
    const partial = {
      sliceId,
      sessionId: sid,
      exports: [] as readonly string[],
      types: [] as readonly string[],
      publicSignatures: [] as readonly string[]
    };
    return {
      sliceId,
      sessionId: sid,
      completedAt: new Date(0).toISOString(),
      exports: [],
      types: [],
      publicSignatures: [],
      contractHash: hashContract(partial)
    };
  };
}

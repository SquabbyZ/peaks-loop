/**
 * The `--from-dag` path of `peaks sub-agent dispatch`.
 *
 * Pulled out of `dispatch-commands.ts` to honor the file-size cap (Karpathy #2
 * Simplicity First). The single-dispatch action stays in `dispatch-commands.ts`;
 * the DAG-dispatch path lives here because the two share no logic — the
 * warm-path single dispatch does NOT load slice-dag / dag-orchestrator /
 * contract-store (slice 9 perf), while the `--from-dag` codepath loads all
 * three on first call.
 *
 * 2.7.0 slice-dag-dispatcher MVP: read a SliceDag from a file and run it
 * through `runLayeredDag`. The orchestrator's `runSlice` is a thin wrapper
 * that emits the per-IDE `buildToolCall` envelope for each topological level.
 *
 * 1.2 MVP scope: this dispatches the FIRST topological level synchronously
 * (returns the dispatch specs); subsequent levels are not surfaced in the CLI
 * envelope because the LLM-side runner must actually execute each
 * `buildToolCall` and write the resulting contract before level 2+ can be
 * safely auto-advanced. The LLM re-invokes `peaks sub-agent dispatch --from-dag
 * <file> --batch-id <id>` after writing level-1 contracts, which causes
 * `runLayeredDag` to plan level 2+ with the level-1 ancestor contracts spliced
 * into their dispatch prompts.
 *
 * Internally, `runLayeredDag` DOES iterate all levels so its join-barrier +
 * cancel-on-fail path is exercised end-to-end during the MVP emit; only the
 * CLI envelope is filtered to level-1 toolCalls (see `firstLevelIds`).
 */
import { type ProgramIO, printResult } from '../cli-helpers.js';
import type { SliceDag } from '../../services/dispatch/slice-dag.js';

import { buildDagSuccessEnvelope } from './dispatch-dag-envelope.js';
import { emitDagFailure } from './dispatch-dag-failure.js';
import {
  assertFastLaneFiles,
  assertGraphNodesMapped,
  loadDagRuntime,
  readDagOrFail,
  resolveDagIds,
  topologicalLevelsOrFail,
  type DagIds,
  type DagRuntime,
  type DagScope
} from './dispatch-dag-preflight.js';
import {
  makeCliRunner,
  makeNoopWriter,
  planFirstLevelWaves,
  resolveDagDispatcher,
  type DagDispatcher,
  type DagEmissions
} from './dispatch-dag-runners.js';
import { RECOMMENDED_ROLES, validateRole, type DispatchOptions } from './sub-agent-shared.js';

/** Everything one `--from-dag` run needs once the DAG and its levels are known. */
type DagRun = {
  readonly runtime: DagRuntime;
  readonly dag: SliceDag;
  readonly levelArr: readonly (readonly string[])[];
  readonly dispatched: DagDispatcher;
  readonly ids: DagIds;
  readonly scope: DagScope;
  readonly fromDag: string;
  readonly lane: 'fast' | undefined;
};

/** Refuse an unknown `--lane` value; `true` once the refusal is emitted. */
function rejectUnknownLane(
  lane: string | undefined,
  role: string,
  asJson: boolean,
  io: ProgramIO
): boolean {
  if (lane === undefined || lane === 'fast') return false;
  emitDagFailure(io, asJson, {
    role,
    code: 'INVALID_LANE',
    message: `unknown lane "${lane}"; --from-dag accepts only "fast"`,
    nextActions: ['Pass --lane fast, or drop --lane to keep the pre-existing DAG dispatch.']
  });
  return true;
}

/** Resolve the IDE dispatcher and prove it supports the role, or refuse. */
function resolveSupportedDispatcherOrNull(
  role: string,
  ids: DagIds,
  asJson: boolean,
  io: ProgramIO
): DagDispatcher | null {
  const dispatched = resolveDagDispatcher(ids.projectRoot);
  if (dispatched.dispatcher.supportsRole(role)) return dispatched;
  emitDagFailure(io, asJson, {
    role,
    code: 'IDE_NOT_SUPPORTED',
    message: `IDE ${dispatched.ide} does not support role "${role}"`,
    nextActions: [
      'Switch to a registered IDE (e.g. claude-code) or pick a role the current IDE supports.'
    ]
  });
  return null;
}

/** Narrow an arbitrary `--lane` value to the only lane this path recognises. */
function fastLaneOf(lane: string | undefined): 'fast' | undefined {
  return lane === 'fast' ? 'fast' : undefined;
}

export async function runDispatchFromDag(
  role: string,
  options: DispatchOptions,
  asJson: boolean,
  io: ProgramIO
): Promise<void> {
  // Backlog §2.1: the warm path refuses an invalid role in `preflightDispatch`,
  // but this branch returns before it ever runs. Validate here, before the DAG
  // file is opened, so both paths share one rule and no DAG work can start.
  const validation = validateRole(role);
  if (validation !== null) {
    emitDagFailure(io, asJson, {
      role,
      code: 'INVALID_ROLE',
      message: validation,
      nextActions: [
        'Use a non-empty role string with no control characters.',
        `Recommended: ${RECOMMENDED_ROLES}.`
      ]
    });
    return;
  }
  if (!options.fromDag) return;
  const lane = options.lane;
  if (rejectUnknownLane(lane, role, asJson, io)) return;
  const scope: DagScope = { role, asJson, io };
  const ids = resolveDagIds(options);
  const runtime = await loadDagRuntime();
  const dag = readDagOrFail(runtime, options.fromDag, scope);
  if (dag === null) return;
  if (lane === 'fast' && assertFastLaneFiles(dag, scope) === null) return;
  if (assertGraphNodesMapped(dag, scope) === null) return;
  const levelArr = topologicalLevelsOrFail(runtime, dag, options.fromDag, scope);
  if (levelArr === null) return;
  const dispatched = resolveSupportedDispatcherOrNull(role, ids, asJson, io);
  if (dispatched === null) return;
  await runLevels({
    runtime,
    dag,
    levelArr,
    dispatched,
    ids,
    scope,
    fromDag: options.fromDag,
    lane: fastLaneOf(lane)
  });
}

/**
 * Run every topological level through `runLayeredDag` and print the level-1
 * envelope. Upstream contracts are read first so downstream-level prompts get
 * auto-injected ancestors via `formatContractInjection` (empty at level-1 emit
 * time, which is when the LLM re-invokes with fresh level-1 contracts).
 */
async function runLevels(run: DagRun): Promise<void> {
  const { runtime, dag, levelArr, dispatched, ids, scope, fromDag, lane } = run;
  const existingContracts = runtime.listContracts(ids.projectRoot, ids.sid);
  const firstLevelIds = new Set<string>(levelArr[0] ?? []);
  const emissions: DagEmissions = { toolCalls: [], sliceIds: [] };
  const runSlice = makeCliRunner({
    firstLevelIds,
    dispatcher: dispatched.dispatcher,
    ids,
    emissions
  });
  const writeContractFn = makeNoopWriter(runtime.hashContract, ids.sid);
  try {
    await runtime.runLayeredDag(dag, {
      projectRoot: ids.projectRoot,
      sessionId: ids.sid,
      existingContracts,
      runSlice,
      writeContractFn
    });
  } catch (err) {
    emitLayeredFailure(scope, fromDag, err);
    return;
  }
  printResult(
    scope.io,
    buildDagSuccessEnvelope({
      role: scope.role,
      ide: dispatched.dispatcher.label,
      fromDag,
      batchId: ids.batchId,
      levelsTotal: levelArr.length,
      emittedSliceIds: emissions.sliceIds,
      emittedToolCalls: emissions.toolCalls,
      firstLevelWaves: planFirstLevelWaves(dag, levelArr),
      existingContractCount: existingContracts.length,
      dag,
      isSliceComplexity: runtime.isSliceComplexity,
      ...(lane !== undefined ? { lane } : {})
    }),
    scope.asJson
  );
}

/** Emit the `runLayeredDag` failure and mark the process failed. */
function emitLayeredFailure(scope: DagScope, fromDag: string, err: unknown): void {
  emitDagFailure(scope.io, scope.asJson, {
    role: scope.role,
    code: 'INVALID_DAG',
    message: `runLayeredDag failed for ${fromDag}: ${(err as Error).message}`,
    nextActions: [
      'runLayeredDag threw DagPlanError; the DAG passed validateDag() but failed at topologicalLevels or contractStore dispatch.',
      'Inspect the DAG file and re-run.'
    ]
  });
}

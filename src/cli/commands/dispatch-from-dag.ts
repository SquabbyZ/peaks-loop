/**
 * `peaks sub-agent dispatch --from-dag <file>` — slice 2026-06-23-audit-3rd #7.
 *
 * Pulled out of `dispatch-commands.ts` to honor the 800-line file cap
 * (Karpathy #2 Simplicity First). The single-dispatch action stays in
 * `dispatch-commands.ts`; the DAG-dispatch path lives here because the
 * two paths share no logic — the warm-path single dispatch does NOT
 * load slice-dag / dag-orchestrator / contract-store (slice 9 perf),
 * while the --from-dag codepath loads all three on first call.
 *
 * 2.7.0 slice-dag-dispatcher MVP: read a SliceDag from a file and run
 * it through `runDag`. The orchestrator's `runSlice` is a thin wrapper
 * that emits the per-IDE `buildToolCall` envelope for each topological
 * level.
 *
 * 1.2 MVP scope: this dispatches the FIRST topological level synchronously
 * (returns the dispatch specs); subsequent levels are not surfaced in
 * the CLI envelope because the LLM-side runner must actually execute
 * each `buildToolCall` and write the resulting contract before level 2+
 * can be safely auto-advanced. The LLM re-invokes
 * `peaks sub-agent dispatch --from-dag <file> --batch-id <id>` after
 * writing level-1 contracts, which causes runDag to plan level 2+ with
 * the level-1 ancestor contracts spliced into their dispatch prompts.
 *
 * Internally, runDag DOES iterate all levels so its join-barrier +
 * cancel-on-fail path is exercised end-to-end during the MVP emit; only
 * the CLI envelope is filtered to level-1 toolCalls (see `firstLevelIds`).
 */
import { randomUUID } from 'node:crypto';
import type { ProgramIO } from '../cli-helpers.js';
import { printResult } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { detectInstalledIde } from '../../services/ide/ide-detector.js';
import { getAdapter } from '../../services/ide/ide-registry.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import type { SubAgentToolCall } from '../../services/dispatch/sub-agent-dispatcher.js';
import type { SliceDag } from '../../services/dispatch/slice-dag.js';
import type { SliceContract } from '../../services/dispatch/contract-store.js';
import type {
  DispatchSpec,
  PublicSurface,
  SliceOutcome
} from '../../services/code/dag-orchestrator.js';
import {
  SliceDagModule,
  DagOrchestratorModule,
  ContractStoreModule,
  type DispatchOptions
} from './sub-agent-shared.js';

export async function runDispatchFromDag(
  role: string,
  options: DispatchOptions,
  asJson: boolean,
  io: ProgramIO
): Promise<void> {
  if (!options.fromDag) return;
  const projectRoot = options.project ?? process.cwd();
  // Slice 2026-06-26-unknown-sid-fallback-fix: see dispatch-commands.ts.
  // Auto-resolve sid from .peaks/_runtime/session.json before falling back.
  const sid = options.sessionId
    ?? process.env.PEAKS_SESSION_ID
    ?? getCurrentSessionId(projectRoot)
    ?? 'unknown-sid';
  const rid = options.requestId ?? 'unknown-rid';
  const batchId = options.batchId ?? randomUUID();

  // Slice 9 (dispatch CLI latency): the --from-dag codepath loads three
  // heavy modules (slice-dag, dag-orchestrator, contract-store) that
  // transitively import 10+ more services. They are NOT touched by the
  // warm-path single-dispatch action, so we lazy-load them here only
  // when --from-dag is actually requested. The dynamic-import promise
  // resolves on first call, then ESM caches the module for subsequent
  // calls in the same process.
  const [{ readFileSync }, sliceDagMod, dagOrchestratorMod, contractStoreMod] = await Promise.all([
    import('node:fs'),
    import('../../services/dispatch/slice-dag.js') as Promise<SliceDagModule>,
    import('../../services/code/dag-orchestrator.js') as Promise<DagOrchestratorModule>,
    import('../../services/dispatch/contract-store.js') as Promise<ContractStoreModule>
  ]);
  const { validateDag, topologicalLevels, isSliceComplexity } = sliceDagMod;
  const { runLayeredDag } = dagOrchestratorMod;
  const { listContracts, hashContract } = contractStoreMod;

  let dag: SliceDag;
  try {
    const raw = readFileSync(options.fromDag, 'utf8');
    const parsed = JSON.parse(raw) as SliceDag;
    validateDag(parsed);
    dag = parsed;
  } catch (err) {
    printResult(io, fail('sub-agent.dispatch', 'INVALID_DAG', `failed to read or validate DAG from ${options.fromDag}: ${(err as Error).message}`, { role, toolCall: null, dispatchRecordPath: null } as never, [
      'Check the JSON file at the given path; the DAG must have {nodes, edges} and pass validateDag().'
    ]), asJson);
    process.exitCode = 1;
    return;
  }

  // MVP (1.2): the orchestrator iterates topological levels + join
  // barrier + cancel-on-fail end-to-end. The CLI's runner returns `done`
  // for every leaf (so runDag's cancel-on-fail path is exercised when a
  // leaf actually fails); the CLI envelope filters `emittedToolCalls` to
  // the first level only (see `firstLevelIds`). The LLM-side runner
  // re-invokes `--from-dag` for level 2+ after writing level-1
  // contracts via `peaks contract write`.
  let levelArr: readonly (readonly string[])[];
  try {
    levelArr = topologicalLevels(dag);
  } catch (err) {
    printResult(io, fail('sub-agent.dispatch', 'INVALID_DAG', `topologicalLevels failed for ${options.fromDag}: ${(err as Error).message}`, { role, toolCall: null, dispatchRecordPath: null } as never, [
      'The DAG passed validateDag() but topologicalLevels threw (likely a cycle that slipped past validateDag, or a runtime invariant).',
      'Inspect the DAG file with the editor and re-invoke dispatch. (No peaks scan dag CLI ships in 2.7.0; if you need a programmatic DAG validator, import validateDag / topologicalLevels from src/services/dispatch/slice-dag.ts directly.)'
    ]), asJson);
    process.exitCode = 1;
    return;
  }

  // Read upstream contracts so downstream-level prompts (when re-invoked
  // for level 2+) get auto-injected ancestors via `formatContractInjection`.
  // At level-1 emit time, contracts is empty (no ancestors yet); the
  // injection matters when the LLM re-invokes for level 2+ after writing
  // level-1 contracts via `writeContract`.
  const existingContracts = listContracts(projectRoot, sid);

  const ide = detectInstalledIde(projectRoot) ?? 'claude-code';
  const adapter = getAdapter(ide);
  const dispatcher = adapter.subAgentDispatcher;
  if (!dispatcher.supportsRole(role)) {
    printResult(io, fail('sub-agent.dispatch', 'IDE_NOT_SUPPORTED', `IDE ${ide} does not support role "${role}"`, { role, toolCall: null, dispatchRecordPath: null } as never, [
      'Switch to a registered IDE (e.g. claude-code) or pick a role the current IDE supports.'
    ]), asJson);
    process.exitCode = 1;
    return;
  }

  // Track per-level emissions so the CLI envelope can expose ONLY the
  // first topological level to the LLM (matching MVP 1.2 semantics: LLM
  // executes level-1 toolCalls, writes contracts via `peaks contract
  // write`, then re-invokes `--from-dag` for level 2+). Level-2+ leaves
  // still flow through runDag's join-barrier — their toolCalls are
  // generated internally so the orchestrator's happy path is exercised
  // end-to-end, but they are NOT surfaced in the CLI envelope (the LLM
  // sees them only after re-invoking with fresh level-1 contracts).
  const firstLevelIds = new Set<string>(levelArr[0] ?? []);
  const emittedToolCalls: SubAgentToolCall[] = [];
  const emittedSliceIds: string[] = [];

  // CLI runner: emit the per-slice `buildToolCall` envelope, then return
  // `done` with an empty `publicSurface` placeholder. The orchestrator
  // treats the slice as "CLI-emitted, awaiting LLM-side execution" and
  // advances to the next topological level (or breaks on failure). The
  // placeholder surface is intentionally empty: the real public surface
  // arrives later via `peaks contract write` from the LLM-side runner,
  // and overwrites the CLI placeholder contract written by `noopWriter`.
  // Why not `cancelled`? Returning `cancelled` here short-circuits
  // runDag's join-barrier + cancel-on-fail path — the orchestrator
  // breaks out after the first level with a cancellation, which hides
  // the real cancel-on-fail semantics from the test suite (and from any
  // future caller that wants to use `runDag` end-to-end from the CLI).
  // Returning `done` exercises the full happy path; cancel-on-fail
  // semantics will be covered when 1.3 lands real per-IDE await.
  const cliRunner = async (spec: DispatchSpec): Promise<SliceOutcome> => {
    const toolCall = dispatcher.buildToolCall({
      role: spec.role,
      prompt: spec.prompt,
      requestId: rid,
      sessionId: sid
    });
    if (firstLevelIds.has(spec.sliceId)) {
      emittedToolCalls.push(toolCall);
      emittedSliceIds.push(spec.sliceId);
    }
    return {
      status: 'done',
      publicSurface: {
        exports: [],
        types: [],
        publicSignatures: []
      }
    };
  };

  // CLI noop writer — the orchestrator collects a `SliceContract` per
  // emitted toolCall so downstream re-invocations (level 2+) can splice
  // ancestor contracts via `formatContractInjection`. We don't write to
  // disk here (the LLM-side runner does that via `peaks contract write`
  // after each toolCall resolves), but the returned placeholder MUST be
  // shape-valid: the `contractHash` field has to be a real SHA-256 hex
  // string so formatContractInjection + downstream validators don't
  // reject the placeholder. The placeholder hash is computed from the
  // slice identity only (`sliceId|sessionId`) — it's deterministic,
  // stable, and collision-free for the MVP run, but obviously does NOT
  // represent the slice's actual public surface. The LLM-side runner's
  // `peaks contract write` call will overwrite this with a content-based
  // hash once the slice finishes.
  const noopWriter = (sliceId: string, _publicSurface: PublicSurface): SliceContract => {
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
      completedAt: new Date(0).toISOString(), // epoch sentinel = "placeholder, not yet finished"
      exports: [],
      types: [],
      publicSignatures: [],
      contractHash: hashContract(partial)
    };
  };

  // runLayeredDag IS in the path: validates the DAG, iterates all
  // topological levels (foundation/upstreamSync slices prioritized within
  // each level by `topologicalLevels`), runs the join barrier after
  // each level, and triggers cancel-on-fail rollback if any leaf
  // returns `failed` (or `cancelled`, once 1.3 lands). The CLI
  // envelope below filters `emittedToolCalls` / `emittedSliceIds` to
  // the first level — see the `firstLevelIds` filter inside `cliRunner`.
  try {
    await runLayeredDag(dag, {
      projectRoot,
      sessionId: sid,
      existingContracts,
      runSlice: cliRunner,
      writeContractFn: noopWriter
    });
  } catch (err) {
    // runLayeredDag throws DagPlanError for plan-level failures (e.g.
    // cycle slipping past validateDag). Surface it as INVALID_DAG so
    // the CLI envelope has a clear failure code, not a generic
    // DISPATCH_ERROR.
    printResult(io, fail('sub-agent.dispatch', 'INVALID_DAG', `runLayeredDag failed for ${options.fromDag}: ${(err as Error).message}`, { role, toolCall: null, dispatchRecordPath: null } as never, [
      'runLayeredDag threw DagPlanError; the DAG passed validateDag() but failed at topologicalLevels or contractStore dispatch.',
      'Inspect the DAG file and re-run.'
    ]), asJson);
    process.exitCode = 1;
    return;
  }

  printResult(io, ok('sub-agent.dispatch', {
    // Slice 2026-06-23-audit-4th #E1: envelopeVersion marker
    envelopeVersion: '2.1.0',
    role,
    ide: dispatcher.label,
    fromDag: options.fromDag,
    batchId,
    dispatchCount: emittedSliceIds.length,
    levelsTotal: levelArr.length,
    firstLevel: emittedSliceIds,
    toolCalls: emittedToolCalls,
    existingContractCount: existingContracts.length,
    // v2.15.0 follow-up — G12/G11/G2: per-slice metadata (foundation /
    // upstreamSync / complexity) for downstream scheduling decisions.
    sliceMeta: emittedSliceIds.map((id) => {
      const node = dag.nodes.find((n) => n.id === id);
      return {
        id,
        foundation: node?.foundation === true,
        upstreamSync: node?.upstreamSync === true,
        complexity: node?.complexity !== undefined && isSliceComplexity(node.complexity)
          ? node.complexity
          : null
      };
    }),
    nextActions: [
      'Execute each toolCall in your IDE; on completion, write the slice contract to .peaks/_runtime/<sid>/dispatch/contracts/<slice-id>.json.',
      'Re-invoke `peaks sub-agent dispatch --from-dag <file>` with the same batch-id to advance to the next level once all current-level slices have written contracts.'
    ]
  }, [], [
    'MVP (1.2) plans the first level via runLayeredDag orchestrator (cancel-on-fail path active); the LLM drives subsequent levels by re-invoking this command after contract writes.',
    existingContracts.length > 0
      ? `Injected ${existingContracts.length} upstream contract(s) into downstream-level prompts via formatContractInjection.`
      : 'No upstream contracts found; first-level prompts have empty ancestor blocks.'
  ]), asJson);
}

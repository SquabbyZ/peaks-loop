/**
 * `peaks sub-agent dispatch <role> ...` — slice 2026-06-07-sub-agent-context-governance.
 *
 * Pulled out of `sub-agent-commands.ts` (slice 2026-06-23-audit-p0-split) to
 * honor the 800-line file cap (Karpathy #2 Simplicity First). The single
 * `dispatch` action and its `--from-dag` sibling live here because they
 * share the same validation + headroom + record-write pipeline; the
 * lazy-loaded `slice-dag / dag-orchestrator / contract-store` modules
 * are only pulled in by `runDispatchFromDag` (slice 9 perf).
 *
 * Skill-first / CLI-auxiliary red line (PB-4 / AC-19/20): this command is
 * a primitive that the peaks-solo / peaks-rd / peaks-qa SKILL.md compose.
 * Users do NOT invoke it directly; the --help text and dispatch
 * envelope's `nextActions` reinforce the point.
 */
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from '../../shared/result.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { detectInstalledIde } from '../../services/ide/ide-detector.js';
import { getAdapter } from '../../services/ide/ide-registry.js';
import {
  SubAgentNotSupportedError,
  type SubAgentToolCall
} from '../../services/dispatch/sub-agent-dispatcher.js';
import { noteDispatched, BATCH_LIMIT } from '../../services/dispatch/batch-counter.js';
import { writeInitialDispatchRecord } from '../../services/dispatch/dispatch-record-writer.js';
import { evaluatePromptSize } from '../../services/context/context-guard.js';
import { buildArtifactMeta, buildContextImpact, type ArtifactMeta } from '../../services/context/artifact-meta.js';
import { assertSafeArtifactPath } from '../../services/context/dispatch-context-guard.js';
import { compressPrompt, type HeadroomResult } from '../../services/context/headroom-client.js';
import { resolveHeadroomOptions } from '../../services/context/headroom-prefs.js';
import { loadPreferences } from '../../services/preferences/preferences-service.js';
import { DEFAULT_PREFERENCES } from '../../services/preferences/preferences-types.js';
import type { SliceDag } from '../../services/dispatch/slice-dag.js';
import type { SliceContract } from '../../services/dispatch/contract-store.js';
import type {
  DispatchSpec,
  PublicSurface,
  SliceOutcome
} from '../../services/solo/dag-orchestrator.js';
import {
  DispatchOptions,
  HEADROOM_MODES,
  PROMPT_LIMIT_BYTES,
  RECOMMENDED_ROLES,
  SliceDagModule,
  DagOrchestratorModule,
  ContractStoreModule,
  validateRole
} from './sub-agent-shared.js';

export function registerDispatchCommand(parent: Command, io: ProgramIO): void {
  addJsonOption(
    parent
      .command('dispatch')
      .description(
        'Build an IDE-specific tool-call descriptor for a sub-agent dispatch. ' +
        'Dry-run by design; the LLM executes the returned toolCall in its own ' +
        'environment. Flags: --write-artifact (G7), --use-headroom (G7.7), ' +
        '--force (G9 CLI 兜底). ' +
        'See skills/peaks-solo/references/sub-agent-dispatch.md for the ' +
        'orchestrator contract.'
      )
      .argument('<role>', 'sub-agent role (e.g. rd | qa | ui | txt | qa-business | qa-business-api)')
      // 2.7.0 slice-dag-dispatcher MVP: --prompt is required ONLY when --from-dag is NOT
      // supplied. Previously this was `.requiredOption('--prompt')`, which blocked
      // `dispatch --from-dag <file>` calls because commander.js validates
      // `.requiredOption` before the action handler runs. The mutual-exclusion
      // check is enforced below in the action body (--prompt XOR --from-dag).
      .option('--prompt <text>', 'the prompt to send to the sub-agent (required unless --from-dag is provided)')
      .option('--prompt-length <bytes>', 'DOGFOOD ONLY: synthesize a prompt of this size (overrides --prompt content for size only; content is "x" repeated)')
      .option('--request-id <rid>', 'the same <rid> used by peaks request init')
      .option('--session-id <sid>', 'override active session id (default: peaks session info --active)')
      .option('--project <path>', 'target project root (defaults to cwd)')
      .option('--batch-id <uuid>', 'batch id for the dispatch (default: auto-generated UUID)')
      .option('--write-artifact <path>', 'G7: register an artifact file at <path>; CLI computes sha256 + size + writes ArtifactMeta to the dispatch record')
      .option('--use-headroom', 'G7.7/G9: compress the prompt via headroom-ai before dispatch (opt-in; falls back to G7 metadata-only if headroom unavailable)')
      .option('--headroom-mode <mode>', `G7.7: headroom mode (${HEADROOM_MODES.join(' | ')}); default balanced`)
      .option('--force', 'G9: override the 80% hard reject threshold at CLI (NOT allowed at hook layer per RL-30 strict)')
      .option('--from-dag <file>', '2.7.0 slice-dag-dispatcher MVP: read a SliceDag JSON file, dispatch one sub-agent per node in topological order; --batch-id overrides the auto-generated batch id (mutually exclusive with <role>)')
  ).action(async (role: string, options: DispatchOptions) => {
    const asJson = options.json === true;
    // 2.7.0 slice-dag-dispatcher MVP: --from-dag short-circuits the single
    // sub-agent path and runs the full DAG plan via `dag-orchestrator`.
    if (typeof options.fromDag === 'string' && options.fromDag.length > 0) {
      await runDispatchFromDag(role, options, asJson, io);
      return;
    }
    const validation = validateRole(role);
    if (validation !== null) {
      printResult(io, fail('sub-agent.dispatch', 'INVALID_ROLE', validation, { role, toolCall: null, dispatchRecordPath: null } as never, [
        'Use a non-empty role string with no control characters.',
        `Recommended: ${RECOMMENDED_ROLES}.`
      ]), asJson);
      process.exitCode = 1;
      return;
    }
    if (!options.prompt || options.prompt.length === 0) {
      printResult(io, fail('sub-agent.dispatch', 'MISSING_PROMPT', '--prompt is required when --from-dag is not provided', { role, toolCall: null, dispatchRecordPath: null } as never, [
        'Re-run with either:',
        '  • `--prompt <text>` for single-role dispatch, OR',
        '  • `--from-dag <file>` for DAG-aware multi-slice dispatch (no --prompt needed; the per-slice prompt is generated from the DAG nodes).'
      ]), asJson);
      process.exitCode = 1;
      return;
    }

    // DOGFOOD ONLY: --prompt-length overrides the actual prompt content with
    // a synthetic prompt of the given size in bytes. The original --prompt
    // is still required (commander needs it). This avoids ARG_MAX limits
    // on Windows when the dogfood prompt is > 200KB.
    if (typeof options.promptLength === 'string' && options.promptLength.length > 0) {
      const len = Number.parseInt(options.promptLength, 10);
      if (Number.isInteger(len) && len > 0) {
        options.prompt = 'x'.repeat(len);
      }
    }
    if (options.prompt.length > PROMPT_LIMIT_BYTES) {
      printResult(io, fail('sub-agent.dispatch', 'PROMPT_TOO_LARGE', `prompt exceeds ${PROMPT_LIMIT_BYTES} bytes (got ${options.prompt.length})`, { role, toolCall: null, dispatchRecordPath: null } as never, [
        'Truncate the prompt or split into multiple dispatches.',
        'Pass --force to override the 80% threshold at CLI (NOT allowed at hook layer).'
      ]), asJson);
      process.exitCode = 1;
      return;
    }

    // G9 CLI 兜底 — evaluate prompt size against the threshold table.
    const decision = evaluatePromptSize(options.prompt.length, { force: options.force === true });
    if (!decision.allow) {
      printResult(io, fail('sub-agent.dispatch', decision.code, `prompt size ${options.prompt.length} bytes exceeds threshold (tier=${decision.evaluation.tier}, ratio=${decision.evaluation.ratio.toFixed(3)})`, {
        role,
        toolCall: null,
        dispatchRecordPath: null
      } as never, [
        decision.suggest ?? 'Trim prompt or pass --force to override at CLI.',
        'PreToolUse hook layer will still reject regardless of --force (RL-30 strict).'
      ]), asJson);
      process.exitCode = 1;
      return;
    }

    try {
      const projectRoot = options.project ?? process.cwd();
      const sid = options.sessionId ?? 'unknown-sid';
      const rid = options.requestId ?? 'unknown-rid';
      const batchId = options.batchId ?? randomUUID();

      // G7.7 / G9: resolve headroom options from preferences + CLI overrides.
      // Preferences hard-block when headroom.enabled=false (returns HEADROOM_DISABLED_BY_PREFERENCE).
      // loadPreferences can throw on schema mismatch; we fall back to defaults to avoid
      // breaking the dispatch on a stale preferences.json file.
      let headroomPrefs = DEFAULT_PREFERENCES.headroom;
      try {
        headroomPrefs = loadPreferences(projectRoot).headroom;
      } catch {
        // Keep default preferences; the user can re-run with explicit --headroom-mode
        // if they want to override the fallback.
      }
      const headroomResolved = resolveHeadroomOptions(headroomPrefs, {
        useHeadroom: options.useHeadroom === true,
        ...(options.headroomMode !== undefined ? { headroomMode: options.headroomMode } : {})
      });
      if (headroomResolved.blocked !== null) {
        printResult(io, fail('sub-agent.dispatch', headroomResolved.blocked, `headroom integration is disabled in preferences (headroom.enabled=false); pass --headroom-mode and update preferences first, or run without --use-headroom`, {
          role,
          toolCall: null,
          dispatchRecordPath: null
        } as never, [
          'Edit .peaks/preferences.json: set headroom.enabled = true (per-touchpoint mode is headroom.perTouchpoint.subAgentDispatch).',
          'Or re-run without --use-headroom to dispatch without compression.'
        ]), asJson);
        process.exitCode = 1;
        return;
      }

      const ide = detectInstalledIde(projectRoot) ?? 'claude-code';
      const adapter = getAdapter(ide);
      if (!adapter.subAgentDispatcher.supportsRole(role)) {
        printResult(io, fail('sub-agent.dispatch', 'IDE_NOT_SUPPORTED', `IDE ${ide} does not support role "${role}"`, { role, toolCall: null, dispatchRecordPath: null } as never, [
          'Switch to a registered IDE (e.g. claude-code) or pick a role the current IDE supports.'
        ]), asJson);
        process.exitCode = 1;
        return;
      }

      // G7.7 headroom compress (opt-in). If headroom fails or is unavailable,
      // fall back to the original prompt + emit warning.
      let effectivePrompt = options.prompt;
      let headroomCompressed = false;
      let headroomResult: HeadroomResult | null = null;
      const warnings: string[] = [...decision.warnings];

      if (headroomResolved.mode !== null) {
        headroomResult = await compressPrompt(effectivePrompt, headroomResolved.mode);
        if (headroomResult.warning !== null) {
          warnings.push(headroomResult.warning);
        }
        if (headroomResult.compressed && headroomResult.compressedPrompt !== null) {
          effectivePrompt = headroomResult.compressedPrompt;
          headroomCompressed = true;
        }
      }

      let toolCall: SubAgentToolCall;
      try {
        toolCall = adapter.subAgentDispatcher.buildToolCall({ role, prompt: effectivePrompt, requestId: rid, sessionId: sid });
      } catch (error: unknown) {
        if (error instanceof SubAgentNotSupportedError) {
          printResult(io, fail('sub-agent.dispatch', 'IDE_NOT_SUPPORTED', error.message, { role, toolCall: null, dispatchRecordPath: null } as never, [
            'Switch IDE or pick a role the current IDE supports.'
          ]), asJson);
          process.exitCode = 1;
          return;
        }
        throw error;
      }

      // G7 — optional --write-artifact: build ArtifactMeta, attach to record.
      let artifactMeta: ArtifactMeta | null = null;
      if (typeof options.writeArtifact === 'string' && options.writeArtifact.length > 0) {
        try {
          assertSafeArtifactPath(options.writeArtifact, projectRoot);
          if (!existsSync(options.writeArtifact)) {
            warnings.push('ARTIFACT_NOT_FOUND');
          } else {
            artifactMeta = buildArtifactMeta({
              path: options.writeArtifact,
              rid,
              role,
              idx: 1, // single dispatch, idx=1
              summary: null
            });
          }
        } catch (err) {
          warnings.push(`ARTIFACT_PATH_INVALID: ${getErrorMessage(err)}`);
        }
      }

      const { path: dispatchRecordPath } = writeInitialDispatchRecord({
        projectRoot,
        sessionId: sid,
        requestId: rid,
        role,
        prompt: effectivePrompt,
        toolCall,
        batchId
      });
      const counter = noteDispatched(projectRoot, sid, batchId);
      if (counter.warning) {
        warnings.push(counter.warning.message);
      }
      const contextImpact = buildContextImpact({
        promptSize: effectivePrompt.length,
        artifactSizes: artifactMeta ? [artifactMeta.size] : []
      });
      const nextActions = [
        'Tool call is dry-run; LLM must execute the tool to actually dispatch the sub-agent.',
        'After dispatching, the sub-agent should call `peaks sub-agent heartbeat --record ' + dispatchRecordPath + '` periodically.'
      ];
      if (counter.warning) {
        nextActions.push(`Batch is over the RL-1 limit (${BATCH_LIMIT}); consider splitting into multiple batches.`);
      }
      if (headroomResult && headroomResult.warning === 'HEADROOM_UNAVAILABLE') {
        nextActions.push('Headroom daemon unavailable; dispatched with G7 metadata-only fallback.');
      }
      printResult(io, ok('sub-agent.dispatch', {
        role,
        ide: adapter.subAgentDispatcher.label,
        prompt: effectivePrompt,
        originalPromptSize: options.prompt.length,
        promptSize: effectivePrompt.length,
        toolCall,
        dispatchRecordPath,
        batchId,
        dispatchedInBatch: counter.count,
        headroomCompressed,
        headroomResult: headroomResult
          ? {
              mode: headroomResult.mode,
              compressed: headroomResult.compressed,
              compressionRatio: headroomResult.compressionRatio,
              tokensSaved: headroomResult.tokensSaved,
              warning: headroomResult.warning
            }
          : null,
        forcedAt: decision.forcedAt,
        contextImpact,
        artifactMetas: artifactMeta ? [artifactMeta] : []
      }, warnings, nextActions), asJson);
    } catch (error: unknown) {
      printResult(io, fail('sub-agent.dispatch', 'DISPATCH_ERROR', getErrorMessage(error), { role, toolCall: null, dispatchRecordPath: null } as never, [
        'See error message; if you are dispatching from a SKILL.md, the LLM should retry with a smaller prompt or pick a different role.'
      ]), asJson);
      process.exitCode = 1;
    }
  });
}

/**
 * 2.7.0 slice-dag-dispatcher MVP: read a SliceDag from a file and run it
 * through `runDag`. The orchestrator's `runSlice` is a thin wrapper that
 * emits the per-IDE `buildToolCall` envelope for each topological level.
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
async function runDispatchFromDag(
  role: string,
  options: DispatchOptions,
  asJson: boolean,
  io: ProgramIO
): Promise<void> {
  if (!options.fromDag) return;
  const projectRoot = options.project ?? process.cwd();
  const sid = options.sessionId ?? 'unknown-sid';
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
    import('../../services/solo/dag-orchestrator.js') as Promise<DagOrchestratorModule>,
    import('../../services/dispatch/contract-store.js') as Promise<ContractStoreModule>
  ]);
  const { validateDag, topologicalLevels } = sliceDagMod;
  const { runDag } = dagOrchestratorMod;
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

  // runDag IS in the path: it validates the DAG, iterates all
  // topological levels, runs the join barrier after each level, and
  // triggers cancel-on-fail rollback if any leaf returns `failed` (or
  // `cancelled`, once 1.3 lands). The CLI envelope below filters
  // `emittedToolCalls` / `emittedSliceIds` to the first level — see the
  // `firstLevelIds` filter inside `cliRunner`.
  try {
    await runDag(dag, {
      projectRoot,
      sessionId: sid,
      existingContracts,
      runSlice: cliRunner,
      writeContractFn: noopWriter
    });
  } catch (err) {
    // runDag throws DagPlanError for plan-level failures (e.g. cycle
    // slipping past validateDag). Surface it as INVALID_DAG so the
    // CLI envelope has a clear failure code, not a generic DISPATCH_ERROR.
    printResult(io, fail('sub-agent.dispatch', 'INVALID_DAG', `runDag failed for ${options.fromDag}: ${(err as Error).message}`, { role, toolCall: null, dispatchRecordPath: null } as never, [
      'runDag threw DagPlanError; the DAG passed validateDag() but failed at topologicalLevels or contractStore dispatch.',
      'Inspect the DAG file and re-run.'
    ]), asJson);
    process.exitCode = 1;
    return;
  }

  printResult(io, ok('sub-agent.dispatch', {
    role,
    ide: dispatcher.label,
    fromDag: options.fromDag,
    batchId,
    dispatchCount: emittedSliceIds.length,
    levelsTotal: levelArr.length,
    firstLevel: emittedSliceIds,
    toolCalls: emittedToolCalls,
    existingContractCount: existingContracts.length,
    nextActions: [
      'Execute each toolCall in your IDE; on completion, write the slice contract to .peaks/_runtime/<sid>/dispatch/contracts/<slice-id>.json.',
      'Re-invoke `peaks sub-agent dispatch --from-dag <file>` with the same batch-id to advance to the next level once all current-level slices have written contracts.'
    ]
  }, [], [
    'MVP (1.2) plans the first level via runDag orchestrator (cancel-on-fail path active); the LLM drives subsequent levels by re-invoking this command after contract writes.',
    existingContracts.length > 0
      ? `Injected ${existingContracts.length} upstream contract(s) into downstream-level prompts via formatContractInjection.`
      : 'No upstream contracts found; first-level prompts have empty ancestor blocks.'
  ]), asJson);
}

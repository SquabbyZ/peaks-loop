/**
 * `peaks sub-agent dispatch` — the single-dispatch chokepoint.
 *
 * honor the 800-line file cap (Karpathy #2 Simplicity First). The single
 * `dispatch` action lives here; the `--from-dag` sibling was further split
 * two paths share no logic and the `--from-dag` codepath loads three heavy
 * modules on first call (slice 9 perf) that the warm-path single-dispatch
 * never touches.
 *
 * a primitive that the peaks-code / peaks-rd / peaks-qa SKILL.md compose.
 * Users do NOT invoke it directly; the --help text and dispatch
 * envelope's `nextActions` reinforce the point.
 *
 * This module orchestrates: the option surface, the preflight refusals, the
 * detached/DAG short-circuits and the record+envelope write are here; the lease,
 * the prompt composition and the tool call each own a module.
 */
import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { fail, getErrorMessage } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import type { ContextGuardDecision } from '../../services/context/context-guard.js';
import type { getAdapter } from '../../services/ide/ide-registry.js';
import type { SubAgentToolCall } from '../../services/dispatch/sub-agent-dispatcher.js';
import { type DispatchOptions } from './sub-agent-shared.js';
import { runDispatchFromDag } from './dispatch-from-dag.js';
import { buildDispatchCommandSpec } from './dispatch-command-spec.js';
import { runDetachedDispatch } from './dispatch-detached-branch.js';
import { preflightDispatch } from './dispatch-preflight.js';
import { resolveIsolationLease, type IsolationLease } from './dispatch-isolation-lease.js';
import {
  composeDispatchPrompt,
  type ComposedDispatchPrompt
} from './dispatch-prompt-composition.js';
import { buildDispatchToolCall } from './dispatch-tool-call.js';
import { writeDispatchRecord, type DispatchRecordWrite } from './dispatch-record-write.js';
import {
  emitDispatchEnvelope,
  writeDispatchLogEntry,
  type DispatchContext,
  type DispatchEnvelopeInput
} from './dispatch-envelope.js';

interface ComposePhaseInput {
  prompt: string;
  decision: ContextGuardDecision;
  lease: IsolationLease;
}

interface ToolCallPhaseInput {
  adapter: ReturnType<typeof getAdapter>;
  effectivePrompt: string;
  lease: IsolationLease;
}

interface WriteRecordPhaseInput {
  effectivePrompt: string;
  toolCall: SubAgentToolCall;
  lease: IsolationLease;
  warnings: string[];
}

interface DispatchPipelineInput {
  decision: ContextGuardDecision;
  prompt: string;
  asJson: boolean;
}

function buildDispatchContext(
  options: DispatchOptions,
  role: string,
  asJson: boolean
): DispatchContext {
  const projectRoot = options.project ?? process.cwd();
  // passed, auto-resolve the active peaks session id from
  // `.peaks/_runtime/session.json` (or PEAKS_SESSION_ID env var) so
  // dispatch records land in `.peaks/_sub_agents/<real-sid>/` instead
  // of the `unknown-sid` fallback. The unknown-sid branch is preserved
  // as the last-resort so callers without a bound session (e.g. an
  // ad-hoc dispatch in a fresh tree) still get a deterministic path.
  const sid =
    options.sessionId ??
    process.env.PEAKS_SESSION_ID ??
    getCurrentSessionId(projectRoot) ??
    'unknown-sid';
  const rid = options.requestId ?? 'unknown-rid';
  const batchId = options.batchId ?? randomUUID();
  return { projectRoot, sid, rid, role, batchId, asJson };
}

async function acquireIsolationLease(
  io: ProgramIO,
  options: DispatchOptions,
  ctx: DispatchContext
): Promise<IsolationLease | null> {
  return resolveIsolationLease(io, options, {
    projectRoot: ctx.projectRoot,
    sid: ctx.sid,
    rid: ctx.rid,
    role: ctx.role,
    batchId: ctx.batchId,
    asJson: ctx.asJson
  });
}

async function composePromptPhase(
  io: ProgramIO,
  options: DispatchOptions,
  ctx: DispatchContext,
  input: ComposePhaseInput
): Promise<ComposedDispatchPrompt | null> {
  return composeDispatchPrompt(io, {
    projectRoot: ctx.projectRoot,
    sid: ctx.sid,
    rid: ctx.rid,
    role: ctx.role,
    options,
    prompt: input.prompt,
    isolationMode: input.lease.isolationMode,
    leaseId: input.lease.leaseId,
    worktreePath: input.lease.worktreePath,
    worktreeBranch: input.lease.worktreeBranch,
    decision: input.decision,
    asJson: ctx.asJson
  });
}

function buildToolCallPhase(
  io: ProgramIO,
  ctx: DispatchContext,
  input: ToolCallPhaseInput
): SubAgentToolCall | null {
  return buildDispatchToolCall(io, {
    adapter: input.adapter,
    role: ctx.role,
    effectivePrompt: input.effectivePrompt,
    rid: ctx.rid,
    sid: ctx.sid,
    projectRoot: ctx.projectRoot,
    isolationMode: input.lease.isolationMode,
    leaseId: input.lease.leaseId,
    asJson: ctx.asJson
  });
}

function writeRecordPhase(
  ctx: DispatchContext,
  options: DispatchOptions,
  input: WriteRecordPhaseInput
): DispatchRecordWrite {
  return writeDispatchRecord({
    options,
    projectRoot: ctx.projectRoot,
    sid: ctx.sid,
    rid: ctx.rid,
    role: ctx.role,
    effectivePrompt: input.effectivePrompt,
    toolCall: input.toolCall,
    batchId: ctx.batchId,
    isolationMode: input.lease.isolationMode,
    leaseId: input.lease.leaseId,
    warnings: input.warnings
  });
}

async function runDispatchPipeline(
  io: ProgramIO,
  options: DispatchOptions,
  role: string,
  input: DispatchPipelineInput
): Promise<void> {
  const ctx = buildDispatchContext(options, role, input.asJson);
  const lease = await acquireIsolationLease(io, options, ctx);
  if (lease === null) return;
  const composed = await composePromptPhase(io, options, ctx, {
    prompt: input.prompt,
    decision: input.decision,
    lease
  });
  if (composed === null) return;
  const { adapter, effectivePrompt, warnings, mustLsFilesVerification } = composed;
  const toolCall = buildToolCallPhase(io, ctx, { adapter, effectivePrompt, lease });
  if (toolCall === null) return;
  const { artifactMeta, dispatchRecordPath, counter } = writeRecordPhase(ctx, options, {
    effectivePrompt,
    toolCall,
    lease,
    warnings
  });
  const envelopeInput: DispatchEnvelopeInput = {
    ctx,
    options,
    prompt: input.prompt,
    adapter,
    effectivePrompt,
    toolCall,
    dispatchRecordPath,
    counter,
    decision: input.decision,
    artifactMeta,
    mustLsFilesVerification,
    lease
  };
  emitDispatchEnvelope(io, envelopeInput, warnings, input.asJson);
  writeDispatchLogEntry(ctx, counter.count, input.decision.forcedAt);
}

async function runDispatchAction(
  role: string,
  options: DispatchOptions,
  io: ProgramIO
): Promise<void> {
  const asJson = options.json === true;
  // explicitly requested, lazy-import the detached handler and short-
  // circuit before the warm-path in-process pipeline runs. Branch
  // lives in the existing action handler (NOT a sibling `peaks
  // sub-agent-detached` command) per the slice decision memo:
  //   - 106+ existing dispatch tests reach this exact action path
  //   - Backward compat requires the default (no --mode) to keep
  //     the in-process envelope shape byte-identical
  //   - One validation entry-point reduces double-pipe maintenance
  if (options.mode === 'detached') {
    await runDetachedDispatch(io, role, options, asJson);
    return;
  }
  // 2.7.0 slice-dag-dispatcher MVP: --from-dag short-circuits the single
  // sub-agent path and runs the full DAG plan via `dag-orchestrator`.
  if (typeof options.fromDag === 'string' && options.fromDag.length > 0) {
    await runDispatchFromDag(role, options, asJson, io);
    return;
  }
  const preflight = preflightDispatch(io, role, options, asJson);
  if (preflight === null) return;
  const { decision, prompt } = preflight;

  try {
    await runDispatchPipeline(io, options, role, { decision, prompt, asJson });
  } catch (error: unknown) {
    printResult(
      io,
      fail(
        'sub-agent.dispatch',
        'DISPATCH_ERROR',
        getErrorMessage(error),
        { role, toolCall: null, dispatchRecordPath: null } as never,
        [
          'See error message; if you are dispatching from a SKILL.md, the LLM should retry with a smaller prompt or pick a different role.'
        ]
      ),
      asJson
    );
    process.exitCode = 1;
  }
}

export function registerDispatchCommand(parent: Command, io: ProgramIO): void {
  buildDispatchCommandSpec(parent).action((role: string, options: DispatchOptions) =>
    runDispatchAction(role, options, io)
  );
}

/**
 * 2.7.0 slice-dag-dispatcher MVP — see `dispatch-from-dag.ts`.
 * #7 to honor the 800-line file cap and isolate the three heavy
 * module loads (slice-dag / dag-orchestrator / contract-store) to the
 * --from-dag codepath only.
 */

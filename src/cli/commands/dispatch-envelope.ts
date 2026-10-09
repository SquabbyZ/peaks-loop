// The `peaks sub-agent dispatch` output surface: the envelope `data` record, the
// `nextActions` list, the `printResult` call and the best-effort log line.
// Split out of `dispatch-commands.ts` when compressing its long functions pushed
// that file past the 300-line cap; the bodies are byte-for-byte the originals.
import { ok } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';
import { BATCH_LIMIT } from '../../services/dispatch/batch-counter.js';
import { buildContextImpact, type ArtifactMeta } from '../../services/context/artifact-meta.js';
import type { ContextGuardDecision } from '../../services/context/context-guard.js';
import type { getAdapter } from '../../services/ide/ide-registry.js';
import type { SubAgentToolCall } from '../../services/dispatch/sub-agent-dispatcher.js';
import { writeLogEntry } from '../../services/log/logger.js';
import { type DispatchOptions } from './sub-agent-shared.js';
import { type IsolationLease } from './dispatch-isolation-lease.js';
import { type DispatchRecordWrite } from './dispatch-record-write.js';

export interface DispatchContext {
  projectRoot: string;
  sid: string;
  rid: string;
  role: string;
  batchId: string;
  asJson: boolean;
}

export interface DispatchEnvelopeInput {
  ctx: DispatchContext;
  options: DispatchOptions;
  prompt: string;
  adapter: ReturnType<typeof getAdapter>;
  effectivePrompt: string;
  toolCall: SubAgentToolCall;
  dispatchRecordPath: string;
  counter: DispatchRecordWrite['counter'];
  decision: ContextGuardDecision;
  artifactMeta: ArtifactMeta | null;
  mustLsFilesVerification: { path: string; exists: boolean; files: readonly string[] } | null;
  lease: IsolationLease;
}

function buildDispatchNextActions(
  counter: DispatchRecordWrite['counter'],
  dispatchRecordPath: string
): string[] {
  const nextActions = [
    'Tool call is dry-run; LLM must execute the tool to actually dispatch the sub-agent.',
    'After dispatching, the sub-agent should call `peaks sub-agent heartbeat --record ' +
      dispatchRecordPath +
      '` periodically.'
  ];
  if (counter.warning) {
    nextActions.push(
      `Batch is over the RL-1 limit (${BATCH_LIMIT}); consider splitting into multiple batches.`
    );
  }
  return nextActions;
}

function buildDispatchEnvelopeData(
  input: DispatchEnvelopeInput,
  contextImpact: ReturnType<typeof buildContextImpact>
): Record<string, unknown> {
  const { ctx, options, lease } = input;
  const expectedCompletionSeconds = 45;
  const artifactsPublicPaths =
    typeof options.writeArtifact === 'string' && options.writeArtifact.length > 0
      ? [options.writeArtifact]
      : [];
  const orchestratorVisibleHint = `⏳ Spawning sub-agent via Task tool: ${ctx.role} for rid=${ctx.rid}, batch-id=${ctx.batchId} (ETA ~${expectedCompletionSeconds}s)`;
  return {
    // an envelopeVersion marker so consumers can detect contract
    // changes (the previous #4 dropped `data.prompt` silently).
    envelopeVersion: '2.3.0',
    role: ctx.role,
    ide: input.adapter.subAgentDispatcher.label,
    // Prompts can carry user content (sometimes test credentials /
    // internal URLs) that has no business landing in shell history,
    // log aggregators, or tmux scrollback. The dispatch record on
    // disk (gitignored under .peaks/_sub_agents/) keeps the prompt
    // for the sub-agent to read; CLI stdout stays metadata-only.
    // Surface promptSize + originalPromptSize so the LLM-side
    // runner can reason about the size delta without seeing the
    // content.
    originalPromptSize: input.prompt.length,
    promptSize: input.effectivePrompt.length,
    toolCall: input.toolCall,
    dispatchRecordPath: input.dispatchRecordPath,
    batchId: ctx.batchId,
    dispatchedInBatch: input.counter.count,
    forcedAt: input.decision.forcedAt,
    contextImpact,
    artifactMetas: input.artifactMeta ? [input.artifactMeta] : [],
    orchestratorVisibleHint,
    artifactsPublicPaths,
    expectedCompletionSeconds,
    // Part 2.C: when --isolation worktree, surface the lease
    // handle to the LLM-side runner so it can call
    // `peaks worktree release --lease-id <id>` after the sub-agent
    // finishes (or rely on the next gc pass to clean up). When
    // isolation is not requested, isolation === null.
    isolation: lease.isolationMode,
    leaseId: lease.leaseId,
    worktreePath: lease.worktreePath,
    worktreeBranch: lease.worktreeBranch,
    // F5: anti-fake-green gate envelope surface. When
    // `--must-ls-files <glob>` is supplied this carries the
    // pre-dispatch verification result so the orchestrator can
    // surface "the file exists" (or "missing — block") before
    // spawning the sub-agent. Null when the flag is absent.
    mustLsFilesVerification: input.mustLsFilesVerification
  };
}

export function emitDispatchEnvelope(
  io: ProgramIO,
  input: DispatchEnvelopeInput,
  warnings: string[],
  asJson: boolean
): void {
  const contextImpact = buildContextImpact({
    promptSize: input.effectivePrompt.length,
    artifactSizes: input.artifactMeta ? [input.artifactMeta.size] : []
  });
  const nextActions = buildDispatchNextActions(input.counter, input.dispatchRecordPath);
  printResult(
    io,
    ok(
      'sub-agent.dispatch',
      buildDispatchEnvelopeData(input, contextImpact),
      warnings,
      nextActions
    ),
    asJson
  );
}

export function writeDispatchLogEntry(
  ctx: DispatchContext,
  dispatchedInBatch: number,
  forcedAt: string | null
): void {
  // Best-effort: writeLogEntry swallows its own errors (logger.ts:155-159),
  // so a full disk or missing ~/.peaks/logs/ dir never blocks the dispatch.
  try {
    writeLogEntry({
      ts: new Date().toISOString(),
      level: 'info',
      command: 'sub-agent.dispatch',
      msg: 'dispatched',
      sessionId: ctx.sid,
      batchId: ctx.batchId,
      data: {
        rid: ctx.rid,
        role: ctx.role,
        batchId: ctx.batchId,
        dispatchedInBatch,
        forcedAt
      }
    });
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    /* best-effort */
  }
}

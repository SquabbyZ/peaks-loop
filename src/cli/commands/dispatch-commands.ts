/**
 * `peaks sub-agent dispatch <role> ...` — slice 2026-06-07-sub-agent-context-governance.
 *
 * Pulled out of `sub-agent-commands.ts` (slice 2026-06-23-audit-p0-split) to
 * honor the 800-line file cap (Karpathy #2 Simplicity First). The single
 * `dispatch` action lives here; the `--from-dag` sibling was further split
 * into `dispatch-from-dag.ts` (slice 2026-06-23-audit-3rd #7) because the
 * two paths share no logic and the `--from-dag` codepath loads three heavy
 * modules on first call (slice 9 perf) that the warm-path single-dispatch
 * never touches.
 *
 * Skill-first / CLI-auxiliary red line (PB-4 / AC-19/20): this command is
 * a primitive that the peaks-code / peaks-rd / peaks-qa SKILL.md compose.
 * Users do NOT invoke it directly; the --help text and dispatch
 * envelope's `nextActions` reinforce the point.
 */
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { detectInstalledIde } from '../../services/ide/ide-detector.js';
import { getAdapter } from '../../services/ide/ide-registry.js';
import {
  SubAgentNotSupportedError,
  type SubAgentToolCall
} from '../../services/dispatch/sub-agent-dispatcher.js';
import {
  emitObservabilityEvent,
  OBSERVABILITY_SUBAGENT_ROLES,
  type ObservabilitySubagentRole
} from '../../services/observability/observability-service.js';
import { noteDispatched, BATCH_LIMIT } from '../../services/dispatch/batch-counter.js';
import { writeInitialDispatchRecord } from '../../services/dispatch/dispatch-record-writer.js';
import { evaluatePromptSize } from '../../services/context/context-guard.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import { buildArtifactMeta, buildContextImpact, type ArtifactMeta } from '../../services/context/artifact-meta.js';
import { assertSafeArtifactPath } from '../../services/context/dispatch-context-guard.js';
import { compressPrompt, type HeadroomResult } from '../../services/context/headroom-client.js';
import { resolveHeadroomOptions } from '../../services/context/headroom-prefs.js';
import { loadPreferences } from '../../services/preferences/preferences-service.js';
import { DEFAULT_PREFERENCES } from '../../services/preferences/preferences-types.js';
import { writeLogEntry } from '../../services/log/logger.js';
import {
  DispatchOptions,
  HEADROOM_MODES,
  PROMPT_LIMIT_BYTES,
  RECOMMENDED_ROLES,
  validateRole
} from './sub-agent-shared.js';
import { runDispatchFromDag } from './dispatch-from-dag.js';
import {
  TEST_TOOL_DETECTION_BLOCK,
  formatTestToolDetection
} from '../../services/dispatch/test-tool-detection.js';

export function registerDispatchCommand(parent: Command, io: ProgramIO): void {
  addJsonOption(
    parent
      .command('dispatch')
      .description(
        'Build an IDE-specific tool-call descriptor for a sub-agent dispatch. ' +
        'Dry-run by design; the LLM executes the returned toolCall in its own ' +
        'environment. Flags: --write-artifact (G7), --use-headroom (G7.7), ' +
        '--force (G9 CLI 兜底). ' +
        'See skills/peaks-code/references/sub-agent-dispatch.md for the ' +
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
      .option('--session-id <sid>', 'override active session id (default: resolve from .peaks/_runtime/session.json; falls back to PEAKS_SESSION_ID env var; final fallback "unknown-sid")')
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
    // Slice 3 (on-demand-ecc) D-012: the `agent` role was removed in
    // 4.0.0-beta.11 — there is no longer a subprocess path for it
    // (the upstream ECC v2.0.0 ships no `ecc` binary). This guard
    // sits AFTER role validation but BEFORE the missing-prompt
    // check so an action-path dispatch with a valid prompt still
    // returns a clear ROLE_REMOVED envelope + exit 1. Note that
    // Commander short-circuits `--help` BEFORE `.action()` fires,
    // so `peaks sub-agent dispatch agent --help` continues to
    // exit 0 with the help text — that is intentional, not a bug.
    if (role === 'agent') {
      printResult(io, fail('sub-agent.dispatch', 'ROLE_REMOVED',
        'The agent role was removed in Slice 3',
        { role, reason: 'role-removed-in-slice-3', toolCall: null, dispatchRecordPath: null } as never, []), asJson);
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
    if (options.prompt.length + TEST_TOOL_DETECTION_BLOCK.length > PROMPT_LIMIT_BYTES) {
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
      // Slice 2026-06-26-unknown-sid-fallback-fix: when --session-id is not
      // passed, auto-resolve the active peaks session id from
      // `.peaks/_runtime/session.json` (or PEAKS_SESSION_ID env var) so
      // dispatch records land in `.peaks/_sub_agents/<real-sid>/` instead
      // of the `unknown-sid` fallback. The unknown-sid branch is preserved
      // as the last-resort so callers without a bound session (e.g. an
      // ad-hoc dispatch in a fresh tree) still get a deterministic path.
      const sid = options.sessionId
        ?? process.env.PEAKS_SESSION_ID
        ?? getCurrentSessionId(projectRoot)
        ?? 'unknown-sid';
      const rid = options.requestId ?? 'unknown-rid';
      const batchId = options.batchId ?? randomUUID();

      // G7.7 / G9: resolve headroom options from preferences + CLI overrides.
      // Preferences hard-block when headroom.enabled=false (returns HEADROOM_DISABLED_BY_PREFERENCE).
      // loadPreferences can throw on schema mismatch; we fall back to defaults to avoid
      // breaking the dispatch on a stale preferences.json file.
      let headroomPrefs = DEFAULT_PREFERENCES.headroom;
      try {
        headroomPrefs = loadPreferences(projectRoot).headroom;
      } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
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
      let effectivePrompt = `${formatTestToolDetection()}\n\n${options.prompt}`;
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
        // Slice C of v2.11.1 — observability hook #2/7. Fire-and-forget
        // per PRD Q4 (full-auto must never fail-loud). The
        // synchronous emit returns {written:false} on disk-full; we
        // deliberately swallow the result so dispatch contract is
        // unchanged. role is only included when it matches the schema's
        // known sub-agent role set; otherwise it's omitted (non-standard
        // roles like 'qa-business' would otherwise drop the event
        // through schema rejection).
        const KNOWN_ROLES: ReadonlySet<string> = new Set(OBSERVABILITY_SUBAGENT_ROLES);
        const knownRole: ObservabilitySubagentRole | null = KNOWN_ROLES.has(role) ? role as ObservabilitySubagentRole : null;
        emitObservabilityEvent({
          schemaVersion: 1,
          ts: new Date().toISOString(),
          sessionId: sid,
          category: 'dispatch',
          ...(knownRole !== null ? { role: knownRole } : {}),
          detail: {
            requestId: rid,
            ide: adapter.subAgentDispatcher.label,
            promptBytes: effectivePrompt.length,
            headroomCompressed
          }
        }, { projectRoot });
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
        // Slice 2026-06-23-audit-4th #E1: every CLI envelope carries
        // an envelopeVersion marker so consumers can detect contract
        // changes (the previous #4 dropped `data.prompt` silently).
        envelopeVersion: '2.2.0',
        role,
        ide: adapter.subAgentDispatcher.label,
        // Slice 2026-06-23-audit-3rd #4: do NOT echo `prompt` in stdout.
        // Prompts can carry user content (sometimes test credentials /
        // internal URLs) that has no business landing in shell history,
        // log aggregators, or tmux scrollback. The dispatch record on
        // disk (gitignored under .peaks/_sub_agents/) keeps the prompt
        // for the sub-agent to read; CLI stdout stays metadata-only.
        // Surface promptSize + originalPromptSize so the LLM-side
        // runner can still reason about headroom without seeing the
        // content.
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
      // Slice 2026-06-23-audit-4th #B1: structured log on success path.
      // Best-effort: writeLogEntry swallows its own errors (logger.ts:155-159),
      // so a full disk or missing ~/.peaks/logs/ dir never blocks the dispatch.
      try {
        writeLogEntry({
          ts: new Date().toISOString(),
          level: 'info',
          command: 'sub-agent.dispatch',
          msg: 'dispatched',
          sessionId: sid,
          batchId,
          data: {
            rid,
            role,
            batchId,
            dispatchedInBatch: counter.count,
            headroomCompressed,
            forcedAt: decision.forcedAt
          }
        });
      } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
        /* best-effort */
      }
    } catch (error: unknown) {
      printResult(io, fail('sub-agent.dispatch', 'DISPATCH_ERROR', getErrorMessage(error), { role, toolCall: null, dispatchRecordPath: null } as never, [
        'See error message; if you are dispatching from a SKILL.md, the LLM should retry with a smaller prompt or pick a different role.'
      ]), asJson);
      process.exitCode = 1;
    }
  });
}

/**
 * 2.7.0 slice-dag-dispatcher MVP — see `dispatch-from-dag.ts`.
 * The function was pulled out of this file in slice 2026-06-23-audit-3rd
 * #7 to honor the 800-line file cap and isolate the three heavy
 * module loads (slice-dag / dag-orchestrator / contract-store) to the
 * --from-dag codepath only.
 */

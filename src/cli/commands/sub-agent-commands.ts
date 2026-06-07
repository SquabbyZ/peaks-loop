/**
 * `peaks sub-agent` CLI commands — slice 2026-06-07-sub-agent-context-governance.
 *
 * Five sub-commands live in this file:
 *   1. `dispatch <role>` — G2 + G7 + G7.7 + G9: emit a per-IDE tool-call
 *      descriptor. New flags: --write-artifact (G7), --use-headroom
 *      (G7.7/G9), --force (G9 CLI 兜底).
 *   2. `heartbeat --record <path> ...` — G6: append a heartbeat.
 *   3. `share --batch ... --key ... --value ...` — G8.4: write a shared
 *      channel entry (dispatcher-mediated cross sub-agent signal).
 *   4. `shared-read --batch ...` — G8.4: read sibling shared entries.
 *   5. (reserved) `list / show / gc` — G5.3 RL-10: stub for future
 *      slices.
 *
 * Skill-first / CLI-auxiliary red line (PB-4 / AC-19/20):
 *   These commands are primitives that the peaks-solo / peaks-rd /
 *   peaks-qa SKILL.md compose. Users do NOT invoke them directly. The
 *   --help text is explicit about this; the dispatch envelope's
 *   `nextActions` reinforces the point.
 */
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { fail, getErrorMessage, ok } from '../../shared/result.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { detectInstalledIde } from '../../services/ide/ide-detector.js';
import { getAdapter } from '../../services/ide/ide-registry.js';
import {
  SubAgentNotSupportedError,
  type SubAgentRole,
  type SubAgentToolCall
} from '../../services/dispatch/sub-agent-dispatcher.js';
import { noteDispatched, readBatchCount, BATCH_OVER_LIMIT_CODE, BATCH_LIMIT } from '../../services/dispatch/batch-counter.js';
import {
  appendHeartbeat,
  writeInitialDispatchRecord,
  type HeartbeatStatus
} from '../../services/dispatch/dispatch-record-writer.js';
import { assertSafeDispatchRecordPath } from '../../services/security/safe-settings-path.js';
import { evaluatePromptSize } from '../../services/context/context-guard.js';
import {
  buildArtifactMeta,
  buildContextImpact,
  type ArtifactMeta
} from '../../services/context/artifact-meta.js';
import { assertSafeArtifactPath } from '../../services/context/dispatch-context-guard.js';
import { compressPrompt, type HeadroomMode, type HeadroomResult } from '../../services/context/headroom-client.js';
import {
  readSharedChannel,
  writeSharedEntry,
  SHARED_CHANNEL_SOFT_VALUE_WARN
} from '../../services/context/shared-channel.js';

const RECOMMENDED_ROLES = 'rd | qa | ui | txt | qa-business | qa-perf | qa-security | qa-business-<*> | general-purpose';

type DispatchOptions = {
  prompt?: string;
  promptLength?: string;
  requestId?: string;
  sessionId?: string;
  project?: string;
  batchId?: string;
  writeArtifact?: string;
  useHeadroom?: boolean;
  headroomMode?: string;
  force?: boolean;
  json?: boolean;
};

type HeartbeatOptions = {
  record?: string;
  status?: string;
  progress?: string;
  note?: string;
  json?: boolean;
};

type ShareOptions = {
  batch?: string;
  key?: string;
  value?: string;
  from?: string;
  requestId?: string;
  sessionId?: string;
  project?: string;
  json?: boolean;
};

type SharedReadOptions = {
  batch?: string;
  since?: string;
  key?: string;
  requestId?: string;
  sessionId?: string;
  project?: string;
  json?: boolean;
};

const HEARTBEAT_STATUSES: readonly HeartbeatStatus[] = [
  'queued', 'running', 'finalizing', 'done', 'failed', 'stale'
];

const PROMPT_LIMIT_BYTES = 256 * 1024;
const HEADROOM_MODES: readonly HeadroomMode[] = ['balanced', 'aggressive', 'conservative'];

export function registerSubAgentCommands(program: Command, io: ProgramIO): void {
  const subAgent = program
    .command('sub-agent')
    .description(
      'Sub-agent dispatch primitive (skill-first / CLI-auxiliary). ' +
      'These commands are the primitives that peaks-solo / peaks-rd / ' +
      'peaks-qa SKILL.md compose. Users do not invoke this directly.'
    );

  // ─────────────────────────────────────────────────────────────────
  // peaks sub-agent dispatch <role> --prompt ... --json
  // ─────────────────────────────────────────────────────────────────
  addJsonOption(
    subAgent
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
      .requiredOption('--prompt <text>', 'the prompt to send to the sub-agent')
      .option('--prompt-length <bytes>', 'DOGFOOD ONLY: synthesize a prompt of this size (overrides --prompt content for size only; content is "x" repeated)')
      .option('--request-id <rid>', 'the same <rid> used by peaks request init')
      .option('--session-id <sid>', 'override active session id (default: peaks session info --active)')
      .option('--project <path>', 'target project root (defaults to cwd)')
      .option('--batch-id <uuid>', 'batch id for the dispatch (default: auto-generated UUID)')
      .option('--write-artifact <path>', 'G7: register an artifact file at <path>; CLI computes sha256 + size + writes ArtifactMeta to the dispatch record')
      .option('--use-headroom', 'G7.7/G9: compress the prompt via headroom-ai before dispatch (opt-in; falls back to G7 metadata-only if headroom unavailable)')
      .option('--headroom-mode <mode>', `G7.7: headroom mode (${HEADROOM_MODES.join(' | ')}); default balanced`)
      .option('--force', 'G9: override the 80% hard reject threshold at CLI (NOT allowed at hook layer per RL-30 strict)')
  ).action(async (role: string, options: DispatchOptions) => {
    const asJson = options.json === true;
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
      printResult(io, fail('sub-agent.dispatch', 'MISSING_PROMPT', '--prompt is required', { role, toolCall: null, dispatchRecordPath: null } as never, [
        'Re-run with a non-empty --prompt value.'
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

      if (options.useHeadroom === true) {
        const mode: HeadroomMode = isHeadroomMode(options.headroomMode) ? options.headroomMode : 'balanced';
        headroomResult = await compressPrompt(effectivePrompt, mode);
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

  // ─────────────────────────────────────────────────────────────────
  // peaks sub-agent heartbeat --record <path> --status <state> --progress <pct> --json
  // ─────────────────────────────────────────────────────────────────
  addJsonOption(
    subAgent
      .command('heartbeat')
      .description(
        'Append a heartbeat entry to a dispatch record. Fire-and-forget: ' +
        'the parent Dispatcher polls this record during the batch-sync ' +
        'wait and renders a status line. Sub-agents should call this at ' +
        'least every 30s (configurable via SKILL.md heartbeatIntervalSec).'
      )
      .requiredOption('--record <path>', 'absolute path to a dispatch record JSON')
      .requiredOption('--status <state>', 'queued | running | finalizing | done | failed | stale')
      .requiredOption('--progress <pct>', 'integer 0-100')
      .option('--note <text>', 'free-form progress note (≤ 200 chars)')
  ).action((options: HeartbeatOptions) => {
    const asJson = options.json === true;
    if (!options.record || !existsSync(options.record)) {
      printResult(io, fail('sub-agent.heartbeat', 'INVALID_RECORD_PATH', `record not found: ${options.record ?? '(empty)'}`, { recordPath: options.record ?? null, truncated: false } as never, [
        'Pass the absolute path from the `peaks sub-agent dispatch` envelope.'
      ]), asJson);
      process.exitCode = 1;
      return;
    }
    if (!HEARTBEAT_STATUSES.includes(options.status as HeartbeatStatus)) {
      printResult(io, fail('sub-agent.heartbeat', 'INVALID_STATUS', `--status must be one of ${HEARTBEAT_STATUSES.join(' | ')} (got ${options.status})`, { recordPath: options.record, truncated: false } as never, [
        'Use one of the documented statuses; poller compares lastBeatAt against now() - 5min to set `stale`.'
      ]), asJson);
      process.exitCode = 1;
      return;
    }
    const progress = Number.parseInt(options.progress ?? 'NaN', 10);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
      printResult(io, fail('sub-agent.heartbeat', 'INVALID_PROGRESS', `--progress must be integer 0-100 (got ${options.progress})`, { recordPath: options.record, truncated: false } as never, [
        'Use 0..100 inclusive.'
      ]), asJson);
      process.exitCode = 1;
      return;
    }
    if (options.note !== undefined && options.note.length > 200) {
      printResult(io, fail('sub-agent.heartbeat', 'NOTE_TOO_LONG', `--note must be ≤ 200 chars (got ${options.note.length})`, { recordPath: options.record, truncated: false } as never, [
        'Shorten the note; the record file is not a log file.'
      ]), asJson);
      process.exitCode = 1;
      return;
    }

    try {
      // R-2 guard: ensure the path lives under `.peaks/_sub_agents/`.
      assertSafeDispatchRecordPath(options.record, deriveProjectRoot(options.record));
      const result = appendHeartbeat({
        recordPath: options.record as string,
        status: options.status as HeartbeatStatus,
        progress,
        ...(options.note !== undefined ? { note: options.note } : {})
      });
      printResult(io, ok('sub-agent.heartbeat', {
        recordPath: options.record,
        heartbeatCount: result.record.heartbeats.length,
        lastBeatAt: result.record.lastBeatAt,
        status: result.record.status,
        truncated: result.truncated
      }, [], ['Continue business logic; heartbeat is fire-and-forget.']), asJson);
    } catch (error: unknown) {
      const code = (error as { code?: string }).code ?? 'HEARTBEAT_ERROR';
      printResult(io, fail('sub-agent.heartbeat', code, getErrorMessage(error), { recordPath: options.record ?? null, truncated: false } as never, [
        'See error message; if the record file is missing or corrupted, the parent Dispatcher will mark the sub-agent as stale after 5 minutes.'
      ]), asJson);
      process.exitCode = 1;
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // peaks sub-agent share --batch <batchId> --key <k> --value <json> --json
  // G8.4: cross sub-agent shared channel write.
  // ─────────────────────────────────────────────────────────────────
  addJsonOption(
    subAgent
      .command('share')
      .description(
        'G8.4: write a shared entry to the cross sub-agent shared channel. ' +
        'Dispatcher-mediated indirect signal: sub-agent A writes, dispatcher ' +
        'stores, sub-agent B (still in flight) reads via `peaks sub-agent ' +
        'shared-read`. Not peer-to-peer; pseudo-swarm property 3 preserved.'
      )
      .requiredOption('--batch <batchId>', 'batchId (from `peaks sub-agent dispatch` envelope)')
      .requiredOption('--key <k>', 'entry key (convention: "<role>.<event>")')
      .requiredOption('--value <json>', 'JSON object value (≤ 1KB soft warn, ≥ 64KB rejected)')
      .option('--from <role>', 'sub-agent role string; defaults to dispatch record role if available')
      .option('--request-id <rid>', 'request id (default: "unknown-rid")')
      .option('--session-id <sid>', 'session id (default: "unknown-sid")')
      .option('--project <path>', 'target project root (defaults to cwd)')
  ).action((options: ShareOptions) => {
    const asJson = options.json === true;
    if (!options.batch || !options.key || !options.value) {
      printResult(io, fail('sub-agent.share', 'MISSING_ARG', '--batch, --key, and --value are required', { ok: false } as never, [
        'Re-run with --batch <batchId> --key <key> --value <jsonObject>.'
      ]), asJson);
      process.exitCode = 1;
      return;
    }
    let parsedValue: Record<string, unknown>;
    try {
      const parsed = JSON.parse(options.value) as unknown;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('value must be a JSON object');
      }
      parsedValue = parsed as Record<string, unknown>;
    } catch (err) {
      printResult(io, fail('sub-agent.share', 'INVALID_VALUE', `value must be a JSON object: ${getErrorMessage(err)}`, { ok: false } as never, [
        'Pass --value as a JSON object literal, e.g. --value \'{"reason":"x"}\'.'
      ]), asJson);
      process.exitCode = 1;
      return;
    }

    try {
      const projectRoot = options.project ?? process.cwd();
      const sid = options.sessionId ?? 'unknown-sid';
      const rid = options.requestId ?? 'unknown-rid';
      const from = options.from ?? 'unknown-role';

      const result = writeSharedEntry({
        projectRoot,
        sid,
        rid,
        batchId: options.batch,
        key: options.key,
        from,
        value: parsedValue
      });

      if (!result.ok) {
        const code = result.code;
        printResult(io, fail('sub-agent.share', code, result.message, { ok: false, batchId: options.batch } as never, [
          code === 'VALUE_TOO_LARGE'
            ? 'Reduce value size; 1KB is a soft warning, 64KB is a hard reject.'
            : 'See error message; check --batch, --key, --value arguments.'
        ]), asJson);
        process.exitCode = 1;
        return;
      }

      const warnings: string[] = [];
      if (result.lastWriteWins) {
        warnings.push('LAST_WRITE_WINS');
      }
      if (result.softWarning) {
        warnings.push(`VALUE_SIZE_SOFT_WARN: ${result.entry.valueSize} > ${SHARED_CHANNEL_SOFT_VALUE_WARN} bytes`);
      }

      printResult(io, ok('sub-agent.share', {
        ok: true,
        batchId: options.batch,
        entryKey: options.key,
        writtenAt: result.entry.at,
        channelSize: result.channelSize,
        lastWriteWins: result.lastWriteWins,
        valueSize: result.entry.valueSize
      }, warnings, [
        'Sub-agents in the same batch can read this entry via `peaks sub-agent shared-read --batch ' + options.batch + '`.'
      ]), asJson);
    } catch (error: unknown) {
      const code = (error as { code?: string }).code ?? 'SHARE_ERROR';
      printResult(io, fail('sub-agent.share', code, getErrorMessage(error), { ok: false, batchId: options.batch } as never, [
        'See error message; check that the path lives under .peaks/_sub_agents/<sid>/shared/.'
      ]), asJson);
      process.exitCode = 1;
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // peaks sub-agent shared-read --batch <batchId> --json
  // G8.4: cross sub-agent shared channel read.
  // ─────────────────────────────────────────────────────────────────
  addJsonOption(
    subAgent
      .command('shared-read')
      .description(
        'G8.4: read entries from the cross sub-agent shared channel. ' +
        'Returns sibling sub-agent status. Supports --since (ISO8601) ' +
        'and --key (glob pattern with * wildcard).'
      )
      .requiredOption('--batch <batchId>', 'batchId (from `peaks sub-agent dispatch` envelope)')
      .option('--since <iso>', 'only return entries written after this ISO8601 timestamp')
      .option('--key <pattern>', 'glob pattern, e.g. "rd.*" or "*.completed"')
      .option('--request-id <rid>', 'request id (default: "unknown-rid")')
      .option('--session-id <sid>', 'session id (default: "unknown-sid")')
      .option('--project <path>', 'target project root (defaults to cwd)')
  ).action((options: SharedReadOptions) => {
    const asJson = options.json === true;
    if (!options.batch) {
      printResult(io, fail('sub-agent.shared-read', 'MISSING_BATCH', '--batch is required', { ok: false } as never, [
        'Re-run with --batch <batchId>.'
      ]), asJson);
      process.exitCode = 1;
      return;
    }
    try {
      const projectRoot = options.project ?? process.cwd();
      const sid = options.sessionId ?? 'unknown-sid';
      const rid = options.requestId ?? 'unknown-rid';
      const channel = readSharedChannel({
        projectRoot,
        sid,
        rid,
        batchId: options.batch,
        ...(options.since !== undefined ? { since: options.since } : {}),
        ...(options.key !== undefined ? { keyPattern: options.key } : {})
      });
      printResult(io, ok('sub-agent.shared-read', {
        ok: true,
        batchId: options.batch,
        entries: channel.entries,
        totalEntries: Object.keys(channel.entries).length,
        channelSize: JSON.stringify(channel).length,
        updatedAt: channel.updatedAt
      }, [], [
        'Shared channel is dispatcher-mediated; do not attempt to read sibling dispatch records directly.'
      ]), asJson);
    } catch (error: unknown) {
      const code = (error as { code?: string }).code ?? 'SHARED_READ_ERROR';
      printResult(io, fail('sub-agent.shared-read', code, getErrorMessage(error), { ok: false, batchId: options.batch } as never, [
        'See error message; check that the batchId matches the dispatch envelope.'
      ]), asJson);
      process.exitCode = 1;
    }
  });
}

/** Validate a role string. Returns null if valid, otherwise the rejection reason. */
export function validateRole(role: string): string | null {
  if (typeof role !== 'string' || role.length === 0) {
    return 'role must be a non-empty string';
  }
  if (role.length > 256) {
    return 'role must be ≤ 256 chars';
  }
  for (let i = 0; i < role.length; i += 1) {
    const code = role.charCodeAt(i);
    if (code <= 0x20 || code === 0x7F) {
      return 'role must not contain whitespace or control characters';
    }
  }
  return null;
}

function isHeadroomMode(value: string | undefined): value is HeadroomMode {
  if (typeof value !== 'string') return false;
  return (HEADROOM_MODES as readonly string[]).includes(value);
}

/** Best-effort project root derivation for the R-2 path guard. */
function deriveProjectRoot(recordPath: string): string {
  const parts = recordPath.split(/[\\/]/);
  const idx = parts.lastIndexOf('.peaks');
  if (idx <= 0) {
    return process.cwd();
  }
  return parts.slice(0, idx).join('/') || '/';
}

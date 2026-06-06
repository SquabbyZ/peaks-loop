/**
 * `peaks sub-agent` CLI commands — slice 2026-06-07-sub-agent-dispatch-decouple.
 *
 * Three sub-commands live in this file:
 *   1. `dispatch <role>` — G2: emit a per-IDE tool-call descriptor that
 *      the LLM should execute in its environment. Dry-run by design;
 *      the LLM is the one that actually invokes the tool.
 *   2. `heartbeat --record <path> ...` — G6: append a heartbeat to a
 *      dispatch record. Fire-and-forget from the LLM's perspective.
 *   3. (reserved) `list / show / gc` — G5.3 RL-10: stub for future
 *      slices. The current slice does NOT implement them (intentional);
 *      the per-record lifecycle fields are populated so a future
 *      `peaks sub-agent list` can read them with no schema change.
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

const RECOMMENDED_ROLES = 'rd | qa | ui | txt | qa-business | qa-perf | qa-security | qa-business-<*> | general-purpose';

type DispatchOptions = {
  prompt?: string;
  requestId?: string;
  sessionId?: string;
  project?: string;
  batchId?: string;
  json?: boolean;
};

type HeartbeatOptions = {
  record?: string;
  status?: string;
  progress?: string;
  note?: string;
  json?: boolean;
};

const HEARTBEAT_STATUSES: readonly HeartbeatStatus[] = [
  'queued', 'running', 'finalizing', 'done', 'failed', 'stale'
];

const PROMPT_LIMIT_BYTES = 256 * 1024;

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
        'environment. Soft whitelist, not hard validation: CLI accepts any ' +
        'non-empty role string; recommended roles: ' + RECOMMENDED_ROLES + '. ' +
        'See skills/peaks-solo/references/sub-agent-dispatch.md for the ' +
        'orchestrator contract.'
      )
      .argument('<role>', 'sub-agent role (e.g. rd | qa | ui | txt | qa-business | qa-business-api)')
      .requiredOption('--prompt <text>', 'the prompt to send to the sub-agent')
      .option('--request-id <rid>', 'the same <rid> used by peaks request init')
      .option('--session-id <sid>', 'override active session id (default: peaks session info --active)')
      .option('--project <path>', 'target project root (defaults to cwd)')
      .option('--batch-id <uuid>', 'batch id for the dispatch (default: auto-generated UUID)')
  ).action((role: string, options: DispatchOptions) => {
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
    if (options.prompt.length > PROMPT_LIMIT_BYTES) {
      printResult(io, fail('sub-agent.dispatch', 'PROMPT_TOO_LARGE', `prompt exceeds ${PROMPT_LIMIT_BYTES} bytes (got ${options.prompt.length})`, { role, toolCall: null, dispatchRecordPath: null } as never, [
        'Truncate the prompt or split into multiple dispatches.'
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

      let toolCall: SubAgentToolCall;
      try {
        toolCall = adapter.subAgentDispatcher.buildToolCall({ role, prompt: options.prompt, requestId: rid, sessionId: sid });
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

      const { path: dispatchRecordPath } = writeInitialDispatchRecord({
        projectRoot,
        sessionId: sid,
        requestId: rid,
        role,
        prompt: options.prompt,
        toolCall,
        batchId
      });
      const counter = noteDispatched(projectRoot, sid, batchId);
      const warnings: string[] = [];
      if (counter.warning) {
        warnings.push(counter.warning.message);
      }
      const nextActions = [
        'Tool call is dry-run; LLM must execute the tool to actually dispatch the sub-agent.',
        'After dispatching, the sub-agent should call `peaks sub-agent heartbeat --record ' + dispatchRecordPath + '` periodically.'
      ];
      if (counter.warning) {
        nextActions.push(`Batch is over the RL-1 limit (${BATCH_LIMIT}); consider splitting into multiple batches.`);
      }
      printResult(io, ok('sub-agent.dispatch', {
        role,
        ide: adapter.subAgentDispatcher.label,
        prompt: options.prompt,
        toolCall,
        dispatchRecordPath,
        batchId,
        dispatchedInBatch: counter.count
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
}

/** Validate a role string. Returns null if valid, otherwise the rejection reason. */
export function validateRole(role: string): string | null {
  if (typeof role !== 'string' || role.length === 0) {
    return 'role must be a non-empty string';
  }
  if (role.length > 256) {
    return 'role must be ≤ 256 chars';
  }
  // Reject whitespace and control characters. Per G3 AC-10: "角色名合法但空白
  // 字符串或含非法控制字符 → INVALID_ROLE". The role is a CLI identifier, so
  // any whitespace is suspicious (likely a quoting bug from the caller).
  for (let i = 0; i < role.length; i += 1) {
    const code = role.charCodeAt(i);
    if (code <= 0x20 || code === 0x7F) {
      return 'role must not contain whitespace or control characters';
    }
  }
  return null;
}

/** Best-effort project root derivation for the R-2 path guard. */
function deriveProjectRoot(recordPath: string): string {
  // recordPath looks like `<root>/.peaks/_sub_agents/<sid>/dispatch-<rid>-<ts>.json`.
  // We need the root to feed the guard. Walk up to find the first segment
  // matching `.peaks` and use its parent.
  const parts = recordPath.split(/[\\/]/);
  const idx = parts.lastIndexOf('.peaks');
  if (idx <= 0) {
    return process.cwd();
  }
  return parts.slice(0, idx).join('/') || '/';
}

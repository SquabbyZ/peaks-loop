/**
 * `peaks sub-agent heartbeat` — G6: append a heartbeat to a dispatch record.
 *
 * Pulled out of `sub-agent-commands.ts` (slice 2026-06-23-audit-p0-split)
 * to honor the 800-line file cap. The heartbeat is fire-and-forget; the
 * parent Dispatcher polls the record during the batch-sync wait and
 * renders a status line. Sub-agents should call this at least every
 * 30s (configurable via SKILL.md heartbeatIntervalSec).
 *
 * R-2 path guard: `assertSafeDispatchRecordPath` ensures the record
 * lives under `.peaks/_sub_agents/` so a malicious `--record` arg can't
 * point at a sensitive file outside the runtime tree.
 */
import { existsSync } from 'node:fs';
import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from '../../shared/result.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { appendHeartbeat, type HeartbeatStatus } from '../../services/dispatch/dispatch-record-writer.js';
import { assertSafeDispatchRecordPath } from '../../services/security/safe-settings-path.js';
import { writeLogEntry } from '../../services/log/logger.js';
import {
  HeartbeatOptions,
  HEARTBEAT_STATUSES
} from './sub-agent-shared.js';

export function registerHeartbeatCommand(parent: Command, io: ProgramIO): void {
  addJsonOption(
    parent
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
      .option('--project <path>', 'trusted project root (defaults to cwd); used for the R-2 path guard so a malicious --record cannot point at another project\'s dispatch record')
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
      // R-2 guard (slice 2026-06-23-audit-3rd): trust --project or process.cwd(),
      // NOT the --record path. deriveProjectRoot(recordPath) walked the path
      // itself, which let an attacker point --record at any other project's
      // .peaks/_sub_agents/ tree and slip past the guard. The relative()
      // backstop still applies — the record must live under the trusted
      // root's .peaks/_sub_agents/ subdir.
      const trustedRoot = options.project ?? process.cwd();
      assertSafeDispatchRecordPath(options.record, trustedRoot);
      const result = appendHeartbeat({
        recordPath: options.record as string,
        status: options.status as HeartbeatStatus,
        progress,
        ...(options.note !== undefined ? { note: options.note } : {})
      });
      printResult(io, ok('sub-agent.heartbeat', {
        // Slice 2026-06-23-audit-4th #E1: envelopeVersion marker
        envelopeVersion: '2.1.0',
        recordPath: options.record,
        heartbeatCount: result.record.heartbeats.length,
        lastBeatAt: result.record.lastBeatAt,
        status: result.record.status,
        truncated: result.truncated
      }, [], ['Continue business logic; heartbeat is fire-and-forget.']), asJson);
      // Slice 2026-06-23-audit-4th #B1: structured log on success.
      try {
        writeLogEntry({
          ts: new Date().toISOString(),
          level: 'info',
          command: 'sub-agent.heartbeat',
          msg: 'heartbeat',
          batchId: result.record.batchId,
          data: {
            recordPath: options.record,
            status: result.record.status,
            heartbeatCount: result.record.heartbeats.length,
            truncated: result.truncated
          }
        });
      } catch {
        /* best-effort */
      }
    } catch (error: unknown) {
      const code = (error as { code?: string }).code ?? 'HEARTBEAT_ERROR';
      printResult(io, fail('sub-agent.heartbeat', code, getErrorMessage(error), { recordPath: options.record ?? null, truncated: false } as never, [
        heartbeatErrorNextActions(code)
      ]), asJson);
      process.exitCode = 1;
    }
  });
}

/**
 * Slice 2026-06-23-audit-3rd #9: branch nextActions on `error.code` so
 * the LLM-side runner gets a specific hint instead of the generic
 * "see error message" fallback.
 */
function heartbeatErrorNextActions(code: string): string {
  if (code === 'LOCK_TIMEOUT') {
    return 'A concurrent writer (markCompleted or another heartbeat) holds the record lock for >5s; retry, or check for a crashed holder (the .lock file is reaped after 30s).';
  }
  if (code === 'RECORD_NOT_FOUND') {
    return 'The dispatch record does not exist on disk. Re-run `peaks sub-agent dispatch <role>` to materialize a fresh record path; the previous batch may have been garbage-collected.';
  }
  if (code === 'INVALID_RECORD_JSON') {
    return 'The record file is corrupted (truncated mid-write or hand-edited). Delete it and re-run `peaks sub-agent dispatch`; the parent Dispatcher will treat this as a fresh dispatch.';
  }
  if (code === 'INVALID_PROGRESS' || code === 'NOTE_TOO_LONG') {
    return 'Pass --progress as integer 0..100 and --note as ≤ 200 chars. Both are validated by the CLI before reaching the writer.';
  }
  return 'See error message; if the record file is missing or corrupted, the parent Dispatcher will mark the sub-agent as stale after 5 minutes.';
}

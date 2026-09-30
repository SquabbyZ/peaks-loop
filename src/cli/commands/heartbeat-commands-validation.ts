/**
 * Argument checks and failure envelopes for `peaks sub-agent heartbeat`.
 *
 * Extracted VERBATIM from `heartbeat-commands.ts` (job strict-remediation-abc,
 * slice c1-eslint-family-sweep, leaf c1w1-heartbeat-commands) so the
 * registration file clears the 300-line cap and the `max-lines-per-function` /
 * `complexity` findings that sat on the commander action arrow fell with it.
 * This module holds the checks that REJECT; the write path is
 * `heartbeat-commands-action.ts`.
 *
 * Nothing was restructured: the predicates, their order (status → progress →
 * note, after the record-existence guard and before the R-2 path guard), the
 * message, hint and exit code of every reject, and the rule that a typo'd
 * `--stage` is only reported once the record path has already been accepted as
 * safe are the code that was already there. No check here swallows anything and
 * none answers for the absence of data.
 */
import { fail } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';
import type { HeartbeatStatus } from '../../services/dispatch/dispatch-record-writer.js';
import { NOTE_MAX_CHARS } from '../../services/dispatch/dispatch-record-types.js';
import { isStageLabel, type StageLabel } from '../../services/dispatch/stage-enum.js';
import { HEARTBEAT_STATUSES, type HeartbeatOptions } from './sub-agent-shared.js';

/** `heartbeat` as commander hands it to the action (`--stage` is still a raw string). */
export type HeartbeatActionOptions = HeartbeatOptions & { stage?: string };

/** The progress the argument checks parsed, or nothing: the reject already printed. */
export type HeartbeatArgumentsCheck = { ok: true; progress: number } | { ok: false };

/** The validated `--stage` (null when the flag was absent or empty), or nothing. */
export type HeartbeatStageCheck = { ok: true; stage: StageLabel | null } | { ok: false };

/**
 * One failure envelope, printed the same way at every reject site: print, mark
 * the process failed, and let the caller `return`. All six sites already did
 * exactly this, so hoisting them cannot make two of them disagree.
 */
export function failHeartbeat(
  io: ProgramIO,
  f: {
    asJson: boolean;
    code: string;
    message: string;
    recordPath: string | null;
    nextAction: string;
  }
): void {
  printResult(
    io,
    fail(
      'sub-agent.heartbeat',
      f.code,
      f.message,
      { recordPath: f.recordPath, truncated: false } as never,
      [f.nextAction]
    ),
    f.asJson
  );
  process.exitCode = 1;
}

/**
 * The three argument checks that follow the record-existence guard, in the
 * order the command ran them. A reject prints and sets the exit code here; the
 * caller only returns.
 */
export function validateHeartbeatArguments(
  io: ProgramIO,
  asJson: boolean,
  options: HeartbeatActionOptions,
  recordPath: string
): HeartbeatArgumentsCheck {
  if (!HEARTBEAT_STATUSES.includes(options.status as HeartbeatStatus)) {
    failHeartbeat(io, {
      asJson,
      code: 'INVALID_STATUS',
      message: `--status must be one of ${HEARTBEAT_STATUSES.join(' | ')} (got ${options.status})`,
      recordPath,
      nextAction:
        'Use one of the documented statuses; poller compares lastBeatAt against now() - 5min to set `stale`.'
    });
    return { ok: false };
  }
  const progress = Number.parseInt(options.progress ?? 'NaN', 10);
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
    failHeartbeat(io, {
      asJson,
      code: 'INVALID_PROGRESS',
      message: `--progress must be integer 0-100 (got ${options.progress})`,
      recordPath,
      nextAction: 'Use 0..100 inclusive.'
    });
    return { ok: false };
  }
  if (options.note !== undefined && options.note.length > NOTE_MAX_CHARS) {
    failHeartbeat(io, {
      asJson,
      code: 'NOTE_TOO_LONG',
      message: `--note must be ≤ 200 chars (got ${options.note.length})`,
      recordPath,
      nextAction: 'Shorten the note; the record file is not a log file.'
    });
    return { ok: false };
  }
  return { ok: true, progress };
}

/**
 * Slice 2026-07-29-dispatch-stall-governance / S5 (AC-5.2) — validate the
 * optional `--stage` against the bounded enum BEFORE the heartbeat write so the
 * caller gets a specific `INVALID_STAGE` error rather than a generic
 * `HEARTBEAT_ERROR`. An absent or empty flag is not an error: it yields
 * `stage: null`, and `setStage` stays uncalled. The caller still runs this
 * AFTER `assertSafeDispatchRecordPath`, because which of the two fails first is
 * observable.
 */
export function resolveHeartbeatStage(
  io: ProgramIO,
  asJson: boolean,
  options: HeartbeatActionOptions,
  recordPath: string
): HeartbeatStageCheck {
  let stageLabel: StageLabel | null = null;
  if (options.stage !== undefined && options.stage.length > 0) {
    if (!isStageLabel(options.stage)) {
      failHeartbeat(io, {
        asJson,
        code: 'INVALID_STAGE',
        message: `--stage must be one of intake | planning | gathering | analyzing | writing | testing | reviewing | finalizing (got ${options.stage})`,
        recordPath,
        nextAction: 'Use one of the bounded stage labels; free-form text is not accepted.'
      });
      return { ok: false };
    }
    stageLabel = options.stage;
  }
  return { ok: true, stage: stageLabel };
}

/**
 * Slice 2026-06-23-audit-3rd #9: branch nextActions on `error.code` so
 * the LLM-side runner gets a specific hint instead of the generic
 * "see error message" fallback.
 */
export function heartbeatErrorNextActions(code: string): string {
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

/** The writer's error code, or the catch-all the CLI has always answered with. */
export function heartbeatErrorCode(error: unknown): string {
  return (error as { code?: string }).code ?? 'HEARTBEAT_ERROR';
}

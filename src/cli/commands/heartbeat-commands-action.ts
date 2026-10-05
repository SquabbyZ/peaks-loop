/**
 * The action half of `peaks sub-agent heartbeat` (G6) — the write path.
 *
 * Extracted VERBATIM from `heartbeat-commands.ts` (job strict-remediation-abc,
 * slice c1-eslint-family-sweep, leaf c1w1-heartbeat-commands) so the
 * registration file clears the 300-line cap and the `max-lines-per-function` /
 * `complexity` findings that sat on the commander action arrow fell with it.
 * The rejects live in `heartbeat-commands-validation.ts`.
 *
 * NOTHING was restructured. Same predicate order (record existence → status →
 * progress → note → R-2 path guard → stage), same `process.exitCode = 1` at
 * every reject, same two writes (`appendHeartbeat` then `setStage`), same
 * response-before-release order, same catch clauses. The stage check still runs
 * AFTER `assertSafeDispatchRecordPath` because that order is observable: an
 * unsafe `--record` must fail before a typo'd label.
 *
 * On swallows: the frame that discards a failed detached lease release moved
 * with the code it wraps — it was one, it is still one, and it was not rewritten
 * somewhere else. No `return null` and no empty catch was introduced here to
 * keep a function under a ceiling, and no catch in this module answers for the
 * absence of data.
 */
import { existsSync } from 'node:fs';
import { getErrorMessage, ok } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';
import {
  appendHeartbeat,
  setStage,
  tryAutoReleaseLease,
  type HeartbeatStatus
} from '../../services/dispatch/dispatch-record-writer.js';
import type { StageLabel } from '../../services/dispatch/stage-enum.js';
import { assertSafeDispatchRecordPath } from '../../services/security/safe-settings-path.js';
import { writeLogEntry } from '../../services/log/logger.js';
import {
  failHeartbeat,
  heartbeatErrorCode,
  heartbeatErrorNextActions,
  resolveHeartbeatStage,
  validateHeartbeatArguments,
  type HeartbeatActionOptions
} from './heartbeat-commands-validation.js';

/** What `appendHeartbeat` reports back: the record it wrote plus the truncation flag. */
type HeartbeatWrite = ReturnType<typeof appendHeartbeat>;

/** Everything the write path needs, as one object rather than six parameters. */
type HeartbeatWriteContext = {
  asJson: boolean;
  options: HeartbeatActionOptions;
  recordPath: string;
  progress: number;
  trustedRoot: string;
  stage: StageLabel | null;
};

// dispatch. Hoisted out of the action body — a constant set is the same set on
// every call, and its position in the sequence (after printResult) is unchanged.
const TERMINAL_HEARTBEAT_STATUSES: ReadonlySet<HeartbeatStatus> = new Set([
  'done',
  'failed',
  'cancelled',
  'no-execution'
]);

/**
 * surfaces a `leaseHint` field when the dispatch owns a lease. The hint is a
 * one-line reminder for the sub-agent that the lease is the L2 surface it
 * should clean up before exiting (or, per Part 3.A.2, the auto-release hook
 * will fire on the next terminal status). The hint is opt-in via a flag so
 * non-lease dispatches do not pollute the envelope.
 */
function leaseHintFor(result: HeartbeatWrite): string | null {
  const leaseId = result.record.leaseId ?? null;
  return leaseId !== null
    ? `You own lease \`${leaseId}\`. Run \`peaks worktree release --lease-id ${leaseId}\` before exit, or report a terminal status (done/failed/cancelled) to let peaks-loop auto-release.`
    : null;
}

/** The success envelope's payload, field for field, exactly as the CLI printed it. */
function heartbeatSuccessEnvelope(recordPath: string, result: HeartbeatWrite) {
  return {
    // Part 24: bumped to 2.2.0 to advertise the new `leaseHint`
    // field; readers from 2.1.0 ignore the unknown field.
    envelopeVersion: '2.2.0',
    recordPath,
    heartbeatCount: result.record.heartbeats.length,
    lastBeatAt: result.record.lastBeatAt,
    status: result.record.status,
    truncated: result.truncated,
    leaseHint: leaseHintFor(result)
  };
}

/**
 * a TERMINAL status (done / failed / cancelled / no-execution) AND the dispatch
 * owns a lease, fire the detached release. This is the common path: most
 * sub-agents finalize via heartbeat before the share-reducer calls
 * markCompleted, so the heartbeat path is the more frequent release trigger in
 * practice. markCompleted's hook (Part 3.A.1) remains as the safety net for
 * sub-agents that finalize via share without a terminal heartbeat. The release
 * is detached + best-effort; a failure here cannot roll back the heartbeat
 * write (the response has already shipped).
 */
function releaseLeaseForTerminalHeartbeat(
  trustedRoot: string,
  status: HeartbeatStatus,
  result: HeartbeatWrite
): void {
  if (TERMINAL_HEARTBEAT_STATUSES.has(status) && result.record.leaseId !== null) {
    try {
      tryAutoReleaseLease({
        projectRoot: trustedRoot,
        sessionId: result.record.sessionId,
        leaseId: result.record.leaseId
      });
    } catch {
      // best-effort
      /* swallow */
    }
  }
}

function logHeartbeatSuccess(recordPath: string, result: HeartbeatWrite): void {
  try {
    writeLogEntry({
      ts: new Date().toISOString(),
      level: 'info',
      command: 'sub-agent.heartbeat',
      msg: 'heartbeat',
      batchId: result.record.batchId,
      data: {
        recordPath,
        status: result.record.status,
        heartbeatCount: result.record.heartbeats.length,
        truncated: result.truncated
      }
    });
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    /* best-effort */
  }
}

/**
 * The write path, reached only after the R-2 guard and the stage check: append
 * the heartbeat, promote the stage when one was supplied, print the response,
 * then (and only then) the lease hook and the structured log.
 */
function writeAndReportHeartbeat(io: ProgramIO, ctx: HeartbeatWriteContext): void {
  const result = appendHeartbeat({
    recordPath: ctx.recordPath,
    status: ctx.options.status as HeartbeatStatus,
    progress: ctx.progress,
    ...(ctx.options.note !== undefined ? { note: ctx.options.note } : {})
  });
  // S5 — promote the stage if --stage was supplied. setStage re-validates and
  // is a no-op when stage is null. The appendHeartbeat call above already wrote
  // the heartbeat; setStage is a separate file-locked read-modify-write on the
  // same record.
  if (ctx.stage !== null) {
    setStage({ recordPath: ctx.recordPath, stage: ctx.stage });
  }
  printResult(
    io,
    ok(
      'sub-agent.heartbeat',
      heartbeatSuccessEnvelope(ctx.recordPath, result),
      [],
      ['Continue business logic; heartbeat is fire-and-forget.']
    ),
    ctx.asJson
  );
  releaseLeaseForTerminalHeartbeat(ctx.trustedRoot, ctx.options.status as HeartbeatStatus, result);
  logHeartbeatSuccess(ctx.recordPath, result);
}

/**
 * `peaks sub-agent heartbeat --record <path> --status <state> --progress <pct>`
 * — the body the commander action calls, in the order it ran before the split.
 */
export function runHeartbeatAction(io: ProgramIO, options: HeartbeatActionOptions): void {
  const asJson = options.json === true;
  if (!options.record || !existsSync(options.record)) {
    failHeartbeat(io, {
      asJson,
      code: 'INVALID_RECORD_PATH',
      message: `record not found: ${options.record ?? '(empty)'}`,
      recordPath: options.record ?? null,
      nextAction: 'Pass the absolute path from the `peaks sub-agent dispatch` envelope.'
    });
    return;
  }
  const recordPath = options.record;
  const args = validateHeartbeatArguments(io, asJson, options, recordPath);
  if (!args.ok) {
    return;
  }
  try {
    // NOT the --record path. deriveProjectRoot(recordPath) walked the path
    // itself, which let an attacker point --record at any other project's
    // .peaks/_sub_agents/ tree and slip past the guard. The relative()
    // backstop still applies — the record must live under the trusted
    // root's .peaks/_sub_agents/ subdir.
    const trustedRoot = options.project ?? process.cwd();
    assertSafeDispatchRecordPath(recordPath, trustedRoot);
    const stage = resolveHeartbeatStage(io, asJson, options, recordPath);
    if (!stage.ok) {
      return;
    }
    writeAndReportHeartbeat(io, {
      asJson,
      options,
      recordPath,
      progress: args.progress,
      trustedRoot,
      stage: stage.stage
    });
  } catch (error: unknown) {
    const code = heartbeatErrorCode(error);
    failHeartbeat(io, {
      asJson,
      code,
      message: getErrorMessage(error),
      recordPath: options.record ?? null,
      nextAction: heartbeatErrorNextActions(code)
    });
  }
}

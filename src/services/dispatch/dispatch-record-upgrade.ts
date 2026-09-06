import type { DispatchOutcome, DispatchRecord, DispatchRecordStatus, Heartbeat, HeartbeatStatus } from './dispatch-record-types.js';
import type { SubAgentToolCall } from './sub-agent-dispatcher.js';

export function upgradeRecord(parsed: unknown): DispatchRecord {
  if (!isObject(parsed)) {
    throw new Error('Dispatch record root must be an object');
  }
  const obj = parsed as Record<string, unknown>;
  // Slice 4.0.8: 3.2 → 4.0.0 schema bump. Phase A Task 8: 4.0.0 → 4.1.0
  // (additive). The literal type narrows to '4.1.0' but legacy v4.0.0 /
  // v3.2 / v3.1 / 3 / 2 / 1 records are accepted transparently and
  // upgraded on read.
  const rawVersion = obj.version;
  if (rawVersion !== '4.1.0' && rawVersion !== '4.0.0' && rawVersion !== '3.2' && rawVersion !== '3.1' && rawVersion !== 3 && rawVersion !== 2 && rawVersion !== 1) {
    throw new Error(
      `Dispatch record version mismatch: expected '4.1.0', '4.0.0', '3.2', '3.1', 3, 2, or 1, got ${JSON.stringify(rawVersion)}. ` +
      'The v1 → v4.1.0 migration is in-file; records from much older or newer builds must be regenerated.'
    );
  }

  const legacy = parseUpgradeRecordLegacyFields(obj);
  const migration = parseUpgradeRecordMigrationFields(obj);

  return {
    version: '4.1.0',
    createdAt: legacy.createdAt,
    completedAt: legacy.completedAt,
    outcome: legacy.outcome,
    artifactPaths: legacy.artifactPaths,
    disposed: legacy.disposed,
    disposedAt: legacy.disposedAt,
    role: legacy.role,
    requestId: legacy.requestId,
    sessionId: legacy.sessionId,
    prompt: legacy.prompt,
    toolCall: legacy.toolCall,
    batchId: legacy.batchId,
    heartbeats: legacy.heartbeats,
    lastBeatAt: legacy.lastBeatAt,
    status: legacy.status,
    stage: migration.stage,
    leaseId: migration.leaseId,
    isolationStartedAt: migration.isolationStartedAt,
    serviceKill: migration.serviceKill,
    mergeBackAttempts: migration.mergeBackAttempts,
    workflowId: migration.workflowId,
    graphNodeId: migration.graphNodeId,
    graphRef: migration.graphRef,
    // Phase A Task 8: detached sub-agent fields. Legacy records
    // (pre-4.1.0) default mode='in-process', vendor=null,
    // autoCompactEvents=[], tokenUsage=null. See
    // parseUpgradeRecordMigrationFields for the per-field
    // validation rules.
    mode: migration.mode,
    vendor: migration.vendor,
    autoCompactEvents: migration.autoCompactEvents,
    tokenUsage: migration.tokenUsage
  };
}

/**
 * Parse the v1..v3.2 core fields of a legacy dispatch record.
 * PRD-002b slice 6: extracted from `upgradeRecord` so the reader
 * stays under the `max-lines-per-function: 50` ESLint ceiling.
 * Behavior is byte-identical to the previous inline block.
 */
function parseUpgradeRecordLegacyFields(obj: Record<string, unknown>): {
  readonly role: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly prompt: string;
  readonly toolCall: SubAgentToolCall;
  readonly createdAt: string;
  readonly heartbeats: Heartbeat[];
  readonly lastBeatAt: string | null;
  readonly status: DispatchRecordStatus;
  readonly completedAt: string | null;
  readonly outcome: DispatchOutcome;
  readonly artifactPaths: string[];
  readonly disposed: boolean;
  readonly disposedAt: string | null;
  readonly batchId: string;
} {
  const role = stringField(obj, 'role');
  const requestId = stringField(obj, 'requestId');
  const sessionId = stringField(obj, 'sessionId');
  const prompt = stringField(obj, 'prompt');
  // Slice 2026-06-23-audit-4th #C2: preserve toolCallVersion on read.
  // Pre-versioning records default to '2.0.0' (the pre-#C2 implicit
  // shape; matches the version stamped by every current dispatcher).
  const rawToolCall = obj.toolCall as Record<string, unknown>;
  if (!isObject(rawToolCall) || typeof rawToolCall.name !== 'string') {
    throw new Error('Dispatch record toolCall must be { name, args }');
  }
  const toolCall: SubAgentToolCall = {
    name: rawToolCall.name as string,
    args: (isObject(rawToolCall.args) ? rawToolCall.args : {}) as Readonly<Record<string, unknown>>,
    ...(typeof rawToolCall.toolCallVersion === 'string' ? { toolCallVersion: rawToolCall.toolCallVersion } : { toolCallVersion: '2.0.0' })
  };
  const createdAt = stringField(obj, 'createdAt');
  const heartbeats = Array.isArray(obj.heartbeats)
    ? (obj.heartbeats.filter(isValidHeartbeat) as Heartbeat[])
    : [];
  const lastBeatAt = typeof obj.lastBeatAt === 'string' ? obj.lastBeatAt : null;
  // Slice 2026-07-29-dispatch-stall-governance / S1 (UQ-1) — `no-execution`
  // keeps its natural "dispatched, never executed" reading; an unparseable
  // status field now resolves to a *distinct* `unreadable` label so the
  // caller can tell "corrupt record" apart from "record written, no first
  // heartbeat" (which is the new `never-started` state).
  const status: DispatchRecordStatus = isDispatchStatus(obj.status)
    ? obj.status
    : 'unreadable';
  const completedAt = typeof obj.completedAt === 'string' ? obj.completedAt : null;
  const outcome: DispatchOutcome = isOutcome(obj.outcome) ? obj.outcome : 'no-execution';
  const artifactPaths = Array.isArray(obj.artifactPaths)
    ? obj.artifactPaths.filter((p): p is string => typeof p === 'string')
    : [];
  const disposed = obj.disposed === true;
  const disposedAt = typeof obj.disposedAt === 'string' ? obj.disposedAt : null;
  const batchId = typeof obj.batchId === 'string' && obj.batchId.length > 0
    ? obj.batchId
    : 'legacy-batch';
  return {
    role,
    requestId,
    sessionId,
    prompt,
    toolCall,
    createdAt,
    heartbeats,
    lastBeatAt,
    status,
    completedAt,
    outcome,
    artifactPaths,
    disposed,
    disposedAt,
    batchId
  };
}

/**
 * Parse the post-v3 migration fields of a legacy dispatch record.
 * PRD-002b slice 6: extracted from `upgradeRecord` so the reader
 * stays under the `max-lines-per-function: 50` ESLint ceiling.
 * Behavior is byte-identical to the previous inline block.
 */
function parseUpgradeRecordMigrationFields(obj: Record<string, unknown>): {
  readonly stage: string | null;
  readonly leaseId: string | null;
  readonly isolationStartedAt: string | null;
  readonly serviceKill: ReadonlyArray<{ readonly pid: number; readonly name: string; readonly signal: string; readonly exitCode: number | null; readonly skipped?: boolean; readonly reason?: string }>;
  readonly mergeBackAttempts: number;
  readonly workflowId: string | null;
  readonly graphNodeId: string | null;
  readonly graphRef: string | null;
  readonly mode: 'in-process' | 'detached';
  readonly vendor: 'claude' | 'codex' | 'copilot' | null;
  readonly autoCompactEvents: ReadonlyArray<{
    readonly at: number;
    readonly threshold: '0.85' | '0.95';
    readonly tokensBefore: number;
    readonly tokensAfter: number;
    readonly scratchFile?: string;
  }>;
  readonly tokenUsage: { readonly promptTokens: number; readonly completionTokens: number; readonly totalCostUsd?: number } | null;
} {
  return {
    // Slice 2026-07-29-dispatch-stall-governance / S5 (AC-5.1 / PB-2)
    // — legacy records (pre-slice) had no `stage` field. The reader
    // defaults to `null` so the watch surface can tell "no stage ever
    // emitted" apart from "stage: ''" (which is itself a *valid*
    // round-trip through the writer — an empty stage is rejected by
    // `setStage`, but a record that round-tripped through a non-strict
    // tool would land here).
    stage: typeof obj.stage === 'string' && obj.stage.length > 0 ? obj.stage : null,
    // Slice 2026-07-29-worktree-l2-extended Part 3.A: legacy records
    // have no `leaseId`; default to `null` so the auto-release hook
    // in `markCompleted` is a clean no-op for them.
    leaseId: typeof obj.leaseId === 'string' && /^[a-f0-9]{16}$/.test(obj.leaseId)
      ? obj.leaseId
      : null,
    // Slice 2026-07-29-worktree-l2-extended Part 7: v3 → v3.1
    // migration. Legacy records have no `isolationStartedAt`; default
    // to `null`. v3.1 readers can treat the field as opt-in.
    isolationStartedAt: typeof obj.isolationStartedAt === 'string' && obj.isolationStartedAt.length > 0
      ? obj.isolationStartedAt
      : null,
    // Slice 2026-08-01-subagent-merge-and-e2e (Task 7): v3.1 → v3.2
    // migration. Legacy v3.1 records have no `serviceKill` or
    // `mergeBackAttempts` fields. Default to [] and 0 so the
    // merge-back-runner (Task 9) can read either schema on disk.
    serviceKill: Array.isArray(obj.serviceKill)
      ? (obj.serviceKill.filter((e): e is { readonly pid: number; readonly name: string; readonly signal: string; readonly exitCode: number | null; readonly skipped?: boolean; readonly reason?: string } => {
          if (typeof e !== 'object' || e === null) return false;
          const o = e as Record<string, unknown>;
          return typeof o.pid === 'number' && typeof o.name === 'string' && typeof o.signal === 'string' && (o.exitCode === null || typeof o.exitCode === 'number');
        }))
      : [],
    mergeBackAttempts: typeof obj.mergeBackAttempts === 'number' && Number.isFinite(obj.mergeBackAttempts) && obj.mergeBackAttempts >= 0
      ? Math.floor(obj.mergeBackAttempts)
      : 0,
    // Slice 4.0.8: 3.2 → 4.0.0 migration. v3.2 records on disk
    // pre-date the workflow-graph binding; default all three
    // fields to `null` so a legacy record upgrades transparently.
    workflowId: typeof obj.workflowId === 'string' && /^[a-zA-Z0-9._-]{1,200}$/.test(obj.workflowId) ? obj.workflowId : null,
    graphNodeId: typeof obj.graphNodeId === 'string' && /^[a-zA-Z0-9._-]{1,200}$/.test(obj.graphNodeId) ? obj.graphNodeId : null,
    graphRef: typeof obj.graphRef === 'string' ? obj.graphRef : null,
    // Phase A Task 8: 4.0.0 → 4.1.0 migration. Pre-4.1.0 records
    // have no mode / vendor / autoCompactEvents / tokenUsage
    // fields. Default to safe in-process / null / [] / null so
    // legacy records upgrade transparently without breaking
    // consumers (e.g. the dashboard, the merge-back-runner).
    mode: obj.mode === 'detached' ? 'detached' : 'in-process',
    vendor: obj.vendor === 'claude' || obj.vendor === 'codex' || obj.vendor === 'copilot' ? obj.vendor : null,
    autoCompactEvents: Array.isArray(obj.autoCompactEvents)
      ? (obj.autoCompactEvents as Array<Record<string, unknown>>).filter(
          (e): e is { at: number; threshold: '0.85' | '0.95'; tokensBefore: number; tokensAfter: number; scratchFile?: string } =>
            typeof e?.at === 'number' &&
            (e?.threshold === '0.85' || e?.threshold === '0.95') &&
            typeof e?.tokensBefore === 'number' &&
            typeof e?.tokensAfter === 'number',
        )
      : [],
    tokenUsage:
      typeof obj.tokenUsage === 'object' && obj.tokenUsage !== null && typeof (obj.tokenUsage as Record<string, unknown>).promptTokens === 'number' && typeof (obj.tokenUsage as Record<string, unknown>).completionTokens === 'number'
        ? {
            promptTokens: (obj.tokenUsage as Record<string, unknown>).promptTokens as number,
            completionTokens: (obj.tokenUsage as Record<string, unknown>).completionTokens as number,
            ...(typeof (obj.tokenUsage as Record<string, unknown>).totalCostUsd === 'number'
              ? { totalCostUsd: (obj.tokenUsage as Record<string, unknown>).totalCostUsd as number }
              : {}),
          }
        : null
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string') {
    throw new Error(`Dispatch record field '${key}' must be a string (got ${typeof v})`);
  }
  return v;
}

function isValidHeartbeat(v: unknown): v is Heartbeat {
  if (!isObject(v)) return false;
  return (
    typeof v.at === 'string' &&
    isHeartbeatStatus(v.status) &&
    typeof v.progress === 'number' &&
    (v.note === null || typeof v.note === 'string')
  );
}

function isHeartbeatStatus(v: unknown): v is HeartbeatStatus {
  return (
    v === 'queued' || v === 'running' || v === 'finalizing' ||
    v === 'done' || v === 'failed' || v === 'stale' ||
    // Slice 2026-07-29-dispatch-stall-governance / S2 — accept the
    // S1 terminal members so a sub-agent can report `cancelled`,
    // `no-execution`, `never-started`, or `unreadable` through the
    // heartbeat CLI.
    v === 'cancelled' || v === 'no-execution' ||
    v === 'never-started' || v === 'unreadable'
  );
}

function isDispatchStatus(v: unknown): v is DispatchRecordStatus {
  return (
    v === 'queued' || v === 'running' || v === 'finalizing' ||
    v === 'done' || v === 'failed' || v === 'cancelled' ||
    v === 'no-execution' || v === 'stale' ||
    // Slice 2026-07-29-dispatch-stall-governance / S1 — accept the two
    // new terminal members from the startup-timeout service.
    v === 'never-started' || v === 'unreadable'
  );
}

function isOutcome(v: unknown): v is DispatchOutcome {
  return (
    v === 'success' || v === 'failed' || v === 'timeout' ||
    v === 'cancelled' || v === 'no-execution'
  );
}

export { isDispatchStatus, isOutcome };

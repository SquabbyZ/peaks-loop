/**
 * Field parsers for the dispatch-record upgrade path.
 * C wave 1 / slice c1 (leaf c1w1-record-upgrade): extracted from
 * `dispatch-record-upgrade.ts`'s `upgradeRecord` body into cohesive helpers
 * with identical control flow — same predicates, same branch order, same
 * error handling, same return shape. The throwing field reads
 * (`role` / `requestId` / `sessionId` / `prompt`, then `toolCall`, then
 * `createdAt`) still run in exactly that order before any pure defaulting;
 * everything after them is a pure read of `obj`.
 */
import type { DispatchRecord } from './dispatch-record-types.js';
import type { SubAgentToolCall } from './sub-agent-dispatcher.js';
import {
  isDispatchStatus,
  isObject,
  isValidHeartbeat,
  isOutcome,
  stringField
} from './dispatch-record-upgrade-guards.js';

type ServiceKillEntry = DispatchRecord['serviceKill'][number];
type AutoCompactEvent = DispatchRecord['autoCompactEvents'][number];

/**
 * Parse the v1..v3.2 core fields of a legacy dispatch record.
 * PRD-002b slice 6: extracted from `upgradeRecord` so the reader
 * stays under the `max-lines-per-function: 50` ESLint ceiling.
 * Behavior is byte-identical to the previous inline block.
 */
export function parseUpgradeRecordLegacyFields(obj: Record<string, unknown>) {
  const role = stringField(obj, 'role');
  const requestId = stringField(obj, 'requestId');
  const sessionId = stringField(obj, 'sessionId');
  const prompt = stringField(obj, 'prompt');
  const toolCall = parseLegacyToolCallField(obj);
  const createdAt = stringField(obj, 'createdAt');
  return { role, requestId, sessionId, prompt, toolCall, createdAt };
}

/**
 * '2.0.0' (the pre-#C2 implicit shape; matches the version stamped by
 * every current dispatcher). Throws exactly where the inline block threw.
 */
function parseLegacyToolCallField(obj: Record<string, unknown>): SubAgentToolCall {
  const rawToolCall = obj.toolCall as Record<string, unknown>;
  if (!isObject(rawToolCall) || typeof rawToolCall.name !== 'string') {
    throw new Error('Dispatch record toolCall must be { name, args }');
  }
  return {
    name: rawToolCall.name,
    args: isObject(rawToolCall.args) ? rawToolCall.args : {},
    ...(typeof rawToolCall.toolCallVersion === 'string'
      ? { toolCallVersion: rawToolCall.toolCallVersion }
      : { toolCallVersion: '2.0.0' })
  };
}

/**
 * Default the G5/G6 lifecycle + heartbeat fields of a legacy record.
 * All pure reads: no branch here throws, matching the previous inline block.
 */
function parseLegacyStateFields(obj: Record<string, unknown>) {
  const heartbeats = Array.isArray(obj.heartbeats) ? obj.heartbeats.filter(isValidHeartbeat) : [];
  const lastBeatAt = typeof obj.lastBeatAt === 'string' ? obj.lastBeatAt : null;
  // keeps its natural "dispatched, never executed" reading; an unparseable
  // status field now resolves to a *distinct* `unreadable` label so the
  // caller can tell "corrupt record" apart from "record written, no first
  // heartbeat" (which is the new `never-started` state).
  const status = isDispatchStatus(obj.status) ? obj.status : 'unreadable';
  const completedAt = typeof obj.completedAt === 'string' ? obj.completedAt : null;
  const outcome = isOutcome(obj.outcome) ? obj.outcome : 'no-execution';
  const artifactPaths = Array.isArray(obj.artifactPaths)
    ? obj.artifactPaths.filter((p): p is string => typeof p === 'string')
    : [];
  const disposed = obj.disposed === true;
  const disposedAt = typeof obj.disposedAt === 'string' ? obj.disposedAt : null;
  const batchId =
    typeof obj.batchId === 'string' && obj.batchId.length > 0 ? obj.batchId : 'legacy-batch';
  return {
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
 * Behavior is byte-identical to the previous inline block; the `vendor`
 * field is NOT parsed here — it stays in `dispatch-record-upgrade.ts`
 * because the vendor-neutral identity census pins that decision by path.
 */
export function parseUpgradeRecordMigrationFields(obj: Record<string, unknown>) {
  const stall = parseStallGovernanceFields(obj);
  const mergeBack = parseMergeBackFields(obj);
  const workflow = parseWorkflowBindingFields(obj);
  const autoCompact = parseAutoCompactEventsField(obj);
  const tokenUsage = parseTokenUsageField(obj);
  // Typed exactly as the previous inline block's explicit return type
  // ('in-process' | 'detached'); without the annotation the ternary would
  // widen to `string`.
  const mode: DispatchRecord['mode'] = obj.mode === 'detached' ? 'detached' : 'in-process';
  return {
    stage: stall.stage,
    leaseId: stall.leaseId,
    isolationStartedAt: stall.isolationStartedAt,
    serviceKill: mergeBack.serviceKill,
    mergeBackAttempts: mergeBack.mergeBackAttempts,
    workflowId: workflow.workflowId,
    graphNodeId: workflow.graphNodeId,
    graphRef: workflow.graphRef,
    // Phase A Task 8: 4.0.0 → 4.1.0 migration. Pre-4.1.0 records
    // have no mode / vendor / autoCompactEvents / tokenUsage
    // fields. Default to safe in-process / null / [] / null so
    // legacy records upgrade transparently without breaking
    // consumers (e.g. the dashboard, the merge-back-runner).
    mode,
    autoCompactEvents: autoCompact.autoCompactEvents,
    tokenUsage: tokenUsage.tokenUsage
  };
}

/**
 * — legacy records (pre-slice) had no `stage` field. The reader
 * defaults to `null` so the watch surface can tell "no stage ever
 * emitted" apart from "stage: ''" (which is itself a *valid*
 * round-trip through the writer — an empty stage is rejected by
 * `setStage`, but a record that round-tripped through a non-strict
 * tool would land here).
 * have no `leaseId`; default to `null` so the auto-release hook
 * in `markCompleted` is a clean no-op for them.
 * migration. Legacy records have no `isolationStartedAt`; default
 * to `null`. v3.1 readers can treat the field as opt-in.
 */
function parseStallGovernanceFields(obj: Record<string, unknown>) {
  return {
    stage: typeof obj.stage === 'string' && obj.stage.length > 0 ? obj.stage : null,
    leaseId:
      typeof obj.leaseId === 'string' && /^[a-f0-9]{16}$/.test(obj.leaseId) ? obj.leaseId : null,
    isolationStartedAt:
      typeof obj.isolationStartedAt === 'string' && obj.isolationStartedAt.length > 0
        ? obj.isolationStartedAt
        : null
  };
}

/**
 * migration. Legacy v3.1 records have no `serviceKill` or
 * `mergeBackAttempts` fields. Default to [] and 0 so the
 * merge-back-runner (Task 9) can read either schema on disk.
 */
function parseMergeBackFields(obj: Record<string, unknown>) {
  return {
    serviceKill: Array.isArray(obj.serviceKill) ? obj.serviceKill.filter(isServiceKillEntry) : [],
    mergeBackAttempts:
      typeof obj.mergeBackAttempts === 'number' &&
      Number.isFinite(obj.mergeBackAttempts) &&
      obj.mergeBackAttempts >= 0
        ? Math.floor(obj.mergeBackAttempts)
        : 0
  };
}

function isServiceKillEntry(e: unknown): e is ServiceKillEntry {
  if (typeof e !== 'object' || e === null) return false;
  const o = e as Record<string, unknown>;
  return (
    typeof o.pid === 'number' &&
    typeof o.name === 'string' &&
    typeof o.signal === 'string' &&
    (o.exitCode === null || typeof o.exitCode === 'number')
  );
}

// Slice 4.0.8: 3.2 → 4.0.0 migration. v3.2 records on disk
// pre-date the workflow-graph binding; default all three
// fields to `null` so a legacy record upgrades transparently.
function parseWorkflowBindingFields(obj: Record<string, unknown>) {
  return {
    workflowId:
      typeof obj.workflowId === 'string' && /^[a-zA-Z0-9._-]{1,200}$/.test(obj.workflowId)
        ? obj.workflowId
        : null,
    graphNodeId:
      typeof obj.graphNodeId === 'string' && /^[a-zA-Z0-9._-]{1,200}$/.test(obj.graphNodeId)
        ? obj.graphNodeId
        : null,
    graphRef: typeof obj.graphRef === 'string' ? obj.graphRef : null
  };
}

function parseAutoCompactEventsField(obj: Record<string, unknown>) {
  return {
    autoCompactEvents: Array.isArray(obj.autoCompactEvents)
      ? (obj.autoCompactEvents as Array<Record<string, unknown>>).filter(isAutoCompactEvent)
      : []
  };
}

function isAutoCompactEvent(e: Record<string, unknown>): e is AutoCompactEvent {
  return (
    typeof e?.at === 'number' &&
    (e?.threshold === '0.85' || e?.threshold === '0.95') &&
    typeof e?.tokensBefore === 'number' &&
    typeof e?.tokensAfter === 'number'
  );
}

function parseTokenUsageField(obj: Record<string, unknown>) {
  return {
    tokenUsage:
      typeof obj.tokenUsage === 'object' &&
      obj.tokenUsage !== null &&
      typeof (obj.tokenUsage as Record<string, unknown>).promptTokens === 'number' &&
      typeof (obj.tokenUsage as Record<string, unknown>).completionTokens === 'number'
        ? {
            promptTokens: (obj.tokenUsage as Record<string, unknown>).promptTokens as number,
            completionTokens: (obj.tokenUsage as Record<string, unknown>)
              .completionTokens as number,
            ...(typeof (obj.tokenUsage as Record<string, unknown>).totalCostUsd === 'number'
              ? {
                  totalCostUsd: (obj.tokenUsage as Record<string, unknown>).totalCostUsd as number
                }
              : {})
          }
        : null
  };
}

/**
 * Assemble the normalized 4.1.0 record from the two parse passes. The
 * returned object literal is byte-for-byte the previous `upgradeRecord`
 * return literal (same key order) so a record re-serialized by the writer
 * keeps its on-disk shape. `vendor` is threaded in from the upgrade module
 * (see `parseUpgradeRecordMigrationFields` for why).
 */
export function buildUpgradedRecord(
  obj: Record<string, unknown>,
  vendor: DispatchRecord['vendor']
): DispatchRecord {
  const legacy = parseUpgradeRecordLegacyFields(obj);
  const state = parseLegacyStateFields(obj);
  const migration = parseUpgradeRecordMigrationFields(obj);
  return {
    version: '4.1.0',
    createdAt: legacy.createdAt,
    completedAt: state.completedAt,
    outcome: state.outcome,
    artifactPaths: state.artifactPaths,
    disposed: state.disposed,
    disposedAt: state.disposedAt,
    role: legacy.role,
    requestId: legacy.requestId,
    sessionId: legacy.sessionId,
    prompt: legacy.prompt,
    toolCall: legacy.toolCall,
    batchId: state.batchId,
    heartbeats: state.heartbeats,
    lastBeatAt: state.lastBeatAt,
    status: state.status,
    stage: migration.stage,
    leaseId: migration.leaseId,
    isolationStartedAt: migration.isolationStartedAt,
    serviceKill: migration.serviceKill,
    mergeBackAttempts: migration.mergeBackAttempts,
    workflowId: migration.workflowId,
    graphNodeId: migration.graphNodeId,
    graphRef: migration.graphRef,
    mode: migration.mode,
    vendor,
    autoCompactEvents: migration.autoCompactEvents,
    tokenUsage: migration.tokenUsage
  };
}

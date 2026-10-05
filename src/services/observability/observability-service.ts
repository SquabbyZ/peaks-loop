/**
 * Slice topology observability — schema + emit (Slice A of v2.11.1).
 *
 * Public surface:
 *   - `emitObservabilityEvent(event, options)` — fire-and-forget write
 *     to `.peaks/_runtime/<event.sessionId>/metrics/slices.jsonl`.
 *   - `readObservabilityEvents(projectRoot, sessionId)` — schema-aware
 *     reader that skips malformed lines and unknown schema versions
 *     (per PRD Q3 forward-compat).
 *
 * Schema-versioned (schemaVersion: 1). The zod schema is the source of
 * truth for the wire format. `ts` and `sessionId` are required; the
 * caller is responsible for passing them (so each hook site has a
 * canonical session binding even when run in a sub-agent).
 *
 * Per PRD Q4, `emit` MUST NEVER throw or fail-loud. All error paths
 * collapse to `written: false` with a `reason` string so the caller can
 * log if it wants — but the calling hook site itself swallows the
 * result (fire-and-forget by convention).
 */

import {
  appendMetricLine,
  pruneMetricsFiles,
  readMetricLines,
  tryMetricsFilePath
} from './jsonl-store.js';
import {
  OBSERVABILITY_SCHEMA_VERSION,
  ObservabilityEventSchema,
  type EmitOptions,
  type EmitResult,
  type ObservabilityEvent,
  type ObservabilitySubagentRole
} from './observability-schema.js';

// The schema version, the category / subagent-role vocabularies, the zod
// schema, the emit contract types and the `OBSERVABILITY_CONSTANTS` roll-up
// live in `observability-schema.ts` (wave-3C file-size cap split — those
// declarations moved verbatim and nothing else changed). Every PUBLIC name is
// re-exported below so importers keep resolving it from
// `observability-service.js` unchanged; the names this module calls are
// imported for use just above.
export {
  OBSERVABILITY_CATEGORIES,
  OBSERVABILITY_CONSTANTS,
  OBSERVABILITY_SCHEMA_VERSION,
  OBSERVABILITY_SUBAGENT_ROLES,
  ObservabilityEventSchema
} from './observability-schema.js';
export type {
  EmitFailureReason,
  EmitOptions,
  EmitResult,
  ObservabilityCategory,
  ObservabilityEvent,
  ObservabilitySubagentRole
} from './observability-schema.js';

/**
 * Append a single observability event to the session's JSONL metrics
 * file. Synchronous (small append, sub-ms in practice) and
 * fire-and-forget by construction — the caller never awaits, and the
 * function never throws.
 *
 * On success, also triggers the cross-session prune
 * (`pruneMetricsFiles`). The prune is best-effort and cheap when the
 * session count is below `MAX_METRICS_FILES`.
 */
export function emitObservabilityEvent(
  event: ObservabilityEvent,
  options: EmitOptions
): EmitResult {
  // The session id is resolved through the axis's TOTAL entry, before anything
  // else. The contract two doc comments above is that this function never
  // throws; the previous first line called the axis's THROWING entry, so an
  // unsafe session id made it throw — measured (repair R4) as
  // `Invalid session id: ../../../../RD-R4-PWNED`, against a legal control
  // that returned `written: true`. A guard refusal is a failure like any
  // other here: it becomes a reason, not an exception.
  const path = tryMetricsFilePath(options.projectRoot, event.sessionId);
  if (path === null) {
    return { written: false, path: '', reason: 'invalid-session-id' };
  }
  const validation = ObservabilityEventSchema.safeParse(event);
  if (!validation.success) {
    return { written: false, path, reason: 'invalid-schema' };
  }
  const line = JSON.stringify(validation.data);
  const ok = appendMetricLine(options.projectRoot, event.sessionId, line);
  if (ok) {
    // Cheap when below cap; only walks .peaks/_runtime/ + stat each file.
    pruneMetricsFiles(options.projectRoot);
    return { written: true, path };
  }
  return { written: false, path, reason: 'write-failed' };
}

/**
 * Read all events from a session's metrics file, skipping malformed
 * lines and any record whose `schemaVersion` does not match the
 * current `OBSERVABILITY_SCHEMA_VERSION` (forward-compat per Q3).
 *
 * Returns [] when the session has no metrics file yet, and [] when the
 * session id names no session directory — both are "no events are
 * readable here", and this reader does not throw (repair R6: it used to,
 * via `readMetricLines` → `metricsFilePath`).
 */
export function readObservabilityEvents(
  projectRoot: string,
  sessionId: string
): ObservabilityEvent[] {
  const lines = readMetricLines(projectRoot, sessionId);
  const events: ObservabilityEvent[] = [];
  for (const line of lines) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const validation = ObservabilityEventSchema.safeParse(raw);
    if (!validation.success) {
      continue;
    }
    events.push(validation.data);
  }
  return events;
}

/**
 * True when the candidate record validates against the current
 * schema (re-exported as a convenience for callers that already have
 * parsed JSON and want to skip forward-compat records).
 */
export function isCurrentSchemaVersion(record: unknown): record is ObservabilityEvent {
  return ObservabilityEventSchema.safeParse(record).success;
}

/**
 * observability. Each `peaks worktree spawn / renew / release /
 * gc` CLI emits a `lease` event; the auto-release hook in
 * dispatch finalization emits `autoRelease` (success) or
 * `autoRelease-failed` (detached spawn failed). The
 * `peaks lease metrics --json` reader aggregates these for the
 * dashboard.
 *
 * Fire-and-forget by contract (mirrors emitCycleEvent /
 * emitTokenUsageEvent): never throws, written=false on schema
 * mismatch or IO failure. Callers do not inspect the result.
 */
export type LeaseEventKind =
  | 'spawn'
  | 'renew'
  | 'release'
  | 'gc'
  | 'autoRelease'
  | 'autoRelease-failed'
  | 'autoRelease-skipped';

export function emitLeaseEvent(opts: {
  sessionId: string;
  projectRoot: string;
  kind: LeaseEventKind;
  leaseId: string;
  rid?: string;
  role?: string;
  /** Reason the autoRelease was skipped (e.g. "no-lease", "non-terminal-status"). */
  reason?: string;
}): EmitResult {
  const detail: Record<string, unknown> = { kind: opts.kind, leaseId: opts.leaseId };
  if (opts.rid !== undefined) detail['rid'] = opts.rid;
  if (opts.role !== undefined) detail['role'] = opts.role;
  if (opts.reason !== undefined) detail['reason'] = opts.reason;
  return emitObservabilityEvent(
    {
      schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
      ts: new Date().toISOString(),
      sessionId: opts.sessionId,
      category: 'lease',
      detail
    },
    { projectRoot: opts.projectRoot }
  );
}

/**
 * Fire-and-forget; never throws. Tagging `kind` for downstream dashboards.
 */
export function emitCycleEvent(opts: {
  sessionId: string;
  projectRoot: string;
  cycle: number;
  status: 'started' | 'completed' | 'failed';
}): EmitResult {
  return emitObservabilityEvent(
    {
      schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
      ts: new Date().toISOString(),
      sessionId: opts.sessionId,
      category: 'cycle',
      detail: { cycle: opts.cycle, status: opts.status }
    },
    { projectRoot: opts.projectRoot }
  );
}

/**
 * sum the dashboard cares about; `inputTokens`/`outputTokens` are kept
 * for downstream drill-down.
 */
export function emitTokenUsageEvent(opts: {
  sessionId: string;
  projectRoot: string;
  inputTokens: number;
  outputTokens: number;
}): EmitResult {
  const totalTokens = Math.max(0, opts.inputTokens) + Math.max(0, opts.outputTokens);
  return emitObservabilityEvent(
    {
      schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
      ts: new Date().toISOString(),
      sessionId: opts.sessionId,
      category: 'token-usage',
      detail: {
        inputTokens: opts.inputTokens,
        outputTokens: opts.outputTokens,
        totalTokens
      }
    },
    { projectRoot: opts.projectRoot }
  );
}

/**
 */
export function emitMonotonicTriggerEvent(opts: {
  sessionId: string;
  projectRoot: string;
  report: 'pass' | 'warn' | 'block';
  action: string;
}): EmitResult {
  return emitObservabilityEvent(
    {
      schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
      ts: new Date().toISOString(),
      sessionId: opts.sessionId,
      category: 'monotonic-trigger',
      detail: { report: opts.report, action: opts.action }
    },
    { projectRoot: opts.projectRoot }
  );
}

/**
 * existing `dispatch` category (rd/qa/reviewer/audit). Provides a
 * canonical emit helper so dashboards don't have to hand-author the
 * `ObservabilityEvent` envelope.
 */
export function emitDispatchEvent(opts: {
  sessionId: string;
  projectRoot: string;
  role: ObservabilitySubagentRole;
  status?: 'queued' | 'running' | 'done' | 'failed';
}): EmitResult {
  return emitObservabilityEvent(
    {
      schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
      ts: new Date().toISOString(),
      sessionId: opts.sessionId,
      category: 'dispatch',
      role: opts.role,
      detail: { status: opts.status ?? 'done' }
    },
    { projectRoot: opts.projectRoot }
  );
}

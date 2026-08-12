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

import { z } from 'zod';

import { appendMetricLine, metricsFilePath, pruneMetricsFiles, readMetricLines } from './jsonl-store.js';

export const OBSERVABILITY_SCHEMA_VERSION = 1 as const;

export const OBSERVABILITY_CATEGORIES = [
  'slice-transition',
  'dispatch',
  'checkpoint',
  'mode-gate',
  'context-trigger',
  'post-compact',
  'cycle',
  'token-usage',
  'monotonic-trigger',
  // Slice 2026-07-29-worktree-l2-extended Part 4.A: lease lifecycle
  // metrics. Emitted by `peaks worktree spawn / renew / release /
  // gc` and by the auto-release hook in dispatch finalization (Part
  // 3.A). Read by `peaks lease metrics`. The `detail.kind` field
  // discriminates spawn / renew / release / gc / autoRelease /
  // autoRelease-failed / autoRelease-skipped.
  'lease'
] as const;
export type ObservabilityCategory = typeof OBSERVABILITY_CATEGORIES[number];

// v2.12.0 fan-out collapse: `security-reviewer` (in-process RD slot)
// moved out to the standalone `peaks-security-audit` skill; the matching
// perf slot was `perf-baseline-reviewer` which is replaced by the
// standalone `peaks-perf-audit` skill. The 1-minor-release back-compat
// window keeps `security-reviewer` readable as a deprecated alias (see
// the dispatcher in `src/services/rd/reviewer-dispatch-policy.ts`);
// observability drops it because no new events carry that role tag.
export const OBSERVABILITY_SUBAGENT_ROLES = [
  'rd',
  'qa',
  'code-reviewer',
  'karpathy-reviewer',
  'peaks-security-audit',
  'peaks-perf-audit'
] as const;
export type ObservabilitySubagentRole = typeof OBSERVABILITY_SUBAGENT_ROLES[number];

export const ObservabilityEventSchema = z.object({
  schemaVersion: z.literal(OBSERVABILITY_SCHEMA_VERSION),
  ts: z.string().datetime({ offset: true }),
  sessionId: z.string().min(1),
  category: z.enum(OBSERVABILITY_CATEGORIES),
  sliceRid: z.string().min(1).optional(),
  role: z.enum(OBSERVABILITY_SUBAGENT_ROLES).optional(),
  detail: z.record(z.string(), z.unknown())
});

export type ObservabilityEvent = z.infer<typeof ObservabilityEventSchema>;

export type EmitOptions = {
  /** Absolute path to the project root (where `.peaks/_runtime/` lives). */
  projectRoot: string;
};

export type EmitFailureReason = 'invalid-schema' | 'write-failed';

export type EmitResult = {
  /** True when the JSONL line was appended; false on any error path. */
  written: boolean;
  /** Absolute path to the metrics file the event was written to (or would be). */
  path: string;
  /** Set only when `written` is false. */
  reason?: EmitFailureReason;
};

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
export function emitObservabilityEvent(event: ObservabilityEvent, options: EmitOptions): EmitResult {
  const path = metricsFilePath(options.projectRoot, event.sessionId);
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
 * Returns [] when the session has no metrics file yet.
 */
export function readObservabilityEvents(projectRoot: string, sessionId: string): ObservabilityEvent[] {
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

export const OBSERVABILITY_CONSTANTS = {
  SCHEMA_VERSION: OBSERVABILITY_SCHEMA_VERSION,
  CATEGORIES: OBSERVABILITY_CATEGORIES,
  SUBAGENT_ROLES: OBSERVABILITY_SUBAGENT_ROLES
} as const;

/**
 * Slice 2026-07-29-worktree-l2-extended Part 4.A: lease lifecycle
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
 * rid-030 F-direction: per-cycle event (cycle started / completed / failed).
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
 * rid-030 F-direction: per-token-usage event. `totalTokens` is the
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
 * rid-030 F-direction: per-monotonic-trigger event.
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
 * rid-030 F-direction: per-subagent-dispatch event. Reuses the
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
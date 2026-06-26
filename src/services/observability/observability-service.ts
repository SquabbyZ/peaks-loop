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
  'post-compact'
] as const;
export type ObservabilityCategory = typeof OBSERVABILITY_CATEGORIES[number];

export const OBSERVABILITY_SUBAGENT_ROLES = [
  'rd',
  'qa',
  'code-reviewer',
  'security-reviewer',
  'karpathy-reviewer'
] as const;
export type ObservabilitySubagentRole = typeof OBSERVABILITY_SUBAGENT_ROLES[number];

export const ObservabilityEventSchema = z.object({
  schemaVersion: z.literal(OBSERVABILITY_SCHEMA_VERSION),
  ts: z.string().datetime({ offset: true }),
  sessionId: z.string().min(1),
  category: z.enum(OBSERVABILITY_CATEGORIES),
  sliceRid: z.string().min(1).optional(),
  role: z.enum(OBSERVABILITY_SUBAGENT_ROLES).optional(),
  detail: z.record(z.unknown())
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
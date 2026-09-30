/**
 * `src/services/observability/observability-schema.ts`
 *
 * The wire format for slice-topology observability events: the schema version,
 * the category and subagent-role vocabularies, the zod schema that is the
 * source of truth for a `slices.jsonl` record, the emit-side contract types
 * (`EmitOptions` / `EmitFailureReason` / `EmitResult`) and the
 * `OBSERVABILITY_CONSTANTS` roll-up over them.
 *
 * Extracted verbatim (wave-3C of the file-size cap campaign) from
 * `observability-service.ts`, which imports what it uses and re-exports every
 * PUBLIC name below, so importers keep resolving all of them from
 * `observability-service.js` unchanged. No emit or read logic lives here — the
 * writer and the reader stay in the service module.
 */

import { z } from 'zod';

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
export type ObservabilityCategory = (typeof OBSERVABILITY_CATEGORIES)[number];

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
export type ObservabilitySubagentRole = (typeof OBSERVABILITY_SUBAGENT_ROLES)[number];

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

export type EmitFailureReason = 'invalid-schema' | 'write-failed' | 'invalid-session-id';

export type EmitResult = {
  /** True when the JSONL line was appended; false on any error path. */
  written: boolean;
  /**
   * Absolute path to the metrics file the event was written to (or would
   * be). Empty string when the session id named no session directory —
   * there is no path to report, and `reason` says so.
   */
  path: string;
  /** Set only when `written` is false. */
  reason?: EmitFailureReason;
};

export const OBSERVABILITY_CONSTANTS = {
  SCHEMA_VERSION: OBSERVABILITY_SCHEMA_VERSION,
  CATEGORIES: OBSERVABILITY_CATEGORIES,
  SUBAGENT_ROLES: OBSERVABILITY_SUBAGENT_ROLES
} as const;

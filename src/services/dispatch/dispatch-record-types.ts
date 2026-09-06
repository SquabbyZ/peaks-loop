import type { SubAgentToolCall } from './sub-agent-dispatcher.js';

/** G6.3 Heartbeat entry — single update written by a running sub-agent. */
export interface Heartbeat {
  readonly at: string;
  readonly status: HeartbeatStatus;
  readonly progress: number;
  readonly note: string | null;
}

export type HeartbeatStatus =
  | 'queued'
  | 'running'
  | 'finalizing'
  | 'done'
  | 'failed'
  | 'stale'
  // Slice 2026-07-29-dispatch-stall-governance / S2 — align the per-
  // heartbeat vocabulary with the dispatch record's aggregate status
  // union so a sub-agent can report any aggregate state through the
  // heartbeat CLI (and the help text enumerates the same set the
  // writer accepts). See tests/unit/dispatch/heartbeat-parity.test.ts
  // for the pinned CLI↔writer parity assertion (AC-2.2).
  | 'cancelled'
  | 'no-execution'
  | 'never-started'
  | 'unreadable';

export type DispatchRecordStatus =
  | 'queued'
  | 'running'
  | 'finalizing'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'no-execution'
  | 'stale'
  // Slice 2026-07-29-dispatch-stall-governance / S1 — distinguish
  // *never-started* (record written, no first heartbeat within the
  // startup budget) from `stale` (heartbeat seen, then quiet) and from
  // `unreadable` (record body corrupt / unparseable). The startup-
  // timeout service in ./startup-timeout.ts is the canonical writer.
  | 'never-started'
  | 'unreadable';

export type DispatchOutcome =
  | 'success'
  | 'failed'
  | 'timeout'
  | 'cancelled'
  | 'no-execution';

/** G2+G5+G6 dispatch record schema (AC-26 + AC-34). */
export interface DispatchRecord {
  /**
   * Slice 2026-07-29-worktree-l2-extended Part 4.C: schema v3 makes
   * `leaseId` a structurally required field (was `leaseId?: string | null`
   * in v2). The v3 upgrade is a "fill in" migration: every dispatch
   * writer knows its lease id at construction time (Part 2.C's
   * --isolation worktree spawns it; non-isolation dispatches stamp
   * `null`). Readers tolerate both v2 and v3 on disk (see
   * `upgradeRecord`); the `?` was a Part 4.A ergonomic concession
   * to keep 4 unit-test literal sites from breaking the build. v3
   * moves the optional off the type and adds the field to the
   * 4 literal sites in one pass.
   *
   * Slice 2026-07-29-worktree-l2-extended Part 7: schema v3.1 adds
   * `isolationStartedAt: string | null` for the L4 isolation
   * bridge (Part 8 container POC). It's the ISO timestamp of
   * when the isolation mode was set up (e.g. when the worktree
   * was spawned). `null` means the dispatch did not request
   * isolation. The `version` field stays at 3 because the
   * v3 → v3.1 transition is additive; the new field is
   * defaulted to `null` on read so v3 records upgrade cleanly.
   */
  /**
   * Phase A Task 8: schema bumped to v4.1.0 (additive). The bump
   * is purely additive — new fields (`mode`, `vendor`,
   * `autoCompactEvents`, `tokenUsage`) all default safely on
   * read for legacy v4.0.0 / v3.2 / v3.1 / v3 / v2 / v1 records.
   * No existing field semantics changed.
   */
  readonly version: '4.1.0';
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly outcome: DispatchOutcome;
  readonly artifactPaths: readonly string[];
  readonly disposed: boolean;
  readonly disposedAt: string | null;
  readonly role: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly prompt: string;
  readonly toolCall: SubAgentToolCall;
  /** G5 batch id (AC-27) — uuid-like opaque token grouping one batch. */
  readonly batchId: string;
  /** G6 fields (AC-34) — backward compat: defaults on read. */
  readonly heartbeats: readonly Heartbeat[];
  readonly lastBeatAt: string | null;
  readonly status: DispatchRecordStatus;
  // Slice 2026-07-29-dispatch-stall-governance / S5 (AC-5.1) — bounded,
  // machine-readable stage label. Free-form `note` was never a stage
  // — the value is one of a small enum in ./stage-enum.ts (PB-2: a
  // legacy record missing this field upgrades to `null`, not an
  // empty string, so the watch surface can distinguish "no stage
  // ever emitted" from "stage: ''").
  readonly stage: string | null;
  /**
   * Slice 2026-07-29-worktree-l2-extended Part 3.A + Part 4.C: the
   * worktree lease id stamped on this dispatch (via `peaks sub-agent
   * dispatch --isolation worktree`). The release hook (see
   * markCompleted + `peaks sub-agent heartbeat --status done`)
   * reads this field to auto-call `peaks worktree release` when
   * the sub-agent finalizes. `null` means the dispatch did not
   * request isolation and no release will fire. Persisted for
   * audit + idempotency so a re-read of an old record still
   * surfaces the lease id even if the on-disk lease file has since
   * been gc'd.
   *
   * v3 (Part 4.C) makes this structurally required. v2 records
   * missing the field upgrade to `null` on read (see
   * `upgradeRecord`).
   */
  readonly leaseId: string | null;
  /**
   * Slice 2026-07-29-worktree-l2-extended Part 7: ISO timestamp of
   * when the isolation mode was set up. For `--isolation worktree`
   * this is the moment `peaks worktree spawn` returned; for
   * `--isolation container` (Part 8) it's when the container
   * runtime reported the container as running. `null` when the
   * dispatch did not request isolation. Lets the dashboard
   * compute isolation duration (now - isolationStartedAt) without
   * cross-referencing the metrics stream.
   */
  readonly isolationStartedAt: string | null;
  /**
   * Slice 2026-08-01-subagent-merge-and-e2e (Task 7): v3.2 schema
   * bump. One entry per pid the parent best-effort-killed during
   * the service-shutdown phase of the merge-back pipeline (see
   * src/services/dispatch/service-shutdown.ts). Empty array when
   * the sub-agent did not register any services. The shape is the
   * union of ServiceKillOutcome (skipped=false) and
   * ServiceKillSkipped (skipped=true) — kept as a plain object
   * here so the on-disk schema does not lock onto the helper's
   * narrower union. The reader (merge-back-runner.ts) interprets
   * each entry based on the `skipped` field.
   */
  readonly serviceKill: ReadonlyArray<{
    readonly pid: number;
    readonly name: string;
    readonly signal: string;
    readonly exitCode: number | null;
    readonly skipped?: boolean;
    readonly reason?: string;
  }>;
  /**
   * Slice 2026-08-01-subagent-merge-and-e2e (Task 7): v3.2 schema
   * bump. Counts how many merge attempts the parent session has
   * made against this dispatch's branch. The conflict-replay
   * orchestrator bumps this on each retry (bounded to ONE re-dispatch
   * per merge attempt; multi-conflict cases escalate). Persisted so
   * the dashboard can render the retry count without replaying the
   * merge transcript.
   */
  readonly mergeBackAttempts: number;
  /**
   * Slice 4.0.8 RD §4 D4c (presence-lease-graph): the workflow id +
   * graph node id + graphRef this dispatch is bound to. Persisted
   * directly in the dispatch record (NOT in a sidecar) so the
   * envelope-writer `markCompleted` can auto-transition the bound
   * graph node to `envelope-received` with `ackStatus=pending` in
   * one protected update.
   *
   * The schema bump from `3.2 → 4.0.0` is BREAKING in the sense
   * that the literal type is narrowed. The optional `?` keeps back-
   * compat for old records that pre-date the binding (the
   * `upgradeRecord` reader defaults them to `null`).
   */
  readonly workflowId: string | null;
  readonly graphNodeId: string | null;
  readonly graphRef: string | null;
  /**
   * Phase A Task 8: dispatch execution mode. `in-process` is the
   * current behavior (LLM-side runner, no separate OS process).
   * `detached` is the new path: `peaks sub-agent dispatch --mode
   * detached` spawns a real child OS process running a different
   * LLM vendor (claude / codex / copilot) and reports back via
   * the dispatch record. v4.1.0 is the additive bump; legacy v4.0.0
   * records upgrade to `in-process` on read.
   */
  readonly mode: 'in-process' | 'detached';
  /**
   * Phase A Task 8: vendor id when `mode='detached'`. `null` when
   * the dispatch is in-process. Reserved for future use; current
   * detached sub-agents use `claude` but the schema also accepts
   * `codex` and `copilot` for the vendor-neutral adapter layer.
   */
  readonly vendor: 'claude' | 'codex' | 'copilot' | null;
  /**
   * Phase A Task 8: G8 autoCompact events accumulated by the child
   * LLM during a detached run. Each event records the threshold
   * that fired (0.85 = first warning, 0.95 = second warning) plus
   * token counts before/after. Empty for in-process dispatches
   * and for legacy records upgraded on read.
   */
  readonly autoCompactEvents: ReadonlyArray<{
    readonly at: number;
    readonly threshold: '0.85' | '0.95';
    readonly tokensBefore: number;
    readonly tokensAfter: number;
    readonly scratchFile?: string;
  }>;
  /**
   * Phase A Task 8: G8 token-usage accounting for detached sub-agents.
   * Detached runs have "unlimited spend but recorded" semantics —
   * the cost is recorded for audit but not enforced. `null` when
   * the dispatch is in-process (no detached accounting) or for
   * legacy records upgraded on read.
   */
  readonly tokenUsage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalCostUsd?: number;
  } | null;
}

/** Input for the initial write. */
export type WriteInitialDispatchInput = {
  projectRoot: string;
  sessionId: string;
  requestId: string;
  role: string;
  prompt: string;
  toolCall: SubAgentToolCall;
  batchId: string;
  /** Override the timestamp (testing). */
  now?: () => Date;
  /**
   * Slice 2026-07-29-worktree-l2-extended Part 3.A: the worktree
   * lease id this dispatch owns (set by `peaks sub-agent dispatch
   * --isolation worktree`). Persisted so the finalize-time release
   * hook in `markCompleted` can fire even after the dispatch
   * process exits. Optional; absent when the dispatch did not
   * request isolation.
   */
  leaseId?: string | null;
  /**
   * Slice 2026-07-29-worktree-l2-extended Part 7: ISO timestamp
   * when the isolation mode was set up. Optional on the input
   * (defaults to `null`); dispatch-commands.ts passes the spawn
   * time when `--isolation` is requested.
   */
  isolationStartedAt?: string | null;
  /**
   * Slice 4.0.8: workflow graph binding for the dispatch. Defaults
   * to `null` so a non-graph dispatch (legacy CLI flow, ad-hoc
   * dispatch) still writes a v4.0.0 record.
   */
  workflowId?: string | null;
  graphNodeId?: string | null;
  graphRef?: string | null;
  /**
   * Phase A Task 8: dispatch execution mode. Default `'in-process'`
   * preserves the current LLM-side runner behavior. `'detached'`
   * triggers the new real-OS-process path via
   * `peaks sub-agent dispatch --mode detached`.
   */
  mode?: 'in-process' | 'detached';
  /**
   * Phase A Task 8: vendor id when `mode='detached'`. Required by
   * the adapter layer to know which CLI / runtime to spawn. The
   * schema accepts the three vendors peaks-loop has adapters for
   * (claude / codex / copilot). Ignored when `mode='in-process'`.
   */
  vendor?: 'claude' | 'codex' | 'copilot';
  /**
   * Phase A Task 8: G8 autoCompact events accumulated by the child
   * LLM. Optional on input — most dispatches start with an empty
   * array and the detached runner appends events as they fire.
   */
  autoCompactEvents?: Array<{
    at: number;
    threshold: '0.85' | '0.95';
    tokensBefore: number;
    tokensAfter: number;
    scratchFile?: string;
  }>;
  /**
   * Phase A Task 8: G8 token-usage accounting. Detached runs
   * record spend for audit (unlimited, but persisted). Optional
   * on input; the detached runner fills this in as it streams
   * usage from the vendor API.
   */
  tokenUsage?: { promptTokens: number; completionTokens: number; totalCostUsd?: number };
};

/** Heartbeat write input. */
export type AppendHeartbeatInput = {
  recordPath: string;
  status: HeartbeatStatus;
  progress: number;
  note?: string;
  now?: () => Date;
};

/** Lifecycle transition input. */
export type LifecycleInput = {
  recordPath: string;
  outcome: DispatchOutcome;
  status: DispatchRecordStatus;
  artifactPaths?: readonly string[];
  now?: () => Date;
  /**
   * Slice 2026-06-23-audit-4th #A4: trusted project root. Required
   * so the active-dispatches index can be updated without deriving
   * the root from the recordPath (the same anti-pattern that
   * audit-3rd #1 fixed for heartbeat). The CLI / LLM-side runner
   * passes this from `--project` or `process.cwd()`.
   */
  projectRoot?: string;
};

/**
 * PRD-002b slice 2 — extract dispatch-record size budgets (max-prompt
 * bytes, note truncation cap) + time-math primitives so the
 * no-magic-numbers rule stops flagging the writer pipeline.
 */
const BYTES_PER_KB = 1024;
const MAX_PROMPT_KB = 256;
export const MAX_PROMPT_BYTES = MAX_PROMPT_KB * BYTES_PER_KB;
export const NOTE_MAX_CHARS = 200;
const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
export const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const REDACTION_MAX_SCAN_DEPTH = 20;

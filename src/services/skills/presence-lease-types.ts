/**
 * Skill presence lease types (RD §2 — slice 4.0.8 presence-lease-graph).
 *
 * Pure type definitions for the canonical lease + caller index shapes.
 * These types are the contract for `.peaks/_runtime/<sid>/leases/...` and
 * `.peaks/_runtime/<sid>/presence-index/...` writes. No vendor env
 * lookups; no filesystem I/O.
 */

import type { LeaseStatus, TerminalReason } from '../workflow/workflow-graph-types.js';

/**
 * The time primitives the two stale windows are built from.
 *
 * The repo's existing lease-TTL idiom (`container-lease.ts`,
 * `worktree-lease.ts`, `dispatch-record-types.ts`): the minute/hour math
 * lives in named constants, so the `no-magic-numbers` rule has nothing left
 * to flag in the windows themselves.
 */
const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = MINUTES_PER_HOUR * 1_000;
const HOURS_PER_DAY = 24;
const STALE_STARTED_BUFFER_MINUTES = 30;

/**
 * The lease heartbeat-stale window (1h) — the canonical lease-GC
 * heartbeat predicate. Also the window the presence READ uses to decide
 * that a lease is no longer driving the work.
 */
export const STALE_HEARTBEAT_MS = MINUTES_PER_HOUR * MS_PER_MINUTE;

/**
 * The lease start-stale window (24h30m) — the canonical lease-GC start
 * predicate. RD §3 calls for >24h; the +30m buffer disambiguates leases
 * that started in the 24-25h window so only leases older than 24h30m are
 * GC'd. It is also the window a `mode: '24h'` lease is held to: a 24h
 * run must not lose its presence after one hour just because nothing
 * refreshes the lease heartbeat while the run is in flight.
 */
export const STALE_STARTED_AFTER_MS =
  HOURS_PER_DAY * MINUTES_PER_HOUR * MS_PER_MINUTE + STALE_STARTED_BUFFER_MINUTES * MS_PER_MINUTE;

export interface SkillPresenceLease {
  readonly callerId: string;
  readonly workflowId: string;
  readonly graphRef: string;
  readonly skill: string;
  readonly parentWorkflowId?: string;
  /**
   * Execution mode recorded on the lease (`full-auto` | `assisted` |
   * `strict` | `24h`). Optional: leases written before the mode was
   * stamped carry no `mode` field.
   */
  readonly mode?: string;
  /**
   * The gate the presence is parked on (`startup`, `swarm-fan-out`, …).
   *
   * Optional and additive: a lease written by an older release carries
   * no `gate` field and still loads. The field is what makes the middle
   * cell of the status header
   * (`Peaks-Loop Skill: <skill> | Peaks-Loop Gate: <gate> | Next: …`)
   * a machine fact instead of model-invented prose.
   */
  readonly gate?: string;
  readonly depth: number;
  readonly startedAt: string;
  readonly lastHeartbeat: string;
  readonly terminalAt?: string;
  readonly terminalReason?: TerminalReason;
  readonly status: LeaseStatus;
  readonly schemaVersion: 1;
}

/**
 * `PresenceIndex` — additive read index at
 * `.peaks/_runtime/<sid>/presence-index/<callerId>.json`. Stores only
 * the active lease reference (no lifecycle fields); readers can find
 * the active lease in O(1) without enumerating the leases dir.
 */
export interface PresenceIndex {
  readonly callerId: string;
  readonly sessionId: string;
  readonly leaseRef: string;
  readonly workflowId: string;
  readonly graphRef: string;
  readonly updatedAt: string;
  readonly schemaVersion: 1;
}

/**
 * `PresenceProjection` — the canonical envelope returned by
 * `readPresenceLease` / `setPresenceLease`. Combines lease + index +
 * graph info into a single typed record that hook consumers and the
 * statusline already know how to render.
 */
export interface PresenceProjection {
  readonly active: boolean;
  readonly legacyPresence: boolean;
  readonly lease: SkillPresenceLease | null;
  readonly index: PresenceIndex | null;
  readonly callerId: string;
  readonly sessionId: string | null;
  readonly skill: string;
  readonly mode?: string;
  readonly gate?: string;
  readonly setAt: string | null;
  readonly lastHeartbeat: string | null;
}

/** Gc result — additive so existing presence consumers can ignore. */
export interface GcResult {
  readonly removed: number;
  readonly retained: number;
  readonly trigger: 'manual' | 'workspace-init' | 'presence-set';
  readonly inFlightBatch: boolean;
  readonly warnings: ReadonlyArray<{ code: string; leaseRef: string; message: string }>;
  readonly errors: ReadonlyArray<{ code: string; leaseRef: string; message: string }>;
}

// Re-export the 4.0.8 typed error union + projection shape from
// caller-id-types so lease consumers can branch on the canonical code
// without importing the session service directly. The error code
// `PEAKS_CALLER_NOT_RESOLVED` is the only failure path for
// resolveCallerId in 4.0.8; `PEAKS_SESSION_NOT_BOUND` is the
// companion failure when setPresenceLease is called without a
// bound session.
export {
  PEAKS_CALLER_NOT_RESOLVED,
  PEAKS_SESSION_NOT_BOUND,
  PEAKS_GRAPH_REF_BROKEN
} from '../workflow/workflow-graph-store.js';

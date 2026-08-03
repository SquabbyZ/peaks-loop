/**
 * Skill presence lease types (RD §2 — slice 4.0.8 presence-lease-graph).
 *
 * Pure type definitions for the canonical lease + caller index shapes.
 * These types are the contract for `.peaks/_runtime/<sid>/leases/...` and
 * `.peaks/_runtime/<sid>/presence-index/...` writes. No vendor env
 * lookups; no filesystem I/O.
 */

import type { LeaseStatus, TerminalReason } from '../workflow/workflow-graph-types.js';

export interface SkillPresenceLease {
  readonly callerId: string;
  readonly workflowId: string;
  readonly graphRef: string;
  readonly skill: string;
  readonly parentWorkflowId?: string;
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
  PEAKS_GRAPH_REF_BROKEN,
} from '../workflow/workflow-graph-store.js';

/**
 * Deterministic presence-lease selection — pure rules, no filesystem I/O.
 *
 * WHY THIS MODULE EXISTS. The canonical presence read used to look at ONE
 * session tree — the tree the caller is bound to — and answered "inactive"
 * whenever that tree had no in-flight lease. A peaks run whose lease landed
 * in a different tree (a sibling session, a rotated session, a session the
 * caller-id resolution could not reach) was therefore invisible:
 * `peaks skill presence --json` reported `{"active": false}` while a live
 * lease sat on disk. The rules live here, free of I/O, so they can be
 * unit-tested directly against fixture lease sets.
 *
 * THE RULES (in order):
 *
 *   1. ELIGIBLE = not terminal AND not stale.
 *
 *      - terminal: `terminalAt` is set, or `status` is outside
 *        {`running`, `preparing`} — a lease that already reached its end
 *        state is never reported as driving the work.
 *      - stale: `now - lastHeartbeat` is past the lease's OWN window
 *        (`staleThresholdMs`). Nothing refreshes a lease heartbeat on a
 *        cadence, so a lease left behind by a finished session would
 *        otherwise keep reporting "active" forever.
 *
 *   2. SCOPE. When the BOUND tree (the tree the caller is bound to) holds
 *      at least one eligible lease, only bound-tree leases are selectable:
 *      the bound tree is the caller's own state and keeps its precedence.
 *      Only when the bound tree has NO eligible lease do the other trees'
 *      leases become selectable — that is the cross-session fallback.
 *
 *   3. ORDER. Freshest heartbeat first, then freshest start, then
 *      sessionId, callerId, workflowId. The tail is a total order, so the
 *      same lease set always names the same winner — no `readdirSync`
 *      order leaks into the answer.
 */

import { comparePresenceLeases } from './presence-lease-order.js';
import {
  STALE_HEARTBEAT_MS,
  STALE_STARTED_AFTER_MS,
  type SkillPresenceLease
} from './presence-lease-types.js';

/** Which tree a candidate lease was read from. */
export type PresenceLeaseScope = 'bound' | 'other';

export type PresenceLeaseCandidate = {
  readonly lease: SkillPresenceLease;
  /** The session tree the lease was read from. */
  readonly sessionId: string;
  readonly scope: PresenceLeaseScope;
};

export type PresenceLeaseSelection = {
  readonly lease: SkillPresenceLease;
  readonly sessionId: string;
  readonly scope: PresenceLeaseScope;
};

/** Why the read found no active lease. */
export type PresenceInactiveReason =
  | 'no-leases'
  | 'all-terminal'
  | 'all-stale'
  | 'terminal-and-stale'
  /** Defensive: the caller passed a candidate set that DOES hold an eligible lease. */
  | 'eligible-present';

export type PresenceInactiveDiagnostic = {
  readonly reason: PresenceInactiveReason;
  readonly leaseCount: number;
  readonly terminalCount: number;
  readonly staleCount: number;
  readonly eligibleCount: number;
};

/**
 * The stale window that applies to THIS lease.
 *
 * `24h` leases get the 24h run's own window (`STALE_STARTED_AFTER_MS`,
 * 24h30m — the canonical lease-GC start predicate); every other lease
 * gets the canonical heartbeat window (`STALE_HEARTBEAT_MS`, 1h). A 24h
 * run must not lose its presence after one hour just because nothing
 * refreshes the lease heartbeat while the run is in flight.
 */
export function staleThresholdMs(lease: SkillPresenceLease): number {
  return lease.mode === '24h' ? STALE_STARTED_AFTER_MS : STALE_HEARTBEAT_MS;
}

/** A lease that reached its end state — never reported as active. */
export function isTerminalPresenceLease(lease: SkillPresenceLease): boolean {
  if (typeof lease.terminalAt === 'string' && lease.terminalAt.length > 0) return true;
  return lease.status !== 'running' && lease.status !== 'preparing';
}

/** A lease whose heartbeat is older than its window — never reported as active. */
export function isStalePresenceLease(lease: SkillPresenceLease, nowMs: number): boolean {
  const heartbeatMs = Date.parse(lease.lastHeartbeat);
  // An unparseable heartbeat carries no liveness signal — treat it as
  // stale (fail closed) rather than reporting a lease we cannot date.
  if (!Number.isFinite(heartbeatMs)) return true;
  return nowMs - heartbeatMs > staleThresholdMs(lease);
}

/** A lease that may be reported as the active presence. */
export function isEligiblePresenceLease(lease: SkillPresenceLease, nowMs: number): boolean {
  return !isTerminalPresenceLease(lease) && !isStalePresenceLease(lease, nowMs);
}

/**
 * Total order over candidates: freshest heartbeat, then freshest start,
 * then sessionId, callerId, workflowId.
 */
function compareCandidates(a: PresenceLeaseCandidate, b: PresenceLeaseCandidate): number {
  const byLease = comparePresenceLeases(a.lease, b.lease);
  if (byLease !== 0) return byLease;
  const bySession = a.sessionId.localeCompare(b.sessionId);
  if (bySession !== 0) return bySession;
  const byCaller = a.lease.callerId.localeCompare(b.lease.callerId);
  if (byCaller !== 0) return byCaller;
  return a.lease.workflowId.localeCompare(b.lease.workflowId);
}

/**
 * Pick the lease that represents "who is driving peaks right now".
 *
 * Returns `null` when no candidate is eligible — the caller answers
 * "inactive" (never an optimistic default).
 */
export function selectActivePresenceLease(
  candidates: readonly PresenceLeaseCandidate[],
  nowMs: number
): PresenceLeaseSelection | null {
  const eligible = candidates.filter((c) => isEligiblePresenceLease(c.lease, nowMs));
  if (eligible.length === 0) return null;
  const bound = eligible.filter((c) => c.scope === 'bound');
  const pool = bound.length > 0 ? bound : eligible;
  const sorted = pool.slice().sort(compareCandidates);
  return sorted[0] ?? null;
}

/**
 * Explain why the read found nothing active.
 *
 * Precondition: called only when `selectActivePresenceLease` returned
 * `null` (so `eligibleCount` is 0). The `eligible-present` reason is a
 * defensive branch for a caller that violates that precondition.
 */
export function explainInactivePresence(
  candidates: readonly PresenceLeaseCandidate[],
  nowMs: number
): PresenceInactiveDiagnostic {
  let terminalCount = 0;
  let staleCount = 0;
  let eligibleCount = 0;
  for (const candidate of candidates) {
    if (isTerminalPresenceLease(candidate.lease)) {
      terminalCount += 1;
      continue;
    }
    if (isStalePresenceLease(candidate.lease, nowMs)) {
      staleCount += 1;
      continue;
    }
    eligibleCount += 1;
  }
  const leaseCount = candidates.length;
  let reason: PresenceInactiveReason;
  if (leaseCount === 0) reason = 'no-leases';
  else if (eligibleCount > 0) reason = 'eligible-present';
  else if (terminalCount === leaseCount) reason = 'all-terminal';
  else if (staleCount === leaseCount) reason = 'all-stale';
  else reason = 'terminal-and-stale';
  return { reason, leaseCount, terminalCount, staleCount, eligibleCount };
}

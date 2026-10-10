// Shared ordering for a peaks session's presence leases.
//
// Lives on its own because the three readers that need it — the resolver, the
// statusline projection, and the per-caller legacy read — sit in three modules
// and none of them owns the other. They used to order the same lease set three
// ways (two by heartbeat alone, one with a tie-break), so they could name
// different leases as "who is driving".

import type { SkillPresenceLease } from './presence-lease-types.js';

/**
 * Most recent lease first: `lastHeartbeat` desc, `startedAt` desc as the
 * tie-break.
 *
 * The tie-break is not decorative. Nothing refreshes the on-disk heartbeat
 * today — no caller runs `setPresenceLease` on a cadence — so `lastHeartbeat`
 * frequently equals `startedAt`, and two leases written in the same millisecond
 * tie on heartbeat alone. That tie then falls through to `Array.prototype.sort`
 * stability, i.e. `readdirSync` order, which is the input this ordering exists
 * to stop depending on.
 */
export function comparePresenceLeases(a: SkillPresenceLease, b: SkillPresenceLease): number {
  const byHeartbeat = (b.lastHeartbeat ?? '').localeCompare(a.lastHeartbeat ?? '');
  if (byHeartbeat !== 0) return byHeartbeat;
  return (b.startedAt ?? '').localeCompare(a.startedAt ?? '');
}

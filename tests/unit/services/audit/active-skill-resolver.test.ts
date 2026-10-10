// tests/unit/services/audit/active-skill-resolver.test.ts
//
// `resolveActiveSkillForCaller` walked the session's leases in `readdirSync`
// order and returned the first in-flight one. Its `callerId` filter existed
// but no production call site passed it, so "who is driving" could be
// answered with another caller's lease — and the commit ban keys on exactly
// that answer.
//
// These cases pin the scope against a synthetic project, so the assertion
// does not depend on which leases happen to exist in the real tree.

import { describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveActiveSkillForCaller } from '../../../../src/services/audit/enforcers/active-skill-resolver.js';
import { comparePresenceLeases } from '../../../../src/services/skills/presence-lease-order.js';
import {
  listPresenceLeases,
  setPresenceLease
} from '../../../../src/services/skills/presence-lease-service.js';
import type { SkillPresenceLease } from '../../../../src/services/skills/presence-lease-types.js';

const tmpRoots: string[] = [];
const SESSION = '2026-10-10-session-s0test';

/** Materialise a project root bound to SESSION, with no leases yet. */
function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-resolver-'));
  tmpRoots.push(root);
  const runtime = join(root, '.peaks', '_runtime');
  mkdirSync(runtime, { recursive: true });
  writeFileSync(
    join(runtime, 'session.json'),
    JSON.stringify({ sessionId: SESSION, createdAt: new Date().toISOString(), projectRoot: root })
  );
  return root;
}

/**
 * Write a CANONICAL lease — the path the resolver actually reads.
 *
 * `setSkillPresenceForCaller` writes the LEGACY per-caller file
 * (`active-skill-<callerId>.json`), which the resolver only walks when
 * explicitly asked for `legacyPresence: true`. Using it here makes the
 * fixture invisible to the code under test, and the test then fails with
 * `null` rather than the wrong skill — a red for the wrong reason.
 */
function writeLease(root: string, callerId: string, skill: string, now?: string): void {
  setPresenceLease({
    projectRoot: root,
    sessionId: SESSION,
    callerId,
    workflowId: callerId,
    graphRef: `graphs/${callerId}.json`,
    skill,
    ...(now !== undefined ? { now } : {})
  });
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('resolveActiveSkillForCaller — caller scoping', () => {
  it('answers for the caller it was asked about, not the first lease on disk', () => {
    const root = makeProject();
    writeLease(root, 'caller-a', 'peaks-code');
    writeLease(root, 'caller-b', 'peaks-race-code');

    const resolved = resolveActiveSkillForCaller(root, { callerId: 'caller-b' });

    expect(resolved.skill).toBe('peaks-race-code');
  });
});

// The ordering rule itself, pinned deterministically. The resolver test below
// cannot be deterministic about "which lease the disk yields first" — that is
// `readdirSync` order, which Node does not guarantee and which differs across
// the CI matrix — so the rule is pinned here instead.
describe('comparePresenceLeases', () => {
  const lease = (over: Partial<SkillPresenceLease>): SkillPresenceLease =>
    ({
      callerId: 'c',
      workflowId: 'c',
      graphRef: 'graphs/c.json',
      skill: 'peaks-code',
      depth: 0,
      startedAt: '2026-10-10T00:00:00.000Z',
      lastHeartbeat: '2026-10-10T00:00:00.000Z',
      status: 'running',
      schemaVersion: 1,
      ...over
    }) as SkillPresenceLease;

  it('ranks the newer heartbeat first', () => {
    const older = lease({ callerId: 'older', lastHeartbeat: '2026-10-10T00:00:00.000Z' });
    const newer = lease({ callerId: 'newer', lastHeartbeat: '2026-10-10T09:00:00.000Z' });
    expect([older, newer].sort(comparePresenceLeases)[0]?.callerId).toBe('newer');
  });

  it('breaks a heartbeat tie on startedAt, so the order cannot fall to readdir', () => {
    // Heartbeats are not refreshed today, so `lastHeartbeat` frequently equals
    // `startedAt` and two leases written in one millisecond tie outright.
    const tie = '2026-10-10T12:00:00.000Z';
    const older = lease({
      callerId: 'older',
      lastHeartbeat: tie,
      startedAt: '2026-10-10T01:00:00.000Z'
    });
    const newer = lease({
      callerId: 'newer',
      lastHeartbeat: tie,
      startedAt: '2026-10-10T09:00:00.000Z'
    });
    expect([older, newer].sort(comparePresenceLeases)[0]?.callerId).toBe('newer');
    expect([newer, older].sort(comparePresenceLeases)[0]?.callerId).toBe('newer');
  });

  it('ranks a preparing lease by its timestamps, not by its status', () => {
    const preparingNewer = lease({
      callerId: 'preparing',
      status: 'preparing',
      lastHeartbeat: '2026-10-10T09:00:00.000Z'
    });
    const runningOlder = lease({
      callerId: 'running',
      status: 'running',
      lastHeartbeat: '2026-10-10T08:00:00.000Z'
    });
    expect([runningOlder, preparingNewer].sort(comparePresenceLeases)[0]?.callerId).toBe(
      'preparing'
    );
    expect([preparingNewer, runningOlder].sort(comparePresenceLeases)[0]?.callerId).toBe(
      'preparing'
    );
  });
});

// Two readers of one lease set used to name different leases: the statusline
// sorted, the resolver took `readdirSync` order. Both now go through
// `comparePresenceLeases`.
describe('resolveActiveSkillForCaller — no callerId: the freshest lease wins', () => {
  it('agrees with the shared comparator about which lease is the driver', () => {
    const root = makeProject();
    writeLease(root, 'caller-a', 'peaks-code', '2026-10-10T00:00:00.000Z');
    writeLease(root, 'caller-z', 'peaks-race-code', '2026-10-10T09:00:00.000Z');

    const leases = listPresenceLeases(root, SESSION);
    // Not vacuous: two in-flight leases with different heartbeats, so "the
    // first one on disk" and "the freshest one" are different leases for at
    // least one of the two possible directory orders.
    expect(leases.length).toBe(2);
    expect(new Set(leases.map((l) => l.lastHeartbeat)).size).toBe(2);

    const expected = [...leases].sort(comparePresenceLeases)[0];
    expect(resolveActiveSkillForCaller(root).skill).toBe(expected?.skill);
  });
});

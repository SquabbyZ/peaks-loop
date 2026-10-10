// tests/unit/services/audit/active-skill-resolver.test.ts
//
// S0 (plan 2026-10-10-driver-resolution-and-commit-ban, Task 2).
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
import { setPresenceLease } from '../../../../src/services/skills/presence-lease-service.js';

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
function writeLease(root: string, callerId: string, skill: string): void {
  setPresenceLease({
    projectRoot: root,
    sessionId: SESSION,
    callerId,
    workflowId: callerId,
    graphRef: `graphs/${callerId}.json`,
    skill,
    status: 'running'
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

/**
 * Slice rid-skill-persistence-001 (2026-08-12) — drift guard.
 *
 * Verifies the outerSessionId intent-source guard added to
 * `clearStalePresenceOnRotation`. Per the user constraint in
 * `.peaks/memory/2026-08-11-peaks-code-skill-persistence-pause.md`,
 * the auto-clear path must only fire when the caller-binding supplies
 * a user-explicit intent source (`currentOuterSessionId` truthy). When
 * the rotation is system-triggered (`currentOuterSessionId` undefined),
 * the function must refuse the mutation up-front so user-explicit
 * presence state survives.
 *
 * Coverage: 6 cases.
 *   1. user-explicit intent (`currentOuterSessionId` provided) +
 *      recorded-outer === rotated-out → CLEAR (outer-session-mismatch)
 *   2. same skill + outer mismatch (recorded === current) → KEEP (not-stale)
 *   3. live-different-outer (recorded !== rotated-out) → KEEP
 *      (recorded-by-different-outer)
 *   4. user-explicit intent + recorded === current → no clear (not-stale)
 *   5. no-intent-source (currentOuterSessionId undefined) → KEEP
 *      regardless of recorded state
 *   6. no-presence (no in-flight leases) → KEEP (no-presence)
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearStalePresenceOnRotation,
} from '../../../src/services/skills/skill-presence-service.js';
import { setPresenceLease } from '../../../src/services/skills/presence-lease-service.js';

const projects: string[] = [];

function newProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-persistence-rotation-'));
  projects.push(root);
  // Write a minimal session.json so `getSessionId` resolves via the
  // legacy session.json fallback (the caller-binding primary path
  // requires adapter env vars which the test does not set).
  const sessionDir = join(root, '.peaks', '_runtime');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    join(sessionDir, 'session.json'),
    JSON.stringify({
      sessionId: 'session-persistence-rotation',
      projectRoot: resolve(root)
    }),
    'utf8'
  );
  return root;
}

function input(root: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    projectRoot: root,
    sessionId: 'session-persistence-rotation',
    callerId: 'caller-rotation',
    workflowId: 'wf-rotation-compat',
    graphRef: 'graphs/wf-rotation-compat.json',
    skill: 'peaks-code',
    depth: 0,
    now: '2026-08-12T10:00:00.000Z',
    ...overrides,
  };
}

/**
 * Stage the pre-4.0.11 single-slot presence file
 * (`.peaks/_runtime/active-skill.json`) so the legacy `clearSkillPresence`
 * compat shim has a target to unlink. The function under test delegates
 * the actual filesystem mutation to this shim; without a target the
 * cleared flag reports false even though the branch was reached.
 */
function writeLegacyPresenceSlot(root: string, outerSessionId: string): void {
  writeFileSync(
    join(root, '.peaks', '_runtime', 'active-skill.json'),
    JSON.stringify({
      skill: 'peaks-code',
      outerSessionId,
      setAt: '2026-08-12T09:00:00.000Z'
    }),
    'utf8'
  );
}

beforeEach(() => {
  // The presence-lease service reads `PEAKS_CALLER_ID` via
  // resolveCallerProjection. We do NOT want the harness caller-id
  // leaking into lease setup; clear it explicitly.
  delete process.env.PEAKS_CALLER_ID;
});

afterEach(() => {
  for (const root of projects.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('slice rid-skill-persistence-001: clearStalePresenceOnRotation outerSessionId guard', () => {
  it('cleared when user-explicit intent + recorded-outer === rotated-out → CLEAR', () => {
    // recorded outer === rotated-out, currentOuterSessionId provided
    // (user-explicit caller binding). The legacy 3-branch logic
    // reaches the "outer-session-mismatch" stale-clear path. The
    // pre-4.0.11 single-slot file is staged so `clearSkillPresence`
    // (the compat shim) actually has a target to unlink — without
    // it the cleared flag would report false even though the branch
    // was reached.
    const root = newProject();
    setPresenceLease(input(root, { callerId: 'old-outer-id' }));
    writeLegacyPresenceSlot(root, 'old-outer-id');
    const outcome = clearStalePresenceOnRotation({
      projectRootOverride: root,
      currentOuterSessionId: 'new-outer-id',
      rotatedOutSessionId: 'old-outer-id',
    });
    expect(outcome.cleared).toBe(true);
    expect(outcome.reason).toBe('outer-session-mismatch');
    expect(outcome.recordedOuter).toBe('old-outer-id');
  });

  it('same skill + outer mismatch (recorded === current) → KEEP (not-stale)', () => {
    // recorded outer === current outer = reconnect path. Even with a
    // rotatedOutSessionId supplied, the reconnect guard wins.
    const root = newProject();
    setPresenceLease(input(root, { callerId: 'shared-outer' }));
    const outcome = clearStalePresenceOnRotation({
      projectRootOverride: root,
      currentOuterSessionId: 'shared-outer',
      rotatedOutSessionId: 'old-outer-id',
    });
    expect(outcome.cleared).toBe(false);
    expect(outcome.reason).toBe('not-stale');
    expect(outcome.recordedOuter).toBe('shared-outer');
  });

  it('live-different-outer (recorded !== rotated-out) → KEEP (recorded-by-different-outer)', () => {
    // recorded outer belongs to a DIFFERENT live outer session, not
    // the one being rotated out. Clear would destroy another user's
    // mode choice.
    const root = newProject();
    setPresenceLease(input(root, { callerId: 'live-other-outer' }));
    const outcome = clearStalePresenceOnRotation({
      projectRootOverride: root,
      currentOuterSessionId: 'new-outer-id',
      rotatedOutSessionId: 'old-outer-id',
    });
    expect(outcome.cleared).toBe(false);
    expect(outcome.reason).toBe('recorded-by-different-outer');
    expect(outcome.recordedOuter).toBe('live-other-outer');
  });

  it('user-explicit intent but recorded outer matches current outer → no clear', () => {
    // The recorded outer === current outer case where rotatedOut is
    // null (no rotation, just a redundant call). The reconnect-style
    // guard at the top still resolves to "not-stale".
    const root = newProject();
    setPresenceLease(input(root, { callerId: 'shared-outer' }));
    const outcome = clearStalePresenceOnRotation({
      projectRootOverride: root,
      currentOuterSessionId: 'shared-outer',
      rotatedOutSessionId: null,
    });
    expect(outcome.cleared).toBe(false);
    expect(outcome.reason).toBe('not-stale');
  });

  it('no-intent-source (currentOuterSessionId undefined) → KEEP regardless of recorded state', () => {
    // The new outerSessionId guard: when the caller-binding has no
    // outerSessionId (system-triggered rotation, no harness env var),
    // the function refuses the mutation up-front. This is the core
    // user constraint from the memory file.
    const root = newProject();
    setPresenceLease(input(root, { callerId: 'legacy-outer' }));
    const outcome = clearStalePresenceOnRotation({
      projectRootOverride: root,
      currentOuterSessionId: undefined,
      rotatedOutSessionId: 'legacy-outer',
    });
    expect(outcome.cleared).toBe(false);
    expect(outcome.reason).toBe('no-intent-source');
    // recordedOuter is intentionally absent on the no-intent-source
    // path because we short-circuit before reading the lease state.
    expect(outcome.recordedOuter).toBeUndefined();
  });

  it('no-presence (no in-flight leases) → KEEP (no-presence)', () => {
    // Edge case: there is no recorded presence at all. The function
    // returns the existing `no-presence` reason without touching any
    // filesystem state.
    const root = newProject();
    const outcome = clearStalePresenceOnRotation({
      projectRootOverride: root,
      currentOuterSessionId: 'new-outer-id',
      rotatedOutSessionId: 'old-outer-id',
    });
    expect(outcome.cleared).toBe(false);
    expect(outcome.reason).toBe('no-presence');
  });
});

// tests/unit/skills/skill-statusline-canonical-only.test.ts
//
// 4-dimension unit test for slice 2026-08-05-statusline-sid-scoped-lease-B.
//
// Pre-condition: slice 4-A already removed the write path to
// `.peaks/_runtime/active-skill.json`. This slice completes the cleanup by
// removing the read fallback too. `skill-statusline-service.readPresenceReadOnly`
// is now sid-scoped-lease-only: no `active-skill.json` walk, no legacy
// presence file fallback.
//
// The 4 cases pin every documented branch of the new read:
//
//   Case A: 2 leases for different callerIds, statusline reads only the
//           matching callerId (read-side isolation, regression for the
//           4.0.8 dual-skill problem).
//   Case B: 0 leases → returns idle (presence=null).
//   Case C: callerId with no matching lease → returns idle (presence=null).
//   Case D: callerId=null branch picks the most recent in-flight lease
//           (back-compat for non-IDE callers).
//
// Dimensions covered:
//   - behavior:    resolver / lease enumeration path is exercised end-to-end
//                  with a tmp project root; cross-caller isolation observed
//   - integration: real fs under tmpdir, real resolveActiveSkillForCaller,
//                  real listPresenceLeases (no global mocks)
//   - render:      N/A — read-side only
//   - a11y:        N/A — read-side only
//
// Run with: pnpm vitest run tests/unit/skills/skill-statusline-canonical-only.test.ts

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildStatusLineModel } from '~/src/services/skills/skill-statusline-service';

const SID = '2026-08-05-session-canonical-only';
const CALLER_A = 'ide-caller-a';
const CALLER_B = 'ide-caller-b';
const NOW_MS = Date.parse('2026-08-05T12:00:00.000Z');

/**
 * `resolveCallerId` falls back to `process.env.CLAUDE_CODE_SESSION_ID` when
 * `stdin.caller_id` is absent. The test runner sets this env to its own
 * session id, which would skew the callerId=null branch (it would resolve
 * to the runner's id, not to `null`). The `runWithNoCallerIdEnv` helper
 * clears the env for the duration of `fn`, mirroring the documented
 * `stdin → env → null` resolution chain.
 */
function runWithNoCallerIdEnv<T>(fn: () => T): T {
  const prev = process.env['CLAUDE_CODE_SESSION_ID'];
  delete process.env['CLAUDE_CODE_SESSION_ID'];
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete process.env['CLAUDE_CODE_SESSION_ID'];
    } else {
      process.env['CLAUDE_CODE_SESSION_ID'] = prev;
    }
  }
}

function makeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-statusline-canonical-'));
  // `findProjectRoot` walks up from cwd looking for `.peaks/config.json`,
  // `.git`, or `package.json`. The tmp project must mark itself as a project
  // root — otherwise the resolver chain returns `null` and the model
  // collapses to `state: 'idle'`. A bare `.peaks/config.json` is the
  // documented marker.
  mkdirSync(join(root, '.peaks'), { recursive: true });
  writeFileSync(
    join(root, '.peaks', 'config.json'),
    JSON.stringify({ schemaVersion: 1 }),
    'utf8',
  );
  return root;
}

/**
 * Write the canonical session binding at
 * `.peaks/_runtime/session.json` (the file `getSessionIdCanonical`
 * reads to derive the project-level session id). Without this file
 * the resolver chain returns `null` and the model collapses to
 * `state: 'idle'`.
 */
function makeSessionBinding(projectRoot: string, sessionId: string): void {
  const dir = join(projectRoot, '.peaks', '_runtime');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'session.json'),
    JSON.stringify({ sessionId, projectRoot }),
    'utf8',
  );
}

/**
 * Write a presence lease for (session, caller). The canonical lease lives at
 * `.peaks/_runtime/<sid>/leases/presence-<caller>-<workflow>.json`. We also
 * need a session-dir level stub (the `presence-<caller>-<workflow>.json` at
 * the session root) because `resolveActiveSkillForCaller` walks the session
 * dir first via `listPresenceLeases` to discover (caller, workflow) pairs.
 */
function writePresenceLease(
  projectRoot: string,
  sessionId: string,
  callerId: string,
  workflowId: string,
  skill: string,
  mode: string,
  status: 'preparing' | 'running' | 'terminalized' | 'lost' = 'running',
  startedAt: string = '2026-08-05T11:55:00.000Z',
  lastHeartbeat: string = '2026-08-05T11:59:00.000Z',
): void {
  const sessionDir = join(projectRoot, '.peaks', '_runtime', sessionId);
  const leaseDir = join(sessionDir, 'leases');
  mkdirSync(leaseDir, { recursive: true });
  // The session-dir level entry is the resolver's discovery probe.
  writeFileSync(
    join(sessionDir, `presence-${callerId}-${workflowId}.json`),
    JSON.stringify({ stub: true }),
    'utf8',
  );
  // The actual lease file the read dereferences.
  const leasePath = join(leaseDir, `presence-${callerId}-${workflowId}.json`);
  writeFileSync(
    leasePath,
    JSON.stringify({
      callerId,
      workflowId,
      graphRef: `graphs/${workflowId}.json`,
      skill,
      depth: 0,
      startedAt,
      lastHeartbeat,
      status,
      mode,
      schemaVersion: 1,
    }),
    'utf8',
  );
}

describe("Scenario: behavior — read-side isolation across callers (Case A)", () => {
  it("when invoked, should returns only the matching callerId's lease; no project-level single-file fallback", () => {
    // given: two callers (A, B) under the same canonical session, each with
    //        their own lease; callerId A is the live stdin callerId
    // when:  buildStatusLineModel is called with caller_id=A
    // then:  model.presence.skill reflects A's lease, not B's; no
    //        cross-contamination, no `.peaks/_runtime/active-skill.json`
    //        read (we never wrote that file).
    const projectRoot = makeProjectRoot();
    makeSessionBinding(projectRoot, SID);
    writePresenceLease(projectRoot, SID, CALLER_A, 'wf-a', 'peaks-code', 'full-auto');
    writePresenceLease(projectRoot, SID, CALLER_B, 'wf-b', 'peaks-rd', 'strict');
    const stdin = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer-A',
      caller_id: CALLER_A,
    };
    const model = buildStatusLineModel(stdin, NOW_MS);
    expect(model.state).toBe('active');
    expect(model.presence).not.toBeNull();
    expect(model.presence?.skill).toBe('peaks-code');
    expect(model.presence?.mode).toBe('full-auto');
    // The B lease must NOT show up under A's callerId — this is the
    // regression guard for the 4.0.8 dual-skill bug.
    expect(model.presence?.skill).not.toBe('peaks-rd');
  });

  it("when invoked, should mirror reads for callerId B yield B's lease only", () => {
    // given: two callers under the same session; B's stdin is the live callerId
    // when:  buildStatusLineModel is called with caller_id=B
    // then:  model.presence.skill reflects B's lease (peaks-rd, strict)
    const projectRoot = makeProjectRoot();
    makeSessionBinding(projectRoot, SID);
    writePresenceLease(projectRoot, SID, CALLER_A, 'wf-a', 'peaks-code', 'full-auto');
    writePresenceLease(projectRoot, SID, CALLER_B, 'wf-b', 'peaks-rd', 'strict');
    const stdin = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer-B',
      caller_id: CALLER_B,
    };
    const model = buildStatusLineModel(stdin, NOW_MS);
    expect(model.state).toBe('active');
    expect(model.presence?.skill).toBe('peaks-rd');
    expect(model.presence?.mode).toBe('strict');
  });
});

describe("Scenario: behavior — no leases present (Case B)", () => {
  it("when invoked, should returns idle (presence=null) when the session has zero leases", () => {
    // given: an empty session dir — no leases, no active-skill.json
    // when:  buildStatusLineModel is called
    // then:  model.state='idle', model.presence=null — the canonical
    //        lease projection is the only source, no fallback fires
    const projectRoot = makeProjectRoot();
    makeSessionBinding(projectRoot, SID);
    const stdin = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer-A',
      caller_id: CALLER_A,
    };
    const model = buildStatusLineModel(stdin, NOW_MS);
    expect(model.state).toBe('idle');
    expect(model.presence).toBeNull();
  });
});

describe("Scenario: behavior — callerId with no matching lease (Case C — G1 fallback)", () => {
  it("when invoked, should falls back to the session's most-recent in-flight lease when callerId matches none", () => {
    // given: one lease under CALLER_A; stdin carries CALLER_NONE — the
    //        resolver's callerId-filtered walk returns nothing, so the
    //        G1 fallback (slice 2026-08-05-statusline-empty-render-and-short-sid-suffix)
    //        retries with `callerId: null` and surfaces the session's
    //        most-recent in-flight lease (PRD AC2).
    // when:  buildStatusLineModel is called with caller_id='unknown-caller'
    // then:  model.state='active', model.presence.skill='peaks-code' —
    //        the fallback fired and returned the lease. This replaces
    //        the prior `state: 'idle'` assertion (the pre-slice
    //        behavior; the production bug was that the harness's
    //        `CLAUDE_CODE_SESSION_ID` did not match the lease's
    //        callerId and statusline collapsed to `empty`).
    //        Note: the AC4 multi-tenant invariant is NOT violated by
    //        this fallback — when callerId A DOES match a lease, the
    //        first (non-fallback) call returns A's lease immediately;
    //        the fallback only fires when callerId A has NO matching
    //        lease, in which case surfacing B's lease is intentional.
    const projectRoot = makeProjectRoot();
    makeSessionBinding(projectRoot, SID);
    writePresenceLease(projectRoot, SID, CALLER_A, 'wf-a', 'peaks-code', 'full-auto');
    const stdin = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer-X',
      caller_id: 'unknown-caller',
    };
    const model = buildStatusLineModel(stdin, NOW_MS);
    expect(model.state).toBe('active');
    expect(model.presence).not.toBeNull();
    expect(model.presence?.skill).toBe('peaks-code');
    expect(model.presence?.mode).toBe('full-auto');
  });
});

describe("Scenario: behavior — callerId=null picks the most recent in-flight lease (Case D)", () => {
  it("when invoked, should returns the most recent in-flight lease across all callers when stdin omits caller_id", () => {
    // given: 3 leases under different callers, with distinct lastHeartbeat
    //        timestamps; stdin has NO caller_id (back-compat non-IDE caller)
    // when:  buildStatusLineModel is called with caller_id undefined
    // then:  model.state='active', model.presence.skill reflects the lease
    //        with the latest lastHeartbeat (peaks-ui / strict)
    const projectRoot = makeProjectRoot();
    makeSessionBinding(projectRoot, SID);
    writePresenceLease(
      projectRoot, SID, CALLER_A, 'wf-a', 'peaks-code', 'full-auto',
      'running',
      '2026-08-05T10:00:00.000Z',
      '2026-08-05T11:30:00.000Z',
    );
    writePresenceLease(
      projectRoot, SID, CALLER_B, 'wf-b', 'peaks-rd', 'assisted',
      'running',
      '2026-08-05T10:00:00.000Z',
      '2026-08-05T11:45:00.000Z',
    );
    writePresenceLease(
      projectRoot, SID, 'ide-caller-c', 'wf-c', 'peaks-ui', 'strict',
      'running',
      '2026-08-05T10:00:00.000Z',
      '2026-08-05T11:59:00.000Z', // newest
    );
    const stdin = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer-A',
      // caller_id intentionally absent
    };
    const model = runWithNoCallerIdEnv(() => buildStatusLineModel(stdin, NOW_MS));
    expect(model.state).toBe('active');
    expect(model.presence).not.toBeNull();
    expect(model.presence?.skill).toBe('peaks-ui');
    expect(model.presence?.mode).toBe('strict');
  });

  it("when invoked, should returns idle (presence=null) when callerId=null and only terminal leases exist", () => {
    // given: one terminalized lease under CALLER_A; stdin has no caller_id
    // when:  buildStatusLineModel is called
    // then:  model.state='idle' — terminal leases are not surfaced
    const projectRoot = makeProjectRoot();
    makeSessionBinding(projectRoot, SID);
    writePresenceLease(projectRoot, SID, CALLER_A, 'wf-a', 'peaks-code', 'full-auto', 'terminalized');
    const stdin = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer-A',
    };
    const model = runWithNoCallerIdEnv(() => buildStatusLineModel(stdin, NOW_MS));
    expect(model.state).toBe('idle');
    expect(model.presence).toBeNull();
  });
});

describe("Scenario: mutation check — `.peaks/_runtime/active-skill.json` is NOT consulted", () => {
  it("when invoked, should returns idle when only the legacy file exists (no canonical lease)", () => {
    // given: only the project-level `.peaks/_runtime/active-skill.json` is
    //        present (the 4.0.7 legacy write path). No canonical lease,
    //        no per-caller index.
    // when:  buildStatusLineModel is called with a callerId
    // then:  model.state='idle' — the legacy file is NOT consulted.
    //        Reverting this slice to read the legacy file would make
    //        this test fail (model.state would be 'active' with skill
    //        from the legacy file).
    const projectRoot = makeProjectRoot();
    makeSessionBinding(projectRoot, SID);
    const dir = join(projectRoot, '.peaks', '_runtime');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'active-skill.json'),
      JSON.stringify({ skill: 'peaks-legacy', mode: 'full-auto' }),
      'utf8',
    );
    const stdin = {
      workspace: { current_dir: projectRoot },
      session_id: 'claude-code-outer-A',
      caller_id: CALLER_A,
    };
    const model = buildStatusLineModel(stdin, NOW_MS);
    expect(model.state).toBe('idle');
    expect(model.presence).toBeNull();
  });
});
// tests/unit/session/caller-binding-staleness.test.ts
//
// rid=caller-binding-staleness (session 2026-09-12-session-86f23b).
//
// The caller-first resolution shipped earlier today (commit 696e8bf9) closed
// the two-window cross-talk by making `getCurrentSessionId` read the per-caller
// binding `.peaks/_runtime/callers/<callerId>.json` before the project-global
// `.peaks/_runtime/session.json`. The trust model underneath was unguarded:
//
//   1. `getCallerBinding` was shape-only — a binding pointing at a session
//      whose directory is gone was still trusted for resolution.
//   2. `lastActivityAt` was written but never read (and never even bumped on
//      reuse), so a freshness field sat unused while staleness went unnoticed.
//   3. `rotateSessionBinding` deleted only the project-global files, so the
//      rotating caller kept resolving the session it had just rotated out of:
//      `peaks job init` re-created `.peaks/_runtime/<old-sid>/job/...` where
//      the pre-696e8bf9 code returned null / NO_ACTIVE_SESSION.
//
// Fix under test: a binding is only usable when its bound session directory
// still exists; rotation clears the rotating caller's binding; the
// `lastActivityAt` field is removed rather than left written-but-unread.
// The caller-first PRECEDENCE is unchanged — a valid, directory-present
// binding still outranks the project-global file.
//
// Dimensions covered:
//   - behavior:    stale-vs-valid resolution, observable fall-through,
//                  rotation clearing the rotating caller's binding.
//   - integration: real tmp workspace; real on-disk session dirs; a real
//                  `peaks job init` that must not materialise a tree under
//                  the rotated-out session id.
//
// Omitted dimensions:
//   - render: JSON-shaped results; no formatted output surface.
//   - a11y:   no human-facing text in this path.

import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../_setup/io.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace,
} from '../_setup/tmp-workspace.js';
import {
  getSessionId,
  getSessionIdCanonical,
  resolveCallerBoundSession,
  rotateSessionBinding,
} from '../../../src/services/session/session-manager.js';
import {
  ensureSession,
  ensureSessionWithRotation,
  _resetLastResolvedOuterForTest,
} from '../../../src/services/session/session-binding-bridge.js';
import {
  getCallerBinding,
  setCallerBinding,
} from '../../../src/services/session/caller-binding-service.js';
import { getCurrentSessionId } from '../../../src/services/skills/skill-presence-service.js';
import type { CallerBinding } from '../../../src/services/session/caller-id-types.js';
import { registerJobCommands } from '../../../src/cli/commands/job-commands.js';

declareDimensions(
  'tests/unit/session/caller-binding-staleness.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'JSON-shaped results; no formatted output surface' },
    { dim: 'a11y', reason: 'no human-facing text in this path' },
  ],
);

const CALLER_A = 'caller-stale-a';
const CALLER_B = 'caller-stale-b';
const SID_LIVE = '2026-09-12-session-live0001';
const SID_GLOBAL = '2026-09-12-session-glob0001';
const SID_ROTATED = '2026-09-12-session-rot00001';

/** A binding + the session directory a real `peaks workspace init` leaves behind. */
function seedBoundCaller(root: string, callerId: string, sessionId: string): void {
  seedSessionDir(root, sessionId);
  setCallerBinding(root, callerId, {
    callerId,
    peakSessionId: sessionId,
    projectRoot: root,
    createdAt: '2026-09-12T00:00:00.000Z',
    skill: 'peaks-code',
    mode: 'unknown',
    gate: 'startup',
  } satisfies CallerBinding);
}

/** A binding whose bound session directory is deliberately ABSENT. */
function seedStaleCaller(root: string, callerId: string, sessionId: string): void {
  setCallerBinding(root, callerId, {
    callerId,
    peakSessionId: sessionId,
    projectRoot: root,
    createdAt: '2026-09-12T00:00:00.000Z',
    skill: 'peaks-code',
    mode: 'unknown',
    gate: 'startup',
  } satisfies CallerBinding);
}

function seedSessionDir(root: string, sessionId: string): void {
  mkdirSync(join(root, '.peaks', '_runtime', sessionId), { recursive: true });
}

function seedGlobalSession(root: string, sessionId: string): void {
  const runtimeDir = join(root, '.peaks', '_runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'session.json'),
    JSON.stringify({ sessionId, createdAt: '2026-09-12T00:00:00.000Z', projectRoot: root }, null, 2),
    'utf8',
  );
}

function seedSessionMeta(root: string, sessionId: string, outerSessionId: string): void {
  seedSessionDir(root, sessionId);
  writeFileSync(
    join(root, '.peaks', '_runtime', sessionId, 'session.json'),
    JSON.stringify({ sessionId, projectRoot: root, createdAt: '2026-09-12T00:00:00.000Z', outerSessionId }, null, 2),
    'utf8',
  );
}

async function runJobInit(
  wsPath: string,
  jobId: string,
): Promise<{ ok: boolean; code?: string; data: { statePath?: string } }> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerJobCommands(program, io);
  await program.parseAsync(
    ['job', 'init', '--job-id', jobId, '--slice-list', 'S1', '--project', wsPath, '--json'],
    { from: 'user' },
  );
  return JSON.parse(captured.stdout.join('\n')) as { ok: boolean; code?: string; data: { statePath?: string } };
}

let ws: TmpWorkspace;

beforeEach(() => {
  ws = useTmpWorkspace('peaks-caller-stale-');
  // Deterministic caller resolution + no ambient outer-session signal.
  withEnv('PEAKS_CALLER_ID', CALLER_A);
  withEnv('PEAKS_SESSION_ID', undefined);
  withEnv('PEAKS_OUTER_SESSION_ID', undefined);
  withEnv('CLAUDE_CODE_SESSION_ID', undefined);
  _resetLastResolvedOuterForTest();
});

afterEach(() => {
  cleanupTmpWorkspace();
});

describe('Scenario: behavior — a binding to a deleted session directory is stale', () => {
  it('when the bound session directory is gone but the project-global binding exists, should fall through and report the stale binding', () => {
    // given: caller A is bound to a session whose directory was deleted,
    //        and the project-global binding points at a live session
    seedStaleCaller(ws.path, CALLER_A, SID_ROTATED);
    seedGlobalSession(ws.path, SID_GLOBAL);
    // when: the current session is resolved through every public resolver
    const resolution = resolveCallerBoundSession(ws.path);
    // then: the dead binding is not trusted — the chain falls through to the
    //       global file, and the caller can TELL it happened
    expect(resolution.sessionId).toBeNull();
    expect(resolution.staleSessionId).toBe(SID_ROTATED);
    expect(getSessionId(ws.path)).toBe(SID_GLOBAL);
    expect(getSessionIdCanonical(ws.path)).toBe(SID_GLOBAL);
    expect(getCurrentSessionId(ws.path)).toBe(SID_GLOBAL);
  });

  it('when the bound session directory is gone and nothing else is bound, should return null and create no directory for the dead id', () => {
    // given: caller A is bound to a session directory that does not exist
    //        and there is no project-global binding
    seedStaleCaller(ws.path, CALLER_A, SID_ROTATED);
    // when: the current session is resolved (as job / dispatch / share do)
    const resolved = getCurrentSessionId(ws.path);
    expect(resolved).toBeNull();
    // then: the dead session id is not resurrected as a phantom tree
    expect(existsSync(join(ws.path, '.peaks', '_runtime', SID_ROTATED))).toBe(false);
  });

  it('when the bound session directory exists, should keep the caller-first precedence unchanged', () => {
    // given: caller A and caller B are bound to directory-present sessions
    //        while the project-global file (last-writer-wins) points at B
    seedBoundCaller(ws.path, CALLER_A, SID_LIVE);
    seedBoundCaller(ws.path, CALLER_B, SID_GLOBAL);
    seedGlobalSession(ws.path, SID_GLOBAL);
    // when: each caller resolves the current session
    withEnv('PEAKS_CALLER_ID', CALLER_A);
    const asCallerA = getCurrentSessionId(ws.path);
    withEnv('PEAKS_CALLER_ID', CALLER_B);
    const asCallerB = getCurrentSessionId(ws.path);
    // then: caller-first is intact — the two windows do not cross-talk
    expect(asCallerA).toBe(SID_LIVE);
    expect(asCallerB).toBe(SID_GLOBAL);
    withEnv('PEAKS_CALLER_ID', CALLER_A);
    expect(getSessionId(ws.path)).toBe(SID_LIVE);
    expect(getSessionIdCanonical(ws.path)).toBe(SID_LIVE);
  });

  it('when the bound session directory is gone, should roll a fresh session instead of returning the dead id', async () => {
    // given: caller A is bound to a session whose directory was deleted
    seedStaleCaller(ws.path, CALLER_A, SID_ROTATED);
    // when: the session-creating primitive runs
    const fresh = await ensureSession(ws.path);
    // then: a NEW session is bound (with its directory materialised) and the
    //       dead id is not handed back as if it were live
    expect(fresh).not.toBe(SID_ROTATED);
    expect(existsSync(join(ws.path, '.peaks', '_runtime', fresh))).toBe(true);
    expect(getCallerBinding(ws.path, CALLER_A)?.peakSessionId).toBe(fresh);
  });

  it('when a binding carries the removed lastActivityAt key, should still resolve it (legacy on-disk tolerance)', () => {
    // given: a binding file written by an older CLI version, field included
    seedSessionDir(ws.path, SID_LIVE);
    mkdirSync(join(ws.path, '.peaks', '_runtime', 'callers'), { recursive: true });
    writeFileSync(
      join(ws.path, '.peaks', '_runtime', 'callers', `${CALLER_A}.json`),
      JSON.stringify({
        callerId: CALLER_A,
        peakSessionId: SID_LIVE,
        projectRoot: ws.path,
        createdAt: '2026-09-12T00:00:00.000Z',
        lastActivityAt: '2026-09-12T00:00:00.000Z',
        skill: 'peaks-code',
        mode: 'unknown',
        gate: 'startup',
      }, null, 2),
      'utf8',
    );
    // when: the binding is resolved
    // then: the extra legacy key is ignored, not fatal
    expect(getCurrentSessionId(ws.path)).toBe(SID_LIVE);
  });

  it('when a binding is written, should not carry the removed lastActivityAt field', () => {
    // given: a freshly written binding
    seedBoundCaller(ws.path, CALLER_A, SID_LIVE);
    // when: the raw file is read back
    const raw = JSON.parse(
      readFileSync(join(ws.path, '.peaks', '_runtime', 'callers', `${CALLER_A}.json`), 'utf8'),
    ) as Record<string, unknown>;
    // then: the written-but-never-read field is gone from the contract
    expect('lastActivityAt' in raw).toBe(false);
  });
});

describe('Scenario: integration — rotation cannot be re-entered through a stale binding', () => {
  it('when the session rotates, should clear the rotating caller binding so the old id is not resolved again', () => {
    // given: caller A is bound to a session with a live directory, the
    //        project-global binding agrees, and the caller id resolves
    seedBoundCaller(ws.path, CALLER_A, SID_ROTATED);
    seedSessionMeta(ws.path, SID_ROTATED, 'outer-old');
    seedGlobalSession(ws.path, SID_ROTATED);
    withEnv('PEAKS_CALLER_ID', CALLER_A);
    expect(getCurrentSessionId(ws.path)).toBe(SID_ROTATED);
    // when: the project rotates
    const previous = rotateSessionBinding(ws.path);
    // then: the rotation reports the rotated-out id and NOTHING resolves it
    //       any more — the caller binding is gone with the global file
    expect(previous).toBe(SID_ROTATED);
    expect(getCallerBinding(ws.path, CALLER_A)).toBeNull();
    expect(getSessionId(ws.path)).toBeNull();
    expect(getSessionIdCanonical(ws.path)).toBeNull();
    expect(getCurrentSessionId(ws.path)).toBeNull();
  });

  it('when a job runs after a rotation, should not resolve the old session id nor create a tree under it', async () => {
    // given: caller A is bound to SID_ROTATED with a live directory and the
    //        global binding agrees (the state a rotation starts from)
    seedBoundCaller(ws.path, CALLER_A, SID_ROTATED);
    seedSessionMeta(ws.path, SID_ROTATED, 'outer-old');
    seedGlobalSession(ws.path, SID_ROTATED);
    withEnv('PEAKS_CALLER_ID', CALLER_A);
    rotateSessionBinding(ws.path);
    // when: a real `peaks job init` runs without --session-id
    const envelope = await runJobInit(ws.path, 'post-rotation-2026-09-12');
    // then: it fails closed instead of silently writing into the rotated-out
    //       session, and the dead session id gains no job tree (the defect
    //       was exactly this directory being created without a word)
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('NO_ACTIVE_SESSION');
    expect(existsSync(join(ws.path, '.peaks', '_runtime', SID_ROTATED, 'job'))).toBe(false);
  });

  it('when an outer-session rotation rolls a new session, should land the job in the new session, not the old one', async () => {
    // given: caller A is bound to SID_ROTATED, recorded with a different
    //        outer session than the one now driving peaks
    seedBoundCaller(ws.path, CALLER_A, SID_ROTATED);
    seedSessionMeta(ws.path, SID_ROTATED, 'outer-old');
    seedGlobalSession(ws.path, SID_ROTATED);
    withEnv('PEAKS_CALLER_ID', CALLER_A);
    withEnv('PEAKS_OUTER_SESSION_ID', 'outer-new');
    _resetLastResolvedOuterForTest();
    // when: the rotation-aware ensure runs (the `peaks workspace init` path)
    //       and a real `peaks job init` follows
    const rotated = await ensureSessionWithRotation(ws.path);
    const envelope = await runJobInit(ws.path, 'rolled-2026-09-12');
    // then: a fresh session was bound and the job landed there ...
    expect(rotated.rotationReason).toBe('outer-session-mismatch');
    expect(rotated.sessionId).not.toBe(SID_ROTATED);
    expect(getCallerBinding(ws.path, CALLER_A)?.peakSessionId).toBe(rotated.sessionId);
    expect(envelope.ok).toBe(true);
    // ... while the rotated-out session gained no job tree
    expect(existsSync(join(ws.path, '.peaks', '_runtime', rotated.sessionId, 'job', 'rolled-2026-09-12', 'state.json'))).toBe(true);
    expect(existsSync(join(ws.path, '.peaks', '_runtime', SID_ROTATED, 'job'))).toBe(false);
  });

  it('when one caller rotates, should leave another caller binding untouched', async () => {
    // given: callers A and B are both bound to the session being rotated out
    seedBoundCaller(ws.path, CALLER_A, SID_ROTATED);
    seedBoundCaller(ws.path, CALLER_B, SID_ROTATED);
    seedSessionMeta(ws.path, SID_ROTATED, 'outer-old');
    seedGlobalSession(ws.path, SID_ROTATED);
    const callerBPath = join(ws.path, '.peaks', '_runtime', 'callers', `${CALLER_B}.json`);
    const beforeB = readFileSync(callerBPath, 'utf8');
    withEnv('PEAKS_CALLER_ID', CALLER_A);
    // when: caller A's rotation runs
    rotateSessionBinding(ws.path);
    // then: A's binding is gone (it rotated) and B's is byte-identical —
    //       multi-caller isolation is preserved
    expect(getCallerBinding(ws.path, CALLER_A)).toBeNull();
    expect(readFileSync(callerBPath, 'utf8')).toBe(beforeB);
    expect(getCallerBinding(ws.path, CALLER_B)?.peakSessionId).toBe(SID_ROTATED);
  });
});

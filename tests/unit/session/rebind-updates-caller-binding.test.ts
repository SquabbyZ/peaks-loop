// tests/unit/session/rebind-updates-caller-binding.test.ts
//
// rid=rebind-must-update-caller-binding (session 2026-09-10-session-528a63).
//
// An explicit `peaks workspace init --session-id <X> --allow-session-rebind`
// rewrote `.peaks/_runtime/session.json` but left the caller's per-caller
// binding alone. `getSessionIdCanonical` prefers the per-caller file, so the
// rebind was shadowed for every command that resolves through it
// (`peaks session checkpoint`, `peaks session 24h-mode`, ...), while
// `getCurrentSessionId` (reads session.json) reported the new session — the
// two halves of the CLI disagreed about which session is current.
//
// Fix: the rebind repoints THIS caller's binding (and only this caller's).
// A second caller that did not rebind keeps its own session — that is the
// multi-caller isolation the per-caller design exists for.
//
// rid=caller-first-session-resolution (session 2026-09-12-session-86f23b):
// `getCurrentSessionId` is now caller-first too, so the two resolvers cannot
// disagree any more — `getCurrentSessionId` returns the per-caller binding
// whenever one exists and falls back to `session.json` only when it does
// not. AC1 / AC4 / AC5 below were updated from "the resolvers disagree" to
// the single-answer contract this slice establishes.
//
// Dimensions covered:
//   - behavior:    both resolvers agree after the rebind; second caller
//                  isolation preserved; refused / no-op rebinds leave the
//                  caller binding untouched.
//   - integration: real tmp workspace; real on-disk session.json +
//                  callers/<callerId>.json; real initWorkspace rebind path.
//   - render:      OMITTED — no formatted output surface here.
//   - a11y:        OMITTED — no human-facing text in this path.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { declareDimensions } from '../_setup/4dim-template.js';
import type { CallerBinding } from '../../../src/services/session/caller-id-types.js';
import {
  getCallerBinding,
  setCallerBinding,
} from '../../../src/services/session/caller-binding-service.js';
import {
  getSessionId,
  getSessionIdCanonical,
} from '../../../src/services/session/session-manager.js';
import { getCurrentSessionId } from '../../../src/services/skills/skill-presence-service.js';
import {
  initWorkspace,
  ConflictingSessionError,
} from '../../../src/services/workspace/workspace-service.js';

declareDimensions(
  'tests/unit/session/rebind-updates-caller-binding.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'no formatted output surface in this path' },
    { dim: 'a11y', reason: 'no human-facing text in this path' },
  ],
);

const CALLER_A = 'caller-rebind-a';
const CALLER_B = 'caller-rebind-b';

const SID_FILE = '2026-09-10-session-file0001';
const SID_BIND_A = '2026-09-10-session-bind0001';
const SID_TARGET = '2026-09-10-session-targ0001';
const SID_BIND_B = '2026-09-10-session-bind0002';

let workspace: string;
const savedEnv: Record<string, string | undefined> = {};

function setCaller(id: string | undefined): void {
  if (id === undefined) delete process.env.PEAKS_CALLER_ID;
  else process.env.PEAKS_CALLER_ID = id;
}

/** Seed `.peaks/_runtime/session.json` — the project-global binding. */
function seedSessionJson(sessionId: string): void {
  const runtimeDir = join(workspace, '.peaks', '_runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'session.json'),
    JSON.stringify({ sessionId, createdAt: '2026-09-10T00:00:00.000Z', projectRoot: workspace }, null, 2),
    'utf8',
  );
}

/** Seed a per-caller binding file whose sessionId disagrees with session.json. */
function seedCallerBinding(callerId: string, sessionId: string): void {
  const payload: CallerBinding = {
    callerId,
    peakSessionId: sessionId,
    projectRoot: workspace,
    createdAt: '2026-09-10T00:00:00.000Z',
    lastActivityAt: 'SENTINEL-LAST-ACTIVITY',
    skill: 'peaks-code',
    mode: 'full-auto',
    gate: 'started',
  };
  setCallerBinding(workspace, callerId, payload);
}

function rawCallerFile(callerId: string): string {
  return readFileSync(join(workspace, '.peaks', '_runtime', 'callers', `${callerId}.json`), 'utf8');
}

function rebind(sessionId: string, allowSessionRebind: boolean): ReturnType<typeof initWorkspace> {
  return initWorkspace({ projectRoot: workspace, sessionId, allowSessionRebind });
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'peaks-rebind-caller-'));
  for (const key of ['PEAKS_CALLER_ID', 'PEAKS_OUTER_SESSION_ID', 'CLAUDE_CODE_SESSION_ID']) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  setCaller(CALLER_A);
  seedSessionJson(SID_FILE);
  seedCallerBinding(CALLER_A, SID_BIND_A);
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const wsToRemove = workspace;
  setImmediate(() => {
    try { rmSync(wsToRemove, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
});

describe('Scenario: behavior — an explicit rebind repoints the rebinding caller', () => {
  it('when a stale per-caller binding shadows session.json, should resolve the caller binding through both resolvers', () => {
    // given: caller A is bound to SID_BIND_A while the project-global
    //        session.json says SID_FILE (the rebind defect's precondition)
    // when: the current session is read through both public resolvers
    const canonical = getSessionIdCanonical(workspace);
    const current = getCurrentSessionId(workspace);
    // then: both report the caller-bound session — the two halves of the CLI
    //       agree, so no command can be shadowed into the wrong tree
    expect(canonical).toBe(SID_BIND_A);
    expect(current).toBe(SID_BIND_A);
  });

  it('when an explicit --allow-session-rebind runs, should resolve the target session through every resolver', async () => {
    // given: caller A is bound to SID_BIND_A and session.json says SID_FILE
    // when: the user explicitly rebinds to SID_TARGET
    const report = await rebind(SID_TARGET, true);
    // then: the report and all three resolvers agree on the target
    expect(report.bound).toBe(true);
    expect(report.previousSessionId).toBe(SID_BIND_A);
    expect(getSessionIdCanonical(workspace)).toBe(SID_TARGET);
    expect(getSessionId(workspace)).toBe(SID_TARGET);
    expect(getCurrentSessionId(workspace)).toBe(SID_TARGET);
    expect(getCallerBinding(workspace, CALLER_A)?.peakSessionId).toBe(SID_TARGET);
  });

  it('when the rebind repoints the caller, should preserve the binding metadata', async () => {
    // given: caller A's binding carries mode / gate / skill / createdAt
    // when: the user explicitly rebinds to SID_TARGET
    await rebind(SID_TARGET, true);
    // then: only peakSessionId moved — the live presence state survives
    const binding = getCallerBinding(workspace, CALLER_A);
    expect(binding?.mode).toBe('full-auto');
    expect(binding?.gate).toBe('started');
    expect(binding?.skill).toBe('peaks-code');
    expect(binding?.createdAt).toBe('2026-09-10T00:00:00.000Z');
  });
});

describe('Scenario: behavior — a second caller that did not rebind keeps its own session', () => {
  it('when another caller rebinds, should leave caller B byte-identical and resolving its own session', async () => {
    // given: caller B is bound to SID_BIND_B and caller A is bound to SID_BIND_A
    setCaller(CALLER_B);
    seedCallerBinding(CALLER_B, SID_BIND_B);
    const beforeB = rawCallerFile(CALLER_B);
    // when: caller A rebinds the project to SID_TARGET
    setCaller(CALLER_A);
    await rebind(SID_TARGET, true);
    // then: A's binding moved, B's did not ...
    expect(getCallerBinding(workspace, CALLER_A)?.peakSessionId).toBe(SID_TARGET);
    expect(rawCallerFile(CALLER_B)).toBe(beforeB);
    // ... and B still resolves its own session through BOTH resolvers, even
    //     though the project-global view moved to SID_TARGET
    setCaller(CALLER_B);
    expect(getSessionIdCanonical(workspace)).toBe(SID_BIND_B);
    expect(getCurrentSessionId(workspace)).toBe(SID_BIND_B);
  });
});

describe('Scenario: behavior — refused / no-op rebinds leave the caller binding untouched', () => {
  it('when a rebind is refused for a conflicting session dir, should leave both bindings untouched', async () => {
    // given: SID_BIND_A already owns a session directory, so the rebind conflicts
    const runtimeDir = join(workspace, '.peaks', '_runtime');
    mkdirSync(join(runtimeDir, SID_BIND_A), { recursive: true });
    writeFileSync(join(runtimeDir, SID_BIND_A, 'session.json'), '{}', 'utf8');
    const BeforeA = rawCallerFile(CALLER_A);
    // when: the rebind runs without --allow-session-rebind
    await expect(rebind(SID_TARGET, false)).rejects.toBeInstanceOf(ConflictingSessionError);
    // then: nothing moved — A's file is byte-identical and A still resolves
    //       its own session (both resolvers agree)
    expect(rawCallerFile(CALLER_A)).toBe(BeforeA);
    expect(getSessionIdCanonical(workspace)).toBe(SID_BIND_A);
    expect(getCurrentSessionId(workspace)).toBe(SID_BIND_A);
  });

  it('when the target session is already bound, should not rewrite the caller file', async () => {
    // given: caller A is already bound to SID_TARGET and session.json agrees
    setCaller(CALLER_A);
    seedCallerBinding(CALLER_A, SID_TARGET);
    seedSessionJson(SID_TARGET);
    const BeforeA = rawCallerFile(CALLER_A);
    // when: the same id is bound again without --allow-session-rebind
    const report = await rebind(SID_TARGET, false);
    // then: it is a no-op — no previous session, no rewrite
    expect(report.previousSessionId).toBeNull();
    expect(rawCallerFile(CALLER_A)).toBe(BeforeA);
  });
});

describe('Scenario: behavior — a caller with no binding file', () => {
  it('when the caller has no binding file, should write session.json only and keep the resolvers in agreement', async () => {
    // given: no callers/ directory at all
    rmSync(join(workspace, '.peaks', '_runtime', 'callers'), { recursive: true, force: true });
    // when: the user explicitly rebinds to SID_TARGET
    await rebind(SID_TARGET, true);
    // then: the global file carries the rebind and no caller file is invented
    expect(getSessionIdCanonical(workspace)).toBe(SID_TARGET);
    expect(getCurrentSessionId(workspace)).toBe(SID_TARGET);
    expect(getCallerBinding(workspace, CALLER_A)).toBeNull();
  });

  it('when no callerId is resolvable, should still rebind session.json without throwing', async () => {
    // given: no callers/ directory and no resolvable caller id
    rmSync(join(workspace, '.peaks', '_runtime', 'callers'), { recursive: true, force: true });
    setCaller(undefined);
    // when: the user explicitly rebinds to SID_TARGET
    const report = await rebind(SID_TARGET, true);
    // then: the rebind succeeds and both resolvers read the global file
    expect(report.bound).toBe(true);
    expect(getSessionIdCanonical(workspace)).toBe(SID_TARGET);
    expect(getCurrentSessionId(workspace)).toBe(SID_TARGET);
  });
});

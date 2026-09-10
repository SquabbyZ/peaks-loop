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
  it('AC1 (precondition): a stale per-caller binding shadows session.json — the resolvers disagree', () => {
    // This is the defect's precondition, reproduced: the caller binding is
    // stale relative to the project-global session.json.
    expect(getSessionIdCanonical(workspace)).toBe(SID_BIND_A);
    expect(getCurrentSessionId(workspace)).toBe(SID_FILE);
  });

  it('AC2: after --allow-session-rebind, getSessionIdCanonical and getCurrentSessionId agree on the target', async () => {
    const report = await rebind(SID_TARGET, true);

    expect(report.bound).toBe(true);
    expect(report.previousSessionId).toBe(SID_BIND_A);
    expect(getSessionIdCanonical(workspace)).toBe(SID_TARGET);
    expect(getSessionId(workspace)).toBe(SID_TARGET);
    expect(getCurrentSessionId(workspace)).toBe(SID_TARGET);
    expect(getCallerBinding(workspace, CALLER_A)?.peakSessionId).toBe(SID_TARGET);
  });

  it('AC3: the repoint preserves the binding metadata (mode / gate / skill / createdAt)', async () => {
    await rebind(SID_TARGET, true);

    const binding = getCallerBinding(workspace, CALLER_A);
    expect(binding?.mode).toBe('full-auto');
    expect(binding?.gate).toBe('started');
    expect(binding?.skill).toBe('peaks-code');
    expect(binding?.createdAt).toBe('2026-09-10T00:00:00.000Z');
  });
});

describe('Scenario: behavior — a second caller that did not rebind keeps its own session', () => {
  it('AC4: caller B is untouched and still resolves its own session (multi-caller isolation)', async () => {
    setCaller(CALLER_B);
    seedCallerBinding(CALLER_B, SID_BIND_B);
    const beforeB = rawCallerFile(CALLER_B);

    setCaller(CALLER_A);
    await rebind(SID_TARGET, true);

    // A's rebind repoints A only.
    expect(getCallerBinding(workspace, CALLER_A)?.peakSessionId).toBe(SID_TARGET);
    // B's file is byte-identical: not repointed, not cleared.
    expect(rawCallerFile(CALLER_B)).toBe(beforeB);
    // B still resolves its own session, while the project-global view moved.
    setCaller(CALLER_B);
    expect(getSessionIdCanonical(workspace)).toBe(SID_BIND_B);
    expect(getCurrentSessionId(workspace)).toBe(SID_TARGET);
  });
});

describe('Scenario: behavior — refused / no-op rebinds leave the caller binding untouched', () => {
  it('AC5: a refused rebind (no --allow-session-rebind) leaves both bindings untouched', async () => {
    const runtimeDir = join(workspace, '.peaks', '_runtime');
    mkdirSync(join(runtimeDir, SID_BIND_A), { recursive: true });
    writeFileSync(join(runtimeDir, SID_BIND_A, 'session.json'), '{}', 'utf8');
    const BeforeA = rawCallerFile(CALLER_A);

    await expect(rebind(SID_TARGET, false)).rejects.toBeInstanceOf(ConflictingSessionError);

    expect(rawCallerFile(CALLER_A)).toBe(BeforeA);
    expect(getSessionIdCanonical(workspace)).toBe(SID_BIND_A);
    expect(getCurrentSessionId(workspace)).toBe(SID_FILE);
  });

  it('AC6: re-binding the id already bound is a no-op (caller file not rewritten)', async () => {
    setCaller(CALLER_A);
    seedCallerBinding(CALLER_A, SID_TARGET);
    seedSessionJson(SID_TARGET);
    const BeforeA = rawCallerFile(CALLER_A);

    const report = await rebind(SID_TARGET, false);

    expect(report.previousSessionId).toBeNull();
    expect(rawCallerFile(CALLER_A)).toBe(BeforeA);
  });
});

describe('Scenario: behavior — a caller with no binding file', () => {
  it('AC7: no per-caller file → rebind writes session.json only and the resolvers agree', async () => {
    rmSync(join(workspace, '.peaks', '_runtime', 'callers'), { recursive: true, force: true });

    await rebind(SID_TARGET, true);

    expect(getSessionIdCanonical(workspace)).toBe(SID_TARGET);
    expect(getCurrentSessionId(workspace)).toBe(SID_TARGET);
    expect(getCallerBinding(workspace, CALLER_A)).toBeNull();
  });

  it('AC8: no callerId resolvable → rebind does not throw and the resolvers agree', async () => {
    rmSync(join(workspace, '.peaks', '_runtime', 'callers'), { recursive: true, force: true });
    setCaller(undefined);

    const report = await rebind(SID_TARGET, true);

    expect(report.bound).toBe(true);
    expect(getSessionIdCanonical(workspace)).toBe(SID_TARGET);
    expect(getCurrentSessionId(workspace)).toBe(SID_TARGET);
  });
});

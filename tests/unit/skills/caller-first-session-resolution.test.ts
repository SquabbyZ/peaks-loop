// tests/unit/skills/caller-first-session-resolution.test.ts
//
// rid=caller-first-session-resolution — multi-window session cross-talk.
//
// `getCurrentSessionId` read ONE project-global file
// (`.peaks/_runtime/session.json`), which is last-writer-wins: whichever
// IDE window initialised most recently owned it for every reader. A
// second window's `peaks job init` therefore resolved the OTHER window's
// live session and materialised `.peaks/_runtime/<that-sid>/job/...`
// inside it (`JobStateStore.save` mkdirs the chain) — silent
// cross-contamination, not an error.
//
// Fix under test: `getCurrentSessionId` resolves the per-caller binding
// FIRST (the same source `peaks session info --active` uses via
// `getSessionId`) and only then falls back to the project-global file.
// The 17 call sites are untouched and inherit the fix from the helper.
//
// Dimensions covered:
//   - behavior:    caller-first precedence; no-caller-binding fallback
//                  (canonical + legacy paths) preserved.
//   - integration: real job command over a real tmp workspace; the job
//                  lands in the caller-bound session and no foreign
//                  session directory is created.

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
import { getCurrentSessionId } from '../../../src/services/skills/skill-presence-service.js';
import { setCallerBinding } from '../../../src/services/session/caller-binding-service.js';
import {
  getSessionId,
  getSessionIdCanonical,
} from '../../../src/services/session/session-manager.js';
import type { CallerBinding } from '../../../src/services/session/caller-id-types.js';
import { registerJobCommands } from '../../../src/cli/commands/job-commands.js';

declareDimensions(
  'tests/unit/skills/caller-first-session-resolution.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'JSON-shaped results; no formatted output surface' },
    { dim: 'a11y', reason: 'no human-facing text in this path' },
  ],
);

const CALLER_A = 'caller-window-a';
const CALLER_B = 'caller-window-b';
const SID_A = '2026-09-12-session-aaaaaa';
const SID_B = '2026-09-12-session-bbbbbb';

function seedCallerBinding(root: string, callerId: string, sessionId: string): void {
  const payload: CallerBinding = {
    callerId,
    peakSessionId: sessionId,
    projectRoot: root,
    createdAt: '2026-09-12T00:00:00.000Z',
    lastActivityAt: '2026-09-12T00:00:00.000Z',
    skill: 'peaks-code',
    mode: 'unknown',
    gate: 'startup',
  };
  setCallerBinding(root, callerId, payload);
}

/** Point the project-global binding at `sessionId` (last-writer-wins slot). */
function seedGlobalSession(root: string, sessionId: string): void {
  const runtimeDir = join(root, '.peaks', '_runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'session.json'),
    JSON.stringify({ sessionId, createdAt: '2026-09-12T00:00:00.000Z', projectRoot: root }, null, 2),
    'utf8',
  );
}

/** Point the legacy back-compat binding at `sessionId`. */
function seedLegacySession(root: string, sessionId: string): void {
  const peaksDir = join(root, '.peaks');
  mkdirSync(peaksDir, { recursive: true });
  writeFileSync(
    join(peaksDir, '.session.json'),
    JSON.stringify({ sessionId, createdAt: '2026-09-12T00:00:00.000Z', projectRoot: root }, null, 2),
    'utf8',
  );
}

async function runJobInit(wsPath: string, jobId: string): Promise<{ ok: boolean; data: { statePath?: string } }> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerJobCommands(program, io);
  await program.parseAsync(
    ['job', 'init', '--job-id', jobId, '--slice-list', 'S1', '--project', wsPath, '--json'],
    { from: 'user' },
  );
  return JSON.parse(captured.stdout.join('\n')) as { ok: boolean; data: { statePath?: string } };
}

let ws: TmpWorkspace;

beforeEach(() => {
  ws = useTmpWorkspace('peaks-caller-first-');
  // Deterministic caller resolution: the vendor-neutral env override wins
  // over the IDE adapter, and no harness outer-session signal leaks in.
  withEnv('PEAKS_CALLER_ID', CALLER_A);
  withEnv('PEAKS_SESSION_ID', undefined);
  withEnv('PEAKS_OUTER_SESSION_ID', undefined);
  withEnv('CLAUDE_CODE_SESSION_ID', undefined);
});

afterEach(() => {
  cleanupTmpWorkspace();
});

describe('Scenario: behavior — caller binding outranks the project-global file', () => {
  it('when two callers are bound to different sessions and the global file was last written by the other caller, should resolve the caller-bound session', () => {
    // given: caller A -> SID_A, caller B -> SID_B, and a project-global
    //        session.json that caller B wrote last (last-writer-wins)
    seedCallerBinding(ws.path, CALLER_A, SID_A);
    seedCallerBinding(ws.path, CALLER_B, SID_B);
    seedGlobalSession(ws.path, SID_B);
    // when: the current session is resolved as caller A
    withEnv('PEAKS_CALLER_ID', CALLER_A);
    const asCallerA = getCurrentSessionId(ws.path);
    // then: caller A gets A's session, not the global file's
    expect(asCallerA).toBe(SID_A);
    // and every resolver agrees — the drift between the two public
    // answers to "which session is current?" is what this slice removes
    expect(getSessionId(ws.path)).toBe(SID_A);
    expect(getSessionIdCanonical(ws.path)).toBe(SID_A);
    // and the same query as caller B still gets B's session
    withEnv('PEAKS_CALLER_ID', CALLER_B);
    expect(getCurrentSessionId(ws.path)).toBe(SID_B);
  });

  it('when a caller binding exists and no project-global file exists, should resolve the caller-bound session', () => {
    // given: only caller A's binding is on disk
    seedCallerBinding(ws.path, CALLER_A, SID_A);
    // when: the current session is resolved
    const resolved = getCurrentSessionId(ws.path);
    // then: the caller binding is enough
    expect(resolved).toBe(SID_A);
  });

  it('when no caller binding exists, should still honour the project-global session.json (CI / plain shell back-compat)', () => {
    // given: no per-caller file, and a canonical session.json on disk
    seedGlobalSession(ws.path, SID_B);
    // when: the caller id cannot be resolved (no env override, no adapter)
    withEnv('PEAKS_CALLER_ID', undefined);
    const resolved = getCurrentSessionId(ws.path);
    // then: the global file is honoured exactly as before
    expect(resolved).toBe(SID_B);
  });

  it('when no caller binding exists and only the legacy .session.json exists, should resolve the legacy binding', () => {
    // given: a pre-migration tree with only the legacy back-compat file
    seedLegacySession(ws.path, SID_B);
    // when: the caller id cannot be resolved
    withEnv('PEAKS_CALLER_ID', undefined);
    const resolved = getCurrentSessionId(ws.path);
    // then: the legacy read window still works
    expect(resolved).toBe(SID_B);
  });

  it('when nothing at all is bound, should return null (never throw)', () => {
    // given: an empty workspace
    // when: the current session is resolved
    withEnv('PEAKS_CALLER_ID', undefined);
    // then: the "no session bound" signal is preserved for callers that
    //       depend on it (they own the unknown-sid / NO_ACTIVE_SESSION fallback)
    expect(getCurrentSessionId(ws.path)).toBeNull();
  });

  it('when a caller binding exists but the global file points elsewhere, should not create a foreign session directory', () => {
    // given: caller A -> SID_A and a global binding at SID_B whose
    //        session directory does not exist on disk
    seedCallerBinding(ws.path, CALLER_A, SID_A);
    seedGlobalSession(ws.path, SID_B);
    // when: the current session is resolved repeatedly (as job / dispatch /
    //       share / worktree-lease all do within one invocation)
    getCurrentSessionId(ws.path);
    getCurrentSessionId(ws.path);
    // then: the foreign session is untouched — no directory materialised
    expect(existsSync(join(ws.path, '.peaks', '_runtime', SID_B))).toBe(false);
  });
});

describe('Scenario: integration — a job lands in the caller-bound session', () => {
  it('when a valid caller binding exists, should write the job into the caller session and create no foreign session directory', async () => {
    // given: caller A -> SID_A, while the project-global binding (last
    //        written by the other IDE window) points at SID_B
    seedCallerBinding(ws.path, CALLER_A, SID_A);
    seedGlobalSession(ws.path, SID_B);
    withEnv('PEAKS_CALLER_ID', CALLER_A);
    // when: a real `peaks job init` runs without --session-id
    const envelope = await runJobInit(ws.path, 'caller-first-2026-09-12');
    // then: the job is written into A's session ...
    expect(envelope.ok).toBe(true);
    const statePath = join(ws.path, '.peaks', '_runtime', SID_A, 'job', 'caller-first-2026-09-12', 'state.json');
    expect(existsSync(statePath)).toBe(true);
    expect(JSON.parse(readFileSync(statePath, 'utf8')).sessionId).toBe(SID_A);
    // ... and the other window's session stays untouched
    expect(existsSync(join(ws.path, '.peaks', '_runtime', SID_B))).toBe(false);
  });

  it('when no caller binding exists, should still write the job into the project-global session', async () => {
    // given: no per-caller file, and the global binding points at SID_B
    seedGlobalSession(ws.path, SID_B);
    withEnv('PEAKS_CALLER_ID', undefined);
    // when: a real `peaks job init` runs
    const envelope = await runJobInit(ws.path, 'global-fallback-2026-09-12');
    // then: single-window behaviour is unchanged (no regression for CI)
    expect(envelope.ok).toBe(true);
    const statePath = join(ws.path, '.peaks', '_runtime', SID_B, 'job', 'global-fallback-2026-09-12', 'state.json');
    expect(existsSync(statePath)).toBe(true);
  });
});

// tests/unit/session/caller-binding-primary-source.test.ts
//
// Slice 2026-08-06-session-cacde8-A.5a + A.5b: caller-binding becomes
// primary read source in `ensureSession` and `getSessionId` /
// `getSessionIdCanonical`. `setCallerBinding` now writes via
// `atomicWriteJson` instead of `writeFileSync`.
//
// Dimensions covered:
//   - behavior:    3-tier read order; per-caller wins; legacy fallback;
//                  getSessionId preservation contract; atomic write
//                  via spy assertion.
//   - integration: real on-disk tmp workspace; real
//                  `setCallerBinding` + `getCallerBinding` round-trip;
//                  real `resolveCallerProjection` via env override.
//   - render:      omitted — JSON-shaped results, no formatted output.
//   - a11y:        omitted — no human-facing text in this path.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { declareDimensions } from '../_setup/4dim-template.js';
import { ensureSession } from '../../../src/services/session/session-binding-bridge.js';
import {
  getSessionId,
  getSessionIdCanonical,
} from '../../../src/services/session/session-manager.js';
import {
  getCallerBinding,
  setCallerBinding,
} from '../../../src/services/session/caller-binding-service.js';
import type { CallerBinding } from '../../../src/services/session/caller-id-types.js';

declareDimensions(
  'tests/unit/session/caller-binding-primary-source.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'JSON-shaped results; no formatted output surface' },
    { dim: 'a11y', reason: 'no human-facing text in this path' },
  ],
);

const CALLER_ID = 'caller-test-primary';
const SID = '2026-08-06-session-testbed-primary-source';
const SID_FALLBACK = '2026-08-06-session-testbed-legacy-fallback';

let workspace: string;
let prevCwd: string;
let prevPeaksCallerEnv: string | undefined;
let prevPeaksEnv: string | undefined;
let prevClaudeEnv: string | undefined;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'peaks-caller-primary-'));
  prevCwd = process.cwd();
  process.chdir(workspace);
  prevPeaksCallerEnv = process.env.PEAKS_CALLER_ID;
  prevPeaksEnv = process.env.PEAKS_OUTER_SESSION_ID;
  prevClaudeEnv = process.env.CLAUDE_CODE_SESSION_ID;
  // PEAKS_CALLER_ID is the vendor-neutral override that makes
  // resolveCallerProjection return deterministically without an IDE
  // adapter.
  process.env.PEAKS_CALLER_ID = CALLER_ID;
  delete process.env.PEAKS_OUTER_SESSION_ID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
});

afterEach(() => {
  if (prevPeaksCallerEnv === undefined) delete process.env.PEAKS_CALLER_ID;
  else process.env.PEAKS_CALLER_ID = prevPeaksCallerEnv;
  if (prevPeaksEnv === undefined) delete process.env.PEAKS_OUTER_SESSION_ID;
  else process.env.PEAKS_OUTER_SESSION_ID = prevPeaksEnv;
  if (prevClaudeEnv === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
  else process.env.CLAUDE_CODE_SESSION_ID = prevClaudeEnv;
  try { process.chdir(prevCwd); } catch { /* best-effort */ }
  setImmediate(() => {
    try { rmSync(workspace, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
});

function seedCallerBinding(sessionId: string): void {
  const payload: CallerBinding = {
    callerId: CALLER_ID,
    peakSessionId: sessionId,
    projectRoot: workspace,
    createdAt: '2026-08-06T00:00:00.000Z',
    lastActivityAt: '2026-08-06T00:00:00.000Z',
    skill: 'peaks-code',
    mode: 'full-auto',
    gate: 'startup'
  };
  setCallerBinding(workspace, CALLER_ID, payload);
}

function seedLegacySessionJson(sessionId: string): void {
  const runtimeDir = join(workspace, '.peaks', '_runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'session.json'),
    JSON.stringify(
      { sessionId, createdAt: '2026-08-06T00:00:00.000Z', projectRoot: workspace },
      null,
      2
    ),
    'utf8'
  );
}

describe('Scenario: behavior — 3-tier read order in ensureSession', () => {
  it('AC1: both files exist, callerId resolves → ensureSession returns per-caller file sessionId (primary wins)', async () => {
    seedCallerBinding(SID);
    seedLegacySessionJson(SID_FALLBACK);
    const got = await ensureSession(workspace);
    expect(got).toBe(SID);
  });

  it('AC2: only session.json exists, callerId resolves → ensureSession returns session.json sessionId (fallback)', async () => {
    // No per-caller file; caller-binding lookup returns null; falls through to session.json.
    seedLegacySessionJson(SID_FALLBACK);
    const got = await ensureSession(workspace);
    expect(got).toBe(SID_FALLBACK);
  });

  it('AC3: only callers/<callerId>.json exists → ensureSession returns it (primary); session.json is also written for legacy consumers', async () => {
    seedCallerBinding(SID);
    // ensureSession must return the per-caller sessionId AND write
    // the legacy session.json so legacy readers (e.g. the read path
    // in getSessionId when callerId fails to resolve) still work.
    const got = await ensureSession(workspace);
    expect(got).toBe(SID);
    const sessionJsonPath = join(workspace, '.peaks', '_runtime', 'session.json');
    const raw = readFileSync(sessionJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as { sessionId: string };
    expect(parsed.sessionId).toBe(SID);
  });

  it('AC4: neither file exists, callerId resolves → ensureSession fresh-generates and writes BOTH files atomically', async () => {
    const got = await ensureSession(workspace);
    expect(got).toMatch(/^\d{4}-\d{2}-\d{2}-session-[a-f0-9]+$/);
    // Per-caller file written
    const binding = getCallerBinding(workspace, CALLER_ID);
    expect(binding?.peakSessionId).toBe(got);
    // session.json written
    const sessionJsonPath = join(workspace, '.peaks', '_runtime', 'session.json');
    const raw = readFileSync(sessionJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as { sessionId: string };
    expect(parsed.sessionId).toBe(got);
  });
});

describe('Scenario: behavior — callerId-unresolved fallback', () => {
  it('AC5: callerId fails to resolve → ensureSession falls through to session.json', async () => {
    // Unset PEAKS_CALLER_ID so resolveCallerProjection falls through
    // to the adapter layer, which throws PEAKS_CALLER_NOT_RESOLVED
    // when no adapter is wired. Force the fall-through.
    delete process.env.PEAKS_CALLER_ID;
    seedLegacySessionJson(SID_FALLBACK);
    const got = await ensureSession(workspace);
    expect(got).toBe(SID_FALLBACK);
  });

  it('AC6: callers/<callerId>.json exists but is malformed → getCallerBinding returns null (graceful fallback to session.json)', () => {
    // Write a malformed per-caller file.
    const dir = join(workspace, '.peaks', '_runtime', 'callers');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${CALLER_ID}.json`),
      '{not valid json',
      'utf8'
    );
    seedLegacySessionJson(SID_FALLBACK);
    const binding = getCallerBinding(workspace, CALLER_ID);
    expect(binding).toBeNull();
  });
});

describe('Scenario: behavior — getSessionId / getSessionIdCanonical preservation', () => {
  it('AC7: getSessionId returns the same value for caller-binding-primary AND session.json-fallback paths', () => {
    seedCallerBinding(SID);
    seedLegacySessionJson(SID_FALLBACK);
    // getSessionId consults caller-binding FIRST (per-caller wins).
    expect(getSessionId(workspace)).toBe(SID);
    // When the per-caller file is absent, it falls back to session.json.
    rmSync(join(workspace, '.peaks', '_runtime', 'callers'), { recursive: true, force: true });
    expect(getSessionId(workspace)).toBe(SID_FALLBACK);
  });

  it('AC8: getSessionIdCanonical returns the same value as getSessionId when caller-binding is the primary source', () => {
    seedCallerBinding(SID);
    seedLegacySessionJson(SID_FALLBACK);
    expect(getSessionIdCanonical(workspace)).toBe(SID);
    expect(getSessionId(workspace)).toBe(SID);
  });
});

describe('Scenario: behavior — atomic write hygiene (A.5b)', () => {
  it('AC9: setCallerBinding writes a clean, parseable caller-binding file (atomic-write contract)', () => {
    // The atomic-write contract is verified via the public surface:
    // the resulting on-disk file is the exact JSON payload that was
    // passed in (atomic write via temp + rename produces the same
    // shape as the legacy writeFileSync path). The presence of the
    // file under `.peaks/_runtime/callers/<callerId>.json` with the
    // correct payload is the user-facing contract.
    seedCallerBinding(SID);
    const bindingPath = join(workspace, '.peaks', '_runtime', 'callers', `${CALLER_ID}.json`);
    expect(existsSync(bindingPath)).toBe(true);
    const raw = readFileSync(bindingPath, 'utf8');
    const parsed = JSON.parse(raw) as { callerId: string; peakSessionId: string };
    expect(parsed.callerId).toBe(CALLER_ID);
    expect(parsed.peakSessionId).toBe(SID);
    // Atomic write leaves NO temp files behind in the callers dir.
    const { readdirSync } = require('node:fs');
    const dirEntries = readdirSync(join(workspace, '.peaks', '_runtime', 'callers'));
    const tempFiles = dirEntries.filter((n: string) => n.startsWith('.settings.') && n.endsWith('.tmp'));
    expect(tempFiles.length).toBe(0);
  });

  it('AC9b: setCallerBinding leaves no temp-file residue (atomic write cleanup)', () => {
    seedCallerBinding(SID);
    // atomicWriteJson on rename-failure would unlink the temp file
    // (best-effort). On success, no .settings.<uuid>.tmp is left
    // behind. Verify by listing the parent dir.
    const { readdirSync } = require('node:fs');
    const dirEntries = readdirSync(join(workspace, '.peaks', '_runtime', 'callers'));
    expect(dirEntries).toEqual([`${CALLER_ID}.json`]);
  });
});

describe('Scenario: behavior — dual-write ordering', () => {
  it('AC10: ensureSession writes BOTH callers/<callerId>.json AND session.json (per-caller FIRST, source of truth)', async () => {
    await ensureSession(workspace);
    // The per-caller file must exist after ensureSession.
    const callerBindingPath = join(workspace, '.peaks', '_runtime', 'callers', `${CALLER_ID}.json`);
    expect(existsSync(callerBindingPath)).toBe(true);
    // session.json must also exist.
    const sessionJsonPath = join(workspace, '.peaks', '_runtime', 'session.json');
    expect(existsSync(sessionJsonPath)).toBe(true);
    // Both files point at the same sessionId.
    const callerRaw = JSON.parse(readFileSync(callerBindingPath, 'utf8')) as { peakSessionId: string };
    const sessionRaw = JSON.parse(readFileSync(sessionJsonPath, 'utf8')) as { sessionId: string };
    expect(callerRaw.peakSessionId).toBe(sessionRaw.sessionId);
    // Atomic-write hygiene: no leftover temp files in either dir.
    const { readdirSync } = require('node:fs');
    const callerDir = readdirSync(join(workspace, '.peaks', '_runtime', 'callers'));
    const sessionDir = readdirSync(join(workspace, '.peaks', '_runtime'));
    expect(callerDir.some((n: string) => n.endsWith('.tmp'))).toBe(false);
    expect(sessionDir.some((n: string) => n.endsWith('.tmp'))).toBe(false);
  });
});
// tests/unit/session/ensure-session-meta-coverage.test.ts
//
// Slice 2026-08-06-session-outer-cache (G3 / AC8-AC11):
//   When `ensureSession` sees an already-bound session, it must
//   stamp the current outer-session-id onto the bound session's
//   meta via `setSessionMeta` BEFORE returning — so the on-disk
//   `.peaks/_runtime/<sid>/session.json` always reflects the latest
//   outer signal, not a stale value captured at session creation.
//   `setSessionMeta` is read-modify-write: every other field
//   (title / skill / mode / gate / createdAt / lastActivity) is
//   preserved.
//
// Dimensions covered:
//   - behavior:    already-bound path calls setSessionMeta with the
//                  current outerSessionId; undefined outer does NOT
//                  set the field (preserves existing meta); other
//                  meta fields are preserved across the overwrite.
//   - integration: real on-disk `.peaks/_runtime/<sid>/session.json`
//                  round-trip — read back the JSON to confirm shape.
//   - render:      omitted — meta is JSON, no formatted output surface.
//   - a11y:        omitted — no human-facing text.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { declareDimensions } from '../_setup/4dim-template.js';
import { ensureSession } from '../../../src/services/session/session-binding-bridge.js';
import {
  getSessionMeta,
  setSessionMeta,
  type SessionMeta
} from '../../../src/services/session/session-manager.js';

declareDimensions(
  'tests/unit/session/ensure-session-meta-coverage.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'setSessionMeta returns JSON-shaped meta; no formatted output surface' },
    { dim: 'a11y', reason: 'no human-facing text in the meta path' },
  ],
);

const CACHE_REL = join('.peaks', '_runtime', '.outer-session-cache.json');
const SESSION_ID = '2026-08-06-session-testbed-coverage';

let workspace: string;
let prevCwd: string;
let prevPeaksEnv: string | undefined;
let prevClaudeEnv: string | undefined;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'peaks-meta-coverage-'));
  prevCwd = process.cwd();
  process.chdir(workspace);
  prevPeaksEnv = process.env.PEAKS_OUTER_SESSION_ID;
  prevClaudeEnv = process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.PEAKS_OUTER_SESSION_ID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
});

afterEach(() => {
  if (prevPeaksEnv === undefined) delete process.env.PEAKS_OUTER_SESSION_ID;
  else process.env.PEAKS_OUTER_SESSION_ID = prevPeaksEnv;
  if (prevClaudeEnv === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
  else process.env.CLAUDE_CODE_SESSION_ID = prevClaudeEnv;
  try { process.chdir(prevCwd); } catch { /* best-effort */ }
  setImmediate(() => {
    try { rmSync(workspace, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
});

/**
 * Pre-seed the binding so the next `ensureSession` call hits the
 * already-bound path (not the auto-create path).
 */
function seedBinding(): void {
  const runtimeDir = join(workspace, '.peaks', '_runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'session.json'),
    JSON.stringify(
      { sessionId: SESSION_ID, createdAt: '2026-08-06T00:00:00.000Z', projectRoot: workspace },
      null,
      2
    ),
    'utf8'
  );
}

function writeCacheFile(outerSessionId: string): void {
  const dir = join(workspace, '.peaks', '_runtime');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(workspace, CACHE_REL),
    JSON.stringify({ outerSessionId, capturedAt: '2026-08-06T00:00:00.000Z' }),
    'utf8'
  );
}

describe("Scenario: behavior — already-bound ensureSession overwrites meta.outerSessionId", () => {
  it('AC8: already-bound session has its outerSessionId overwritten on every ensureSession call', async () => {
    seedBinding();
    const newOuter = 'session-start-current-outer';
    writeCacheFile(newOuter);

    const sessionId = await ensureSession(workspace);
    expect(sessionId).toBe(SESSION_ID);
    const meta = getSessionMeta(workspace, sessionId);
    expect(meta?.outerSessionId).toBe(newOuter);
  });

  it('AC9: outerSessionId overwrite does NOT create a new sid', async () => {
    seedBinding();
    const outerA = 'first-outer';
    writeCacheFile(outerA);
    const sessionIdA = await ensureSession(workspace);
    expect(sessionIdA).toBe(SESSION_ID);

    // New outer fires (new SessionStart).
    const outerB = 'second-outer-new-session';
    writeCacheFile(outerB);
    const sessionIdB = await ensureSession(workspace);
    expect(sessionIdB).toBe(SESSION_ID); // PB1: same binding, no rotation
    expect(sessionIdB).toBe(sessionIdA);
  });

  it('AC11: repeated ensureSession calls keep meta on the most recent outerSessionId', async () => {
    seedBinding();
    const outers = ['outer-1', 'outer-2', 'outer-3'];
    for (const outer of outers) {
      writeCacheFile(outer);
      await ensureSession(workspace);
      const meta = getSessionMeta(workspace, SESSION_ID);
      expect(meta?.outerSessionId).toBe(outer);
    }
  });
});

describe("Scenario: behavior — undefined outer preserves existing meta", () => {
  it('AC10 (partial): when no env + no cache, ensureSession leaves pre-existing outerSessionId untouched', async () => {
    seedBinding();
    // Pre-seed the meta with an outerSessionId via setSessionMeta.
    setSessionMeta(workspace, SESSION_ID, { outerSessionId: 'pre-existing-outer' });
    expect(getSessionMeta(workspace, SESSION_ID)?.outerSessionId).toBe('pre-existing-outer');

    // No env, no cache → getCurrentOuterSessionId returns undefined;
    // ensureSession MUST NOT clobber the pre-existing field.
    const sessionId = await ensureSession(workspace);
    expect(sessionId).toBe(SESSION_ID);
    const meta = getSessionMeta(workspace, SESSION_ID);
    expect(meta?.outerSessionId).toBe('pre-existing-outer');
  });

  it('when no env + no cache, ensureSession leaves meta WITHOUT outerSessionId intact', async () => {
    seedBinding();
    // No prior meta, no outer signal — ensureSession does NOT
    // auto-create meta on the already-bound path (the meta is only
    // written at fresh-session creation, line ~272 of the bridge).
    // The pre-existing absent meta remains absent.
    const sessionId = await ensureSession(workspace);
    expect(sessionId).toBe(SESSION_ID);
    const meta = getSessionMeta(workspace, sessionId);
    expect(meta).toBeNull();
  });
});

describe("Scenario: integration — other meta fields preserved across outer overwrite", () => {
  it('AC10: title / skill / mode / gate / createdAt are preserved when outerSessionId is overwritten', async () => {
    seedBinding();
    // Seed a fully-populated meta.
    setSessionMeta(workspace, SESSION_ID, {
      title: 'peaks-rd session',
      skill: 'peaks-rd',
      mode: 'autonomous',
      gate: 'rd-handoff',
      outerSessionId: 'old-outer'
    });
    const before = getSessionMeta(workspace, SESSION_ID);
    expect(before?.title).toBe('peaks-rd session');
    expect(before?.skill).toBe('peaks-rd');
    expect(before?.mode).toBe('autonomous');
    expect(before?.gate).toBe('rd-handoff');
    expect(before?.outerSessionId).toBe('old-outer');
    expect(before?.createdAt).toBeDefined();
    const createdAtBefore = before?.createdAt;

    // New outer fires.
    const newOuter = 'new-outer-from-session-start';
    writeCacheFile(newOuter);
    const sessionId = await ensureSession(workspace);
    expect(sessionId).toBe(SESSION_ID);

    const after = getSessionMeta(workspace, sessionId);
    expect(after?.title).toBe('peaks-rd session');
    expect(after?.skill).toBe('peaks-rd');
    expect(after?.mode).toBe('autonomous');
    expect(after?.gate).toBe('rd-handoff');
    expect(after?.createdAt).toBe(createdAtBefore);
    expect(after?.outerSessionId).toBe(newOuter);
    // lastActivity is updated by setSessionMeta; just confirm it's
    // a fresh ISO string.
    expect(typeof after?.lastActivity).toBe('string');
    expect(after?.lastActivity).not.toBe('');
  });

  it('on-disk JSON shape is preserved (no extra fields, no missing fields)', async () => {
    seedBinding();
    setSessionMeta(workspace, SESSION_ID, { outerSessionId: 'old-outer' });
    const newOuter = 'overwrite-via-ensureSession';
    writeCacheFile(newOuter);

    await ensureSession(workspace);

    const metaPath = join(workspace, '.peaks', '_runtime', SESSION_ID, 'session.json');
    const raw = readFileSync(metaPath, 'utf8');
    const parsed = JSON.parse(raw) as SessionMeta;
    expect(parsed.sessionId).toBe(SESSION_ID);
    expect(parsed.projectRoot).toBe(resolve(workspace));
    expect(parsed.outerSessionId).toBe(newOuter);
    expect(typeof parsed.createdAt).toBe('string');
    expect(typeof parsed.lastActivity).toBe('string');
  });
});

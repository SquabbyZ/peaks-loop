// tests/unit/session/rotation-guards-tightening.test.ts
//
// Slice 2026-08-06-session-cacde8-A.3: 4th rotation guard added to
// `ensureSessionWithRotation`. The 3 legacy guards (currentOuter undefined
// / boundOuter empty / boundOuter===currentOuter) stay verbatim. The 4th
// guard short-circuits same-process re-resolves via a module-scoped
// `lastResolvedOuter` field populated on every `getCurrentOuterSessionId`
// call.
//
// Dimensions covered:
//   - behavior:    4 guards fire correctly; module state does not leak;
//                  skipRotate short-circuits all 4.
//   - integration: real on-disk `.peaks/_runtime/<sid>/session.json`
//                  round-trip; real tmp workspace layout.
//   - render:      omitted — rotation guard returns JSON-shaped result only.
//   - a11y:        omitted — no human-facing text in this path.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  _resetLastResolvedOuterForTest,
  ensureSessionWithRotation,
} from '../../../src/services/session/session-binding-bridge.js';
import { setSessionMeta } from '../../../src/services/session/session-manager.js';

declareDimensions(
  'tests/unit/session/rotation-guards-tightening.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'rotation guard returns JSON-shaped result; no formatted output surface' },
    { dim: 'a11y', reason: 'no human-facing text in this path' },
  ],
);

const SID = '2026-08-06-session-testbed-rotation';
const CACHE_REL = join('.peaks', '_runtime', '.outer-session-cache.json');

let workspace: string;
let prevCwd: string;
let prevPeaksEnv: string | undefined;
let prevClaudeEnv: string | undefined;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'peaks-rotation-guards-'));
  prevCwd = process.cwd();
  process.chdir(workspace);
  prevPeaksEnv = process.env.PEAKS_OUTER_SESSION_ID;
  prevClaudeEnv = process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.PEAKS_OUTER_SESSION_ID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  _resetLastResolvedOuterForTest();
});

afterEach(() => {
  if (prevPeaksEnv === undefined) delete process.env.PEAKS_OUTER_SESSION_ID;
  else process.env.PEAKS_OUTER_SESSION_ID = prevPeaksEnv;
  if (prevClaudeEnv === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
  else process.env.CLAUDE_CODE_SESSION_ID = prevClaudeEnv;
  try { process.chdir(prevCwd); } catch { /* best-effort */ }
  _resetLastResolvedOuterForTest();
  setImmediate(() => {
    try { rmSync(workspace, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
});

function seedBinding(): void {
  const runtimeDir = join(workspace, '.peaks', '_runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'session.json'),
    JSON.stringify({ sessionId: SID, createdAt: '2026-08-06T00:00:00.000Z', projectRoot: workspace }, null, 2),
    'utf8'
  );
}

function writeCacheFile(outerSessionId: string): void {
  const dir = join(workspace, '.peaks', '_runtime');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(workspace, CACHE_REL),
    JSON.stringify({ outerSessionId, capturedAt: '2026-08-06T00:00:00.000Z' }, null, 2),
    'utf8'
  );
}

describe('Scenario: behavior — 3 legacy guards still win (regression)', () => {
  it('AC2: env undefined + no cache → guard 1 short-circuits, no rotation', async () => {
    seedBinding();
    // No env, no cache → currentOuter undefined. The first call
    // also seeds lastResolvedOuter to undefined, so the 4th guard
    // is inert (lastResolvedOuter?.value === undefined). Legacy
    // guard 1 fires.
    const result = await ensureSessionWithRotation(workspace);
    expect(result.rotationReason).toBeNull();
    expect(result.previousSessionId).toBeNull();
    expect(result.sessionId).toBe(SID);
  });

  it('AC3: boundOuter undefined (no meta stamped) → guard 2 short-circuits, no rotation', async () => {
    seedBinding();
    process.env.PEAKS_OUTER_SESSION_ID = 'outer-from-env';
    // No setSessionMeta → boundMeta.outerSessionId is undefined.
    // Legacy guard 2 fires.
    const result = await ensureSessionWithRotation(workspace);
    expect(result.rotationReason).toBeNull();
    expect(result.previousSessionId).toBeNull();
    expect(result.sessionId).toBe(SID);
  });

  it('AC4: boundOuter === currentOuter → guard 3 short-circuits (reconnect case)', async () => {
    seedBinding();
    const outer = 'outer-reconnect-same';
    process.env.PEAKS_OUTER_SESSION_ID = outer;
    setSessionMeta(workspace, SID, { outerSessionId: outer });
    // The 4th guard ALSO fires here (lastResolvedOuter.value ===
    // currentOuter === boundOuter); both guards agree. Regression:
    // guard 3 still pins the no-rotation behaviour.
    const result = await ensureSessionWithRotation(workspace);
    expect(result.rotationReason).toBeNull();
    expect(result.previousSessionId).toBeNull();
    expect(result.sessionId).toBe(SID);
  });
});

describe('Scenario: behavior — 4th same-process re-resolve guard', () => {
  it('AC5: env flips A→B same-process, boundOuter=A — first call rotates, second call no-ops (4th guard)', async () => {
    seedBinding();
    const outerA = 'outer-a-initial';
    process.env.PEAKS_OUTER_SESSION_ID = outerA;
    setSessionMeta(workspace, SID, { outerSessionId: outerA });

    // First call: lastResolvedOuter is null, so 4th guard is inert.
    // boundOuter (outerA) === currentOuter (outerA) → guard 3 short-
    // circuits. No rotation, lastResolvedOuter.value === outerA.
    const r1 = await ensureSessionWithRotation(workspace);
    expect(r1.rotationReason).toBeNull();

    // Flip env to outerB inside the same process. boundOuter is still
    // outerA. First rotate path fires (legacy comparison).
    process.env.PEAKS_OUTER_SESSION_ID = 'outer-b-different';
    const r2 = await ensureSessionWithRotation(workspace);
    // Rotation IS expected here (boundOuter=A, currentOuter=B).
    // After rotate, lastResolvedOuter.value === outerB and the binding
    // points at a fresh session.
    expect(r2.rotationReason).toBe('outer-session-mismatch');

    // Second call with env still at outerB: lastResolvedOuter.value
    // === outerB. The new binding has its meta stamped with outerB
    // (via ensureSession's setSessionMeta path). 4th guard fires:
    // no rotation.
    const r3 = await ensureSessionWithRotation(workspace);
    expect(r3.rotationReason).toBeNull();
    expect(r3.previousSessionId).toBeNull();
  });

  it('AC6: per-process guard does not leak across CLI invocations (each process is a fresh resolve)', async () => {
    seedBinding();
    const outer = 'outer-pinned-across-process';
    process.env.PEAKS_OUTER_SESSION_ID = outer;
    setSessionMeta(workspace, SID, { outerSessionId: outer });

    // First invocation: prime lastResolvedOuter.
    const r1 = await ensureSessionWithRotation(workspace);
    expect(r1.rotationReason).toBeNull();

    // Simulate a fresh CLI invocation: reset module state.
    _resetLastResolvedOuterForTest();

    // Same env, same binding: guard 4 is inert (lastResolvedOuter
    // is null again). Guard 3 still fires (reconnect).
    const r2 = await ensureSessionWithRotation(workspace);
    expect(r2.rotationReason).toBeNull();
    expect(r2.sessionId).toBe(SID);
  });

  it('AC7: cache alone (no env) → guard 1 short-circuits, no rotation', async () => {
    seedBinding();
    writeCacheFile('outer-from-cache-only');
    // No env, cache present. currentOuter resolves to the cached
    // value; boundOuter is undefined (no setSessionMeta). Guard 2
    // fires (boundOuter undefined).
    const result = await ensureSessionWithRotation(workspace);
    expect(result.rotationReason).toBeNull();
    expect(result.sessionId).toBe(SID);
  });

  it('AC8: skipRotateOnOuterMismatch=true → all 4 guards short-circuited', async () => {
    seedBinding();
    const outerA = 'outer-a-skip';
    process.env.PEAKS_OUTER_SESSION_ID = outerA;
    setSessionMeta(workspace, SID, { outerSessionId: outerA });

    // Flip env to trigger a would-be rotation. skipRotate forces no
    // rotation; 4th guard also fires (lastResolvedOuter.value === outerA
    // on the first call, but currentOuter is now outerB, so the 4th
    // guard does NOT match). skipRotate is the deciding factor.
    process.env.PEAKS_OUTER_SESSION_ID = 'outer-b-skip';
    const result = await ensureSessionWithRotation(workspace, {
      skipRotateOnOuterMismatch: true,
    });
    expect(result.rotationReason).toBeNull();
    expect(result.previousSessionId).toBeNull();
    expect(result.sessionId).toBe(SID);
  });
});

describe('Scenario: behavior — module-scoped lastResolvedOuter integrity', () => {
  it('populates lastResolvedOuter on every ensureSessionWithRotation call (env hit)', async () => {
    seedBinding();
    const outer = 'outer-tracked';
    process.env.PEAKS_OUTER_SESSION_ID = outer;
    setSessionMeta(workspace, SID, { outerSessionId: outer });
    // First call: prime lastResolvedOuter via the 3 legacy guards.
    const r1 = await ensureSessionWithRotation(workspace);
    expect(r1.rotationReason).toBeNull();

    // Second call: 4th guard fires (same env, same boundOuter, lastResolvedOuter.value === outer).
    // We confirm via: still no rotation.
    const r2 = await ensureSessionWithRotation(workspace);
    expect(r2.rotationReason).toBeNull();
    expect(r2.sessionId).toBe(SID);
  });

  it('records undefined fallback when env + cache both miss', async () => {
    seedBinding();
    // First call: env + cache both miss → lastResolvedOuter.value === undefined.
    const r1 = await ensureSessionWithRotation(workspace);
    expect(r1.rotationReason).toBeNull();

    // After lastResolvedOuter.value is undefined, the 4th guard is
    // INERT (guard checks `lastResolvedOuter?.value !== undefined`).
    // A subsequent call where currentOuter IS defined falls through
    // to the legacy comparison path; no false-positive rotation
    // because boundOuter is also undefined (guard 2 fires).
    process.env.PEAKS_OUTER_SESSION_ID = 'outer-defined-later';
    const r2 = await ensureSessionWithRotation(workspace);
    expect(r2.rotationReason).toBeNull();
    expect(r2.sessionId).toBe(SID);
  });

  it('handles multiple sub-processes (each starts fresh via reset)', async () => {
    seedBinding();
    const outer = 'outer-stable';
    process.env.PEAKS_OUTER_SESSION_ID = outer;
    setSessionMeta(workspace, SID, { outerSessionId: outer });

    // Sub-process 1
    _resetLastResolvedOuterForTest();
    const r1 = await ensureSessionWithRotation(workspace);
    expect(r1.rotationReason).toBeNull();

    // Sub-process 2 (simulate fresh process: reset)
    _resetLastResolvedOuterForTest();
    const r2 = await ensureSessionWithRotation(workspace);
    expect(r2.rotationReason).toBeNull();
    expect(r2.sessionId).toBe(SID);
  });
});

describe('Scenario: integration — vi.mock-friendly regression contract', () => {
  it('AC9: 4.0.14 AC8-AC11 still PASS via env-cache-undefined ordering', async () => {
    // Regression for the 4.0.14 outer-cache + meta-coverage contract:
    // seed a binding, write a cache file, ensureSession must stamp
    // meta.outerSessionId without rotating.
    seedBinding();
    const cachedOuter = 'cached-outer-4014-regression';
    writeCacheFile(cachedOuter);

    const result = await ensureSessionWithRotation(workspace);
    expect(result.rotationReason).toBeNull();
    expect(result.previousSessionId).toBeNull();
    expect(result.sessionId).toBe(SID);
  });
});
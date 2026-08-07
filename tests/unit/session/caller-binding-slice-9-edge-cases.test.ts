// tests/unit/session/caller-binding-slice-9-edge-cases.test.ts
//
// Slice 2026-08-07-session-cacde8-A.3/A.4/A.5 — edge-case coverage
// extension (SLICE 9).
//
// The A.3 (rotation guards), A.4 (workflowId per-caller derivation),
// and A.5 (caller-binding as primary source) slices shipped in
// commits `f38a796f` + `2f6322a3` + `97caa66b`. The existing test
// files (rotation-guards-tightening, ensure-session-meta-coverage,
// get-current-outer-session-id, caller-binding-primary-source,
// workflow-id-caller-derivation) cover the happy path + single-
// caller scenarios. This file extends coverage to the 4 gap
// categories the existing suite does not exercise:
//
//   - G1: multi-tenant rotation (D6 invariant) — two callers bound
//         to the same peakSessionId; rotation rotates ONLY the active
//         caller's peak while the other caller's binding is preserved
//         (peakSessionId field unchanged).
//
//   - G2: recovery after rotation — after a rotation, the rotated
//         caller's binding must still be readable at
//         `.peaks/_runtime/callers/<callerId>.json` (the file is NOT
//         auto-deleted). The non-rotated caller's binding must point
//         at the OLD peak (preserved on disk).
//
//   - G3: TTL / lastActivityAt freshness — setCallerBinding stamps
//         lastActivityAt on every write. A stale binding (old
//         timestamp) is still readable; only a re-write via
//         setCallerBinding refreshes it.
//
//   - G4: caller-binding hygiene under rotation — after rotation the
//         fresh session has NO caller-binding until ensureSession is
//         called by the rotated caller; the on-disk `_runtime/<oldSid>`
//         directory is preserved verbatim (rotation does NOT delete
//         data).
//
// Dimensions covered:
//   - behavior:    D6 invariant, recovery semantics, TTL freshness,
//                  rotation hygiene.
//   - integration: real on-disk `.peaks/_runtime/` round-trip; real
//                  `setCallerBinding` + `getCallerBinding` + `ensureSession`.
//   - render:      omitted — JSON-shaped results, no formatted output.
//   - a11y:        omitted — no human-facing text in this path.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  ensureSession,
  ensureSessionWithRotation,
  _resetLastResolvedOuterForTest,
} from '../../../src/services/session/session-binding-bridge.js';
import {
  getCallerBinding,
  setCallerBinding,
} from '../../../src/services/session/caller-binding-service.js';
import {
  getSessionId,
  getSessionMeta,
  type SessionMeta,
} from '../../../src/services/session/session-manager.js';
import type { CallerBinding } from '../../../src/services/session/caller-id-types.js';

declareDimensions(
  'tests/unit/session/caller-binding-slice-9-edge-cases.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'JSON-shaped results; no formatted output surface' },
    { dim: 'a11y', reason: 'no human-facing text in this path' },
  ],
);

const CALLER_A = 'caller-A-slice9';
const CALLER_B = 'caller-B-slice9';
const SID_OLD = '2026-08-07-session-old-peak';
const SID_OLD_B = '2026-08-07-session-old-peak-B';

let workspace: string;
let prevCwd: string;
let prevPeaksCallerEnv: string | undefined;
let prevPeaksOuterEnv: string | undefined;
let prevClaudeEnv: string | undefined;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'peaks-slice9-edge-'));
  prevCwd = process.cwd();
  process.chdir(workspace);
  prevPeaksCallerEnv = process.env.PEAKS_CALLER_ID;
  prevPeaksOuterEnv = process.env.PEAKS_OUTER_SESSION_ID;
  prevClaudeEnv = process.env.CLAUDE_CODE_SESSION_ID;
  // No PEAKS_CALLER_ID by default; tests opt in via direct
  // setCallerBinding to drive the multi-tenant scenarios.
  delete process.env.PEAKS_CALLER_ID;
  delete process.env.PEAKS_OUTER_SESSION_ID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  _resetLastResolvedOuterForTest();
});

afterEach(() => {
  if (prevPeaksCallerEnv === undefined) delete process.env.PEAKS_CALLER_ID;
  else process.env.PEAKS_CALLER_ID = prevPeaksCallerEnv;
  if (prevPeaksOuterEnv === undefined) delete process.env.PEAKS_OUTER_SESSION_ID;
  else process.env.PEAKS_OUTER_SESSION_ID = prevPeaksOuterEnv;
  if (prevClaudeEnv === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
  else process.env.CLAUDE_CODE_SESSION_ID = prevClaudeEnv;
  try { process.chdir(prevCwd); } catch { /* best-effort */ }
  // Defer tmp cleanup; the rmSync races on Windows open-handle were
  // the source of the 5s hookTimeout flake (see slice 6 sediment).
  setImmediate(() => {
    try { require('node:fs').rmSync(workspace, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
});

function seedCallerBinding(callerId: string, sid: string, lastActivityAt: string): void {
  const payload: CallerBinding = {
    callerId,
    peakSessionId: sid,
    projectRoot: workspace,
    createdAt: '2026-08-07T00:00:00.000Z',
    lastActivityAt,
    skill: 'peaks-code',
    mode: 'full-auto',
    gate: 'startup'
  };
  setCallerBinding(workspace, callerId, payload);
}

function seedSessionJson(sid: string): void {
  const runtimeDir = join(workspace, '.peaks', '_runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'session.json'),
    JSON.stringify(
      { sessionId: sid, createdAt: '2026-08-07T00:00:00.000Z', projectRoot: workspace },
      null,
      2
    ),
    'utf8'
  );
}

function seedLegacySessionMeta(sid: string, outerId: string): void {
  const metaDir = join(workspace, '.peaks', '_runtime', sid);
  mkdirSync(metaDir, { recursive: true });
  const meta: SessionMeta = {
    sessionId: sid,
    projectRoot: workspace,
    createdAt: '2026-08-07T00:00:00.000Z',
    lastActivity: '2026-08-07T00:00:00.000Z',
    outerSessionId: outerId,
  };
  writeFileSync(join(metaDir, 'session.json'), JSON.stringify(meta, null, 2), 'utf8');
}

describe('Scenario: behavior — multi-tenant caller-binding isolation (D6)', () => {
  it('G1.1: two callers bound to the SAME peakSessionId (D6 invariant) → both bindings are readable independently', () => {
    // Seed BOTH caller-bindings pointing at the same peak.
    seedCallerBinding(CALLER_A, SID_OLD, '2026-08-07T00:00:00.000Z');
    seedCallerBinding(CALLER_B, SID_OLD, '2026-08-07T00:00:00.000Z');

    const a = getCallerBinding(workspace, CALLER_A);
    const b = getCallerBinding(workspace, CALLER_B);
    expect(a?.peakSessionId).toBe(SID_OLD);
    expect(b?.peakSessionId).toBe(SID_OLD);
    // Both files must exist on disk and be distinct.
    expect(existsSync(join(workspace, '.peaks', '_runtime', 'callers', `${CALLER_A}.json`))).toBe(true);
    expect(existsSync(join(workspace, '.peaks', '_runtime', 'callers', `${CALLER_B}.json`))).toBe(true);
    // The two bindings do NOT collide (different filenames).
    expect(`${CALLER_A}.json`).not.toBe(`${CALLER_B}.json`);
  });

  it('G1.2: writing caller-A again does NOT mutate caller-B (per-caller file isolation)', () => {
    seedCallerBinding(CALLER_A, SID_OLD, '2026-08-07T00:00:00.000Z');
    seedCallerBinding(CALLER_B, SID_OLD_B, '2026-08-07T00:00:00.000Z');

    // Re-write caller-A with a fresh lastActivityAt.
    const refreshedActivity = '2026-08-07T01:00:00.000Z';
    seedCallerBinding(CALLER_A, SID_OLD, refreshedActivity);

    const a = getCallerBinding(workspace, CALLER_A);
    const b = getCallerBinding(workspace, CALLER_B);
    expect(a?.peakSessionId).toBe(SID_OLD);
    expect(a?.lastActivityAt).toBe(refreshedActivity);
    // caller-B's binding is untouched: same peakSessionId, original timestamp.
    expect(b?.peakSessionId).toBe(SID_OLD_B);
    expect(b?.lastActivityAt).toBe('2026-08-07T00:00:00.000Z');
  });
});

describe('Scenario: behavior — recovery after rotation', () => {
  it('G2.1: after rotation, rotated caller-binding file still exists on disk (rotation preserves data)', async () => {
    // Setup: caller-A bound to SID_OLD with outer=X, caller-B bound to SID_OLD.
    seedCallerBinding(CALLER_A, SID_OLD, '2026-08-07T00:00:00.000Z');
    seedCallerBinding(CALLER_B, SID_OLD, '2026-08-07T00:00:00.000Z');
    seedSessionJson(SID_OLD);
    seedLegacySessionMeta(SID_OLD, 'outer-X');

    // Trigger rotation via the bridge.
    process.env.PEAKS_OUTER_SESSION_ID = 'outer-Y-different';
    _resetLastResolvedOuterForTest();
    const result = await ensureSessionWithRotation(workspace);
    expect(result.rotationReason).toBe('outer-session-mismatch');
    expect(result.previousSessionId).toBe(SID_OLD);

    // After rotation, the caller-binding files are NOT auto-deleted.
    const aAfter = getCallerBinding(workspace, CALLER_A);
    const bAfter = getCallerBinding(workspace, CALLER_B);
    expect(aAfter?.peakSessionId).toBe(SID_OLD);
    expect(bAfter?.peakSessionId).toBe(SID_OLD);
    // Both files still on disk (rotation does NOT wipe data).
    expect(existsSync(join(workspace, '.peaks', '_runtime', 'callers', `${CALLER_A}.json`))).toBe(true);
    expect(existsSync(join(workspace, '.peaks', '_runtime', 'callers', `${CALLER_B}.json`))).toBe(true);
  });

  it('G2.2: after rotation, fresh session has no caller-binding (rotation does NOT auto-migrate callers)', async () => {
    // Setup: caller-A bound to SID_OLD; caller-B bound to SID_OLD.
    seedCallerBinding(CALLER_A, SID_OLD, '2026-08-07T00:00:00.000Z');
    seedCallerBinding(CALLER_B, SID_OLD, '2026-08-07T00:00:00.000Z');
    seedSessionJson(SID_OLD);
    seedLegacySessionMeta(SID_OLD, 'outer-X');

    process.env.PEAKS_OUTER_SESSION_ID = 'outer-Y-rotated';
    _resetLastResolvedOuterForTest();
    const result = await ensureSessionWithRotation(workspace);
    expect(result.rotationReason).toBe('outer-session-mismatch');

    // The fresh session id differs from SID_OLD.
    expect(result.sessionId).not.toBe(SID_OLD);
    // The fresh session's on-disk meta does NOT exist yet — rotation
    // only writes session.json; per-session meta is written by the next
    // ensureSession setSessionMeta path. Pin: the rotated caller's
    // caller-binding still points at SID_OLD, NOT at the fresh id.
    const aAfter = getCallerBinding(workspace, CALLER_A);
    expect(aAfter?.peakSessionId).toBe(SID_OLD);
  });

  it('G2.3: non-rotating caller-binding survives rotation with peakSessionId UNCHANGED', async () => {
    // Pre-seed: caller-A and caller-B both bound to SID_OLD.
    seedCallerBinding(CALLER_A, SID_OLD, '2026-08-07T00:00:00.000Z');
    seedCallerBinding(CALLER_B, SID_OLD, '2026-08-07T00:00:00.000Z');
    seedSessionJson(SID_OLD);
    seedLegacySessionMeta(SID_OLD, 'outer-X');

    process.env.PEAKS_OUTER_SESSION_ID = 'outer-Y-rotation-trigger';
    _resetLastResolvedOuterForTest();
    await ensureSessionWithRotation(workspace);

    // caller-B's binding is preserved verbatim. D6 invariant: rotation
    // operates on the LEGACY single-file session.json binding, NOT on
    // the per-caller bindings. Per-caller files are preserved.
    const bAfter = getCallerBinding(workspace, CALLER_B);
    expect(bAfter?.peakSessionId).toBe(SID_OLD);
    expect(bAfter?.callerId).toBe(CALLER_B);
  });
});

describe('Scenario: behavior — TTL / lastActivityAt freshness (G3)', () => {
  it('G3.1: stale caller-binding (lastActivityAt 7 days old) is still readable', () => {
    const sevenDaysAgo = '2026-07-31T00:00:00.000Z';
    seedCallerBinding(CALLER_A, SID_OLD, sevenDaysAgo);

    const a = getCallerBinding(workspace, CALLER_A);
    expect(a).not.toBeNull();
    expect(a?.peakSessionId).toBe(SID_OLD);
    // Stale timestamp is preserved by the read path — getCallerBinding
    // does NOT refresh on read.
    expect(a?.lastActivityAt).toBe(sevenDaysAgo);
  });

  it('G3.2: re-writing via setCallerBinding refreshes lastActivityAt (idempotent update)', () => {
    const stale = '2026-07-31T00:00:00.000Z';
    seedCallerBinding(CALLER_A, SID_OLD, stale);

    const fresh = '2026-08-07T01:00:00.000Z';
    seedCallerBinding(CALLER_A, SID_OLD, fresh);

    const a = getCallerBinding(workspace, CALLER_A);
    expect(a?.lastActivityAt).toBe(fresh);
    // peakSessionId is unchanged.
    expect(a?.peakSessionId).toBe(SID_OLD);
  });

  it('G3.3: getCallerBinding does not modify on-disk timestamp (read is read-only)', () => {
    const originalActivity = '2026-08-07T00:00:00.000Z';
    seedCallerBinding(CALLER_A, SID_OLD, originalActivity);

    // Read repeatedly — on-disk timestamp must not change.
    for (let i = 0; i < 3; i++) {
      const a = getCallerBinding(workspace, CALLER_A);
      expect(a?.lastActivityAt).toBe(originalActivity);
    }
    // Re-read the raw file: timestamp unchanged.
    const raw = JSON.parse(
      readFileSync(join(workspace, '.peaks', '_runtime', 'callers', `${CALLER_A}.json`), 'utf8')
    ) as { lastActivityAt: string };
    expect(raw.lastActivityAt).toBe(originalActivity);
  });
});

describe('Scenario: behavior — rotation hygiene for caller-binding file paths (G4)', () => {
  it('G4.1: the per-caller binding file lives under .peaks/_runtime/callers/<callerId>.json (canonical path)', () => {
    seedCallerBinding(CALLER_A, SID_OLD, '2026-08-07T00:00:00.000Z');
    const canonicalPath = join(workspace, '.peaks', '_runtime', 'callers', `${CALLER_A}.json`);
    expect(existsSync(canonicalPath)).toBe(true);
  });

  it('G4.2: getCallerBinding returns null for a callerId that has no file (no cross-tenant leakage)', () => {
    seedCallerBinding(CALLER_A, SID_OLD, '2026-08-07T00:00:00.000Z');
    // caller-B has no file → getCallerBinding returns null.
    const b = getCallerBinding(workspace, CALLER_B);
    expect(b).toBeNull();
    // Sanity: caller-A still resolves correctly.
    const a = getCallerBinding(workspace, CALLER_A);
    expect(a?.peakSessionId).toBe(SID_OLD);
  });

  it('G4.3: rotation does not delete caller-binding files or the old peak dir', async () => {
    // Setup: caller-A bound to SID_OLD, session.json + per-session meta.
    seedCallerBinding(CALLER_A, SID_OLD, '2026-08-07T00:00:00.000Z');
    seedSessionJson(SID_OLD);
    seedLegacySessionMeta(SID_OLD, 'outer-X');

    process.env.PEAKS_OUTER_SESSION_ID = 'outer-Y-hygiene';
    _resetLastResolvedOuterForTest();
    const result = await ensureSessionWithRotation(workspace);
    expect(result.rotationReason).toBe('outer-session-mismatch');

    // Caller-binding file preserved (rotation operates on the legacy
    // single-file binding, NOT on the per-caller files).
    expect(existsSync(join(workspace, '.peaks', '_runtime', 'callers', `${CALLER_A}.json`))).toBe(true);
    // Old peak dir preserved (data is never wiped on rotation).
    expect(existsSync(join(workspace, '.peaks', '_runtime', SID_OLD, 'session.json'))).toBe(true);
    // Caller-binding still points at the OLD peak — rotation does NOT
    // auto-migrate per-caller bindings to the fresh session id.
    const aAfter = getCallerBinding(workspace, CALLER_A);
    expect(aAfter?.peakSessionId).toBe(SID_OLD);
  });
});

describe('Scenario: integration — caller-binding survives getSessionId rotation-decision', () => {
  it('G5.1: getSessionId returns the per-caller peakSessionId when both files exist (primary wins)', () => {
    // PEAKS_CALLER_ID must be set so resolveCallerProjection succeeds
    // (the adapter throws PEAKS_CALLER_NOT_RESOLVED otherwise, which
    // falls through to the session.json path).
    process.env.PEAKS_CALLER_ID = CALLER_A;
    seedCallerBinding(CALLER_A, SID_OLD, '2026-08-07T00:00:00.000Z');
    seedSessionJson(SID_OLD_B); // legacy points at a different id

    // Per-caller wins. The legacy file's id is NOT returned.
    expect(getSessionId(workspace)).toBe(SID_OLD);
  });

  it('G5.1b: getSessionId falls through to session.json when callerId cannot be resolved', () => {
    // PEAKS_CALLER_ID is unset; resolveCallerProjection throws
    // PEAKS_CALLER_NOT_RESOLVED → getSessionIdFromCallerBinding
    // returns null → falls through to readSessionFile.
    delete process.env.PEAKS_CALLER_ID;
    seedCallerBinding(CALLER_A, SID_OLD, '2026-08-07T00:00:00.000Z');
    seedSessionJson(SID_OLD_B);

    expect(getSessionId(workspace)).toBe(SID_OLD_B);
  });

  it('G5.2: getSessionMeta on the per-caller peak returns the outerSessionId stamped by the bridge', async () => {
    seedCallerBinding(CALLER_A, SID_OLD, '2026-08-07T00:00:00.000Z');
    seedSessionJson(SID_OLD);
    seedLegacySessionMeta(SID_OLD, 'outer-X');

    // Stamp via ensureSession so the bridge's setSessionMeta path runs.
    // PEAKS_OUTER_SESSION_ID is unset; ensureSession stamps ONLY when
    // an outer is resolved. Set one so the stamp fires.
    process.env.PEAKS_OUTER_SESSION_ID = 'outer-stamped-by-bridge';
    _resetLastResolvedOuterForTest();
    const sid = await ensureSession(workspace);
    expect(sid).toBe(SID_OLD);

    // getSessionMeta reads the per-session meta file; the bridge stamped
    // outerSessionId=outer-stamped-by-bridge on the call.
    const meta = getSessionMeta(workspace, SID_OLD);
    expect(meta?.outerSessionId).toBe('outer-stamped-by-bridge');
  });
});

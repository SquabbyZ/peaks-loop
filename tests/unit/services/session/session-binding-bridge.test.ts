/**
 * v2.18.0 — session-binding-bridge unit tests.
 *
 * Verifies the extracted bridge functions preserve the behavior of
 * the inlined versions in `session-manager.ts` (which re-exports
 * them). The existing `session-manager.test.ts` and
 * `session-rotation-on-outer-mismatch.test.ts` suites already
 * exercise both functions in depth; the targeted cases here
 * document the bridge as an independent unit (the 800-LOC extraction
 * promise) and provide fast smoke coverage for future regressions.
 *
 * Karpathy #3 (Surgical Changes) — the body of the moved functions
 * is unchanged. This file is a thin wrapper that drives the
 * re-exported surface and asserts the re-export shim still routes
 * to the bridge implementation.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  ensureSession,
  ensureSessionWithRotation
} from '../../../../src/services/session/session-binding-bridge.js';

// Re-import from the shim to verify the re-export contract
// (Karpathy #3: the 5 external callers must not need to change
// their import path).
import {
  ensureSession as ensureSessionViaShim,
  ensureSessionWithRotation as ensureSessionWithRotationViaShim
} from '../../../../src/services/session/session-manager.js';

const ORIGINAL_ENV = { ...process.env };

function createTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-bridge-test-'));
  mkdirSync(join(dir, '.peaks', '_runtime'), { recursive: true });
  return dir;
}

function clearOuterEnv(): void {
  delete process.env.PEAKS_OUTER_SESSION_ID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
}

let projectRoot: string;

beforeEach(() => {
  projectRoot = createTempProject();
  clearOuterEnv();
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  process.env = { ...ORIGINAL_ENV };
});

describe('session-binding-bridge — happy path', () => {
  test('ensureSession auto-creates a new session and writes the binding', async () => {
    const sessionId = await ensureSession(projectRoot);
    expect(sessionId).toMatch(/^\d{4}-\d{2}-\d{2}-session-[a-f0-9]{6}$/);

    // The project-level session binding file was written.
    const bindingFile = join(projectRoot, '.peaks', '_runtime', 'session.json');
    expect(existsSync(bindingFile)).toBe(true);
    const binding = JSON.parse(readFileSync(bindingFile, 'utf8')) as { sessionId: string; projectRoot: string };
    expect(binding.sessionId).toBe(sessionId);
    expect(binding.projectRoot).toBe(projectRoot);

    // The per-session meta file was written.
    const metaFile = join(projectRoot, '.peaks', '_runtime', sessionId, 'session.json');
    expect(existsSync(metaFile)).toBe(true);
    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as { sessionId: string; outerSessionId?: string };
    expect(meta.sessionId).toBe(sessionId);
    // outerSessionId absent (both env vars cleared in beforeEach).
    expect(meta.outerSessionId).toBeUndefined();
  });

  test('ensureSession returns the same id on subsequent calls (idempotent)', async () => {
    const first = await ensureSession(projectRoot);
    const second = await ensureSession(projectRoot);
    const third = await ensureSession(projectRoot);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  test('ensureSession stamps outerSessionId when env is set', async () => {
    process.env.PEAKS_OUTER_SESSION_ID = 'outer-sid-test-1';
    const sessionId = await ensureSession(projectRoot);
    const metaFile = join(projectRoot, '.peaks', '_runtime', sessionId, 'session.json');
    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as { outerSessionId?: string };
    expect(meta.outerSessionId).toBe('outer-sid-test-1');
  });

  test('ensureSessionWithRotation returns the bound session when no rotation is needed', async () => {
    process.env.PEAKS_OUTER_SESSION_ID = 'outer-stable';
    const first = await ensureSessionWithRotation(projectRoot);
    expect(first.rotationReason).toBeNull();
    expect(first.previousSessionId).toBeNull();
    expect(first.sessionId).toMatch(/^\d{4}-\d{2}-\d{2}-session-[a-f0-9]{6}$/);

    // Second call within the same outer-session → no rotation.
    const second = await ensureSessionWithRotation(projectRoot);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.rotationReason).toBeNull();
  });

  test('ensureSessionWithRotation auto-rolls on outer-session mismatch', async () => {
    // First call binds to outer A.
    process.env.PEAKS_OUTER_SESSION_ID = 'outer-A';
    const first = await ensureSessionWithRotation(projectRoot);
    expect(first.rotationReason).toBeNull();

    // Switch outer-session → next call must rotate.
    process.env.PEAKS_OUTER_SESSION_ID = 'outer-B';
    const second = await ensureSessionWithRotation(projectRoot);
    expect(second.rotationReason).toBe('outer-session-mismatch');
    expect(second.previousSessionId).toBe(first.sessionId);
    expect(second.sessionId).not.toBe(first.sessionId);
  });

  test('ensureSessionWithRotation skipRotateOnOuterMismatch suppresses rotation', async () => {
    process.env.PEAKS_OUTER_SESSION_ID = 'outer-A';
    const first = await ensureSessionWithRotation(projectRoot);
    expect(first.rotationReason).toBeNull();

    process.env.PEAKS_OUTER_SESSION_ID = 'outer-B';
    const second = await ensureSessionWithRotation(projectRoot, { skipRotateOnOuterMismatch: true });
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.rotationReason).toBeNull();
    expect(second.previousSessionId).toBeNull();
  });
});

describe('session-binding-bridge — re-export shim contract', () => {
  test('the re-exported ensureSession is the same function as the bridge one (identity)', () => {
    // Karpathy #3 — surgical. The shim MUST be a passthrough re-export,
    // not a wrapper. Reference identity is the strongest contract.
    expect(ensureSessionViaShim).toBe(ensureSession);
  });

  test('the re-exported ensureSessionWithRotation is the same function as the bridge one (identity)', () => {
    expect(ensureSessionWithRotationViaShim).toBe(ensureSessionWithRotation);
  });

  test('EnsureSessionOptions / EnsureSessionResult types resolve through the shim', async () => {
    // This is a type-level assertion compiled at tsc time. The runtime
    // check below verifies the result shape matches the re-exported type.
    process.env.PEAKS_OUTER_SESSION_ID = 'outer-shim-test';
    const result: {
      sessionId: string;
      previousSessionId: string | null;
      rotationReason: 'outer-session-mismatch' | null;
    } = await ensureSessionWithRotationViaShim(projectRoot);
    expect(result.sessionId).toMatch(/^\d{4}-\d{2}-\d{2}-session-[a-f0-9]{6}$/);
    expect(result.previousSessionId).toBeNull();
    expect(result.rotationReason).toBeNull();
  });
});

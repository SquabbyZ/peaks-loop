/**
 * Slice 018 — auto-roll session on outer-session mismatch.
 *
 * Verifies the new `ensureSessionWithRotation` wrapper around
 * `ensureSession`. The wrapper is the CLI's entry point for
 * `peaks workspace init` (slice 008 added `rotateSessionBinding`;
 * slice 018 adds the auto-roll decision on top of it).
 *
 * Test cases map 1:1 to PRD acceptance criteria 1–7 (the 7 positive
 * cases) plus 2 negative cases (no binding at all; rotation is
 * idempotent). Each case is a real-fs test in its own temp dir so
 * the test does not depend on prior state.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { ensureSession, ensureSessionWithRotation, getSessionId } from '../../../../src/services/session/session-manager.js';

const ORIGINAL_ENV = { ...process.env };

function createTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-slice-018-'));
  mkdirSync(join(dir, '.peaks', '_runtime'), { recursive: true });
  return dir;
}

function writeCanonicalBinding(projectRoot: string, sessionId: string, outerSessionId?: string): void {
  // The BINDING file (.peaks/_runtime/session.json) records the active session id.
  const bindingFile = join(projectRoot, '.peaks', '_runtime', 'session.json');
  const bindingBody = {
    sessionId,
    projectRoot,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };
  writeFileSync(bindingFile, JSON.stringify(bindingBody, null, 2), 'utf8');

  // The PER-SESSION META file (.peaks/_runtime/<sid>/session.json) holds
  // session-scoped metadata including the outerSessionId at-creation-time.
  // ensureSessionWithRotation reads the outerSessionId from THIS file, not
  // the binding file. Sessions predating the field simply omit it.
  const metaDir = join(projectRoot, '.peaks', '_runtime', sessionId);
  mkdirSync(metaDir, { recursive: true });
  const metaFile = join(metaDir, 'session.json');
  const metaBody = {
    sessionId,
    projectRoot,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    ...(outerSessionId !== undefined ? { outerSessionId } : {}),
  };
  writeFileSync(metaFile, JSON.stringify(metaBody, null, 2), 'utf8');
}

function setOuterEnv(value: string | undefined): void {
  delete process.env.PEAKS_OUTER_SESSION_ID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  if (value !== undefined) {
    process.env.PEAKS_OUTER_SESSION_ID = value;
  }
}

function clearOuterEnv(): void {
  delete process.env.PEAKS_OUTER_SESSION_ID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
}

beforeEach(() => {
  // Defensive: ensure no leaked env from the parent shell.
  clearOuterEnv();
});

afterEach(() => {
  // Restore the parent shell's env so the test does not pollute the host.
  process.env = { ...ORIGINAL_ENV };
});

describe('ensureSessionWithRotation — slice 018 auto-roll on outer-session mismatch', () => {
  describe('AC1 — rotation fires on outer mismatch', () => {
    test('rotates when the bound session has a recorded outerSessionId and the current outer id differs', async () => {
      const root = createTempProject();
      writeCanonicalBinding(root, '2026-06-07-session-oldaaa', 'old-outer-uuid');
      setOuterEnv('new-outer-uuid');

      const result = await ensureSessionWithRotation(root);

      expect(result.previousSessionId).toBe('2026-06-07-session-oldaaa');
      expect(result.rotationReason).toBe('outer-session-mismatch');
      expect(result.sessionId).not.toBe('2026-06-07-session-oldaaa');
      expect(result.sessionId).toMatch(/^2026-\d{2}-\d{2}-session-[a-z0-9]{6}$/);
    });
  });

  describe('AC2 — old session dir preserved on disk', () => {
    test('the rotated-out session directory is NOT deleted; it survives on disk', async () => {
      const root = createTempProject();
      const oldSid = '2026-06-07-session-presev';
      writeCanonicalBinding(root, oldSid, 'old-outer-uuid');
      // Pre-populate the old session dir with a marker file so we can assert
      // it survives the rotation.
      const oldDir = join(root, '.peaks', '_runtime', oldSid);
      mkdirSync(oldDir, { recursive: true });
      writeFileSync(join(oldDir, 'prd-marker.txt'), 'do-not-delete', 'utf8');

      setOuterEnv('new-outer-uuid');
      const result = await ensureSessionWithRotation(root);

      expect(result.rotationReason).toBe('outer-session-mismatch');
      // Old session dir is still on disk
      expect(existsSync(oldDir)).toBe(true);
      // Old marker file is intact
      expect(readFileSync(join(oldDir, 'prd-marker.txt'), 'utf8')).toBe('do-not-delete');
      // New session dir exists (created by ensureSession)
      const newDir = join(root, '.peaks', '_runtime', result.sessionId);
      expect(existsSync(newDir)).toBe(true);
    });
  });

  describe('AC3 — --no-rotate-on-outer-mismatch opt-out', () => {
    test('skipRotateOnOuterMismatch: true preserves the existing binding even when the outer id differs', async () => {
      const root = createTempProject();
      const oldSid = '2026-06-07-session-optout';
      writeCanonicalBinding(root, oldSid, 'old-outer-uuid');
      setOuterEnv('new-outer-uuid');

      const result = await ensureSessionWithRotation(root, { skipRotateOnOuterMismatch: true });

      expect(result.previousSessionId).toBeNull();
      expect(result.rotationReason).toBeNull();
      expect(result.sessionId).toBe(oldSid);
      // The canonical binding file still points to the old session.
      expect(getSessionId(root)).toBe(oldSid);
    });
  });

  describe('AC4 — legacy session (no recorded outer id) is NOT rotated', () => {
    test('bound session with no outerSessionId field → no rotation even when current outer differs', async () => {
      const root = createTempProject();
      const oldSid = '2026-06-05-session-legac';
      // No outerSessionId in the binding (legacy pre-contract data).
      writeCanonicalBinding(root, oldSid);
      setOuterEnv('brand-new-outer-uuid');

      const result = await ensureSessionWithRotation(root);

      expect(result.previousSessionId).toBeNull();
      expect(result.rotationReason).toBeNull();
      expect(result.sessionId).toBe(oldSid);
    });
  });

  describe('AC5 — no env vars set → no rotation', () => {
    test('no PEAKS_OUTER_SESSION_ID and no CLAUDE_CODE_SESSION_ID → no rotation, no false positive', async () => {
      const root = createTempProject();
      const oldSid = '2026-06-07-session-noenvv';
      writeCanonicalBinding(root, oldSid, 'some-old-outer');
      clearOuterEnv();

      const result = await ensureSessionWithRotation(root);

      expect(result.previousSessionId).toBeNull();
      expect(result.rotationReason).toBeNull();
      expect(result.sessionId).toBe(oldSid);
    });
  });

  describe('AC6 — same outer session (reconnect) → no rotation', () => {
    test('outer id matches the bound session\'s recorded outer id → preserve binding (regression guard)', async () => {
      const root = createTempProject();
      const sid = '2026-06-07-session-reconn';
      writeCanonicalBinding(root, sid, 'same-outer-uuid');
      setOuterEnv('same-outer-uuid');

      const result = await ensureSessionWithRotation(root);

      expect(result.previousSessionId).toBeNull();
      expect(result.rotationReason).toBeNull();
      expect(result.sessionId).toBe(sid);
    });
  });

  describe('AC7 — legacy binding cleanup on rotation', () => {
    test('a pre-`peaks-runtime-layer` legacy `.peaks/.session.json` is also unlinked on rotation', async () => {
      const root = createTempProject();
      const sid = '2026-06-07-session-legacy';
      // Canonical binding (new) + a stale legacy binding (old).
      writeCanonicalBinding(root, sid, 'old-outer-uuid');
      const legacy = join(root, '.peaks', '.session.json');
      writeFileSync(legacy, JSON.stringify({ sessionId: sid, projectRoot: root, createdAt: new Date().toISOString() }, null, 2), 'utf8');
      setOuterEnv('new-outer-uuid');

      const result = await ensureSessionWithRotation(root);

      expect(result.rotationReason).toBe('outer-session-mismatch');
      expect(result.previousSessionId).toBe(sid);
      // Legacy file is unlinked (no zombie binding can resurrect the old session).
      expect(existsSync(legacy)).toBe(false);
    });
  });

  describe('Negative — no binding at all', () => {
    test('first run: no canonical binding present → ensureSession creates one, no rotation', async () => {
      const root = createTempProject();
      // Intentionally do not write a binding. The wrapper delegates to
      // ensureSession, which auto-generates a fresh id.
      setOuterEnv('some-outer-uuid');

      const result = await ensureSessionWithRotation(root);

      expect(result.previousSessionId).toBeNull();
      expect(result.rotationReason).toBeNull();
      expect(result.sessionId).toMatch(/^2026-\d{2}-\d{2}-session-[a-z0-9]{6}$/);
    });
  });

  describe('Negative — rotation is idempotent when run twice', () => {
    test('second call after the rotation sees the new binding, not the old one', async () => {
      const root = createTempProject();
      const oldSid = '2026-06-07-session-idempo';
      writeCanonicalBinding(root, oldSid, 'old-outer-uuid');
      setOuterEnv('new-outer-uuid');

      const first = await ensureSessionWithRotation(root);
      expect(first.rotationReason).toBe('outer-session-mismatch');
      expect(first.previousSessionId).toBe(oldSid);

      // Second call: the canonical binding now points to the NEW session,
      // which was created with the current outer id. No rotation.
      const second = await ensureSessionWithRotation(root);
      expect(second.rotationReason).toBeNull();
      expect(second.previousSessionId).toBeNull();
      expect(second.sessionId).toBe(first.sessionId);
    });
  });

  describe('Public surface preservation', () => {
    test('ensureSession (the pre-slice entry point) is unchanged: no rotation, no env reading, no behavior change', async () => {
      const root = createTempProject();
      const oldSid = '2026-06-07-session-rawww';
      writeCanonicalBinding(root, oldSid, 'old-outer-uuid');
      setOuterEnv('new-outer-uuid');

      // The bare ensureSession (no wrapper) MUST NOT rotate. The CLI surface
      // is the only thing that opts into rotation via ensureSessionWithRotation.
      const sessionId = await ensureSession(root);
      expect(sessionId).toBe(oldSid);
    });
  });
});

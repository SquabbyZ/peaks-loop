import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ensureSession,
  getSessionId,
  getCurrentSessionDir,
  listSessions,
  getProjectScanPath,
  hasProjectScan,
} from '../../src/services/session/session-manager.js';

describe('session-manager', () => {
  let testProjectRoot: string;

  beforeEach(() => {
    testProjectRoot = join(tmpdir(), `test-project-${Date.now()}`);
    mkdirSync(testProjectRoot, { recursive: true });
    mkdirSync(join(testProjectRoot, '.peaks'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testProjectRoot)) {
      rmSync(testProjectRoot, { recursive: true, force: true });
    }
  });

  describe('ensureSession', () => {
    test('creates new session when none exists', async () => {
      const sessionId = await ensureSession(testProjectRoot);

      expect(sessionId).toMatch(/^\d{4}-\d{2}-\d{2}-session-[a-f0-9]{6}$/);

      const sessionFile = join(testProjectRoot, '.peaks', '.session.json');
      expect(existsSync(sessionFile)).toBe(true);

      const sessionDir = join(testProjectRoot, '.peaks', sessionId);
      expect(existsSync(sessionDir)).toBe(true);
    });

    test('returns existing session if valid', async () => {
      const sessionId1 = await ensureSession(testProjectRoot);
      const sessionId2 = await ensureSession(testProjectRoot);

      expect(sessionId1).toBe(sessionId2);
    });

    test('creates session directory structure', async () => {
      const sessionId = await ensureSession(testProjectRoot);
      const sessionDir = join(testProjectRoot, '.peaks', sessionId);

      expect(existsSync(join(sessionDir, 'prd'))).toBe(true);
      expect(existsSync(join(sessionDir, 'rd'))).toBe(true);
      expect(existsSync(join(sessionDir, 'qa'))).toBe(true);
      expect(existsSync(join(sessionDir, 'sc'))).toBe(true);
      expect(existsSync(join(sessionDir, 'txt'))).toBe(true);
      expect(existsSync(join(sessionDir, 'ui'))).toBe(true);
    });
  });

  describe('getSessionId', () => {


    test('creates .peaks directory when it does not exist', async () => {
      const noPeaksDir = join(tmpdir(), 'test-no-peaks-' + Date.now());
      mkdirSync(noPeaksDir, { recursive: true });
      try {
        const sid = await ensureSession(noPeaksDir);
        expect(sid).toMatch(/^\d{4}-\d{2}-\d{2}-session-[a-f0-9]{6}$/);
        expect(existsSync(join(noPeaksDir, '.peaks'))).toBe(true);
        expect(existsSync(join(noPeaksDir, '.peaks', '.session.json'))).toBe(true);
      } finally {
        rmSync(noPeaksDir, { recursive: true, force: true });
      }
    });
    test('handles corrupt session file by overwriting it', async () => {
      writeFileSync(join(testProjectRoot, '.peaks', '.session.json'), '{corrupt', 'utf8');
      const sid = await ensureSession(testProjectRoot);
      expect(sid).toMatch(/^\d{4}-\d{2}-\d{2}-session-[a-f0-9]{6}$/);
    });

    test('handles session file with mismatched projectRoot by overwriting it', async () => {
      writeFileSync(join(testProjectRoot, '.peaks', '.session.json'), JSON.stringify({
        sessionId: '2026-01-01-session-oldval',
        projectRoot: '/wrong/path',
        createdAt: '2026-01-01T00:00:00Z'
      }), 'utf8');
      const sid = await ensureSession(testProjectRoot);
      expect(sid).not.toBe('2026-01-01-session-oldval');
      expect(sid).toMatch(/^\d{4}-\d{2}-\d{2}-session-[a-f0-9]{6}$/);
    });
    test('returns null when no session exists', () => {
      expect(getSessionId(testProjectRoot)).toBeNull();
    });

    test('returns session id after creation', async () => {
      await ensureSession(testProjectRoot);
      const sessionId = getSessionId(testProjectRoot);

      expect(sessionId).not.toBeNull();
      expect(sessionId).toMatch(/^\d{4}-\d{2}-\d{2}-session-[a-f0-9]{6}$/);
    });
  });

  describe('getCurrentSessionDir', () => {
    test('returns absolute path to session directory', async () => {
      const sessionDir = await getCurrentSessionDir(testProjectRoot);

      expect(sessionDir).toContain(testProjectRoot);
      expect(sessionDir).toContain('.peaks');
      expect(existsSync(sessionDir)).toBe(true);
    });
  });

  describe('listSessions', () => {
    test('returns empty array when no sessions exist', () => {
      expect(listSessions(testProjectRoot)).toEqual([]);
    });

    test('lists existing sessions', async () => {
      await ensureSession(testProjectRoot);
      const sessions = listSessions(testProjectRoot);

      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatch(/^\d{4}-\d{2}-\d{2}-session-[a-f0-9]{6}$/);
    });

    test('returns empty array when .peaks directory does not exist', () => {
      const noPeaks = join(tmpdir(), 'test-no-peaks-list-' + Date.now());
      mkdirSync(noPeaks, { recursive: true });
      try {
        expect(listSessions(noPeaks)).toEqual([]);
      } finally {
        rmSync(noPeaks, { recursive: true, force: true });
      }
    });

    test('ignores non-session directories', async () => {
      await ensureSession(testProjectRoot);
      mkdirSync(join(testProjectRoot, '.peaks', 'old-session-dir'));
      mkdirSync(join(testProjectRoot, '.peaks', 'not-a-session'));

      const sessions = listSessions(testProjectRoot);
      expect(sessions).toHaveLength(1);
    });
  });

  describe('getProjectScanPath', () => {
    test('returns path to project-scan.md in session', async () => {
      const scanPath = await getProjectScanPath(testProjectRoot);

      expect(scanPath).toContain('project-scan.md');
      expect(scanPath).toContain('.peaks');
      expect(existsSync(join(scanPath, '..'))).toBe(true);
    });
  });

  describe('hasProjectScan', () => {
    test('returns false when no session exists', () => {
      expect(hasProjectScan(testProjectRoot)).toBe(false);
    });

    test('returns false when project-scan.md does not exist', async () => {
      await ensureSession(testProjectRoot);
      expect(hasProjectScan(testProjectRoot)).toBe(false);
    });

    test('returns true when project-scan.md exists', async () => {
      const sessionId = await ensureSession(testProjectRoot);
      const scanPath = join(testProjectRoot, '.peaks', sessionId, 'rd', 'project-scan.md');
      const { writeFileSync } = require('node:fs');
      writeFileSync(scanPath, '# Project Scan', 'utf8');

      expect(hasProjectScan(testProjectRoot)).toBe(true);
    });
  });
});

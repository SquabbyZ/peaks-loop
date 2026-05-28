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

  describe('session metadata', () => {
    let getSessionMeta: typeof import('../../src/services/session/session-manager.js').getSessionMeta;
    let setSessionMeta: typeof import('../../src/services/session/session-manager.js').setSessionMeta;
    let setSessionTitle: typeof import('../../src/services/session/session-manager.js').setSessionTitle;
    let listSessionMetas: typeof import('../../src/services/session/session-manager.js').listSessionMetas;

    beforeEach(async () => {
      const mod = await import('../../src/services/session/session-manager.js');
      getSessionMeta = mod.getSessionMeta;
      setSessionMeta = mod.setSessionMeta;
      setSessionTitle = mod.setSessionTitle;
      listSessionMetas = mod.listSessionMetas;
    });

    test('ensureSession writes initial session.json into session dir', async () => {
      const sessionId = await ensureSession(testProjectRoot);
      const metaPath = join(testProjectRoot, '.peaks', sessionId, 'session.json');

      expect(existsSync(metaPath)).toBe(true);
      const raw = JSON.parse(readFileSync(metaPath, 'utf8'));
      expect(raw.sessionId).toBe(sessionId);
      expect(raw.projectRoot).toBe(testProjectRoot);
      expect(raw.createdAt).toBeTruthy();
    });

    test('getSessionMeta returns null for unknown sessionId', () => {
      expect(getSessionMeta(testProjectRoot, '2026-01-01-session-000000')).toBeNull();
    });

    test('getSessionMeta reads existing metadata', async () => {
      const sessionId = await ensureSession(testProjectRoot);
      const meta = getSessionMeta(testProjectRoot, sessionId);

      expect(meta).not.toBeNull();
      expect(meta!.sessionId).toBe(sessionId);
    });

    test('setSessionTitle writes title into session.json', async () => {
      const sessionId = await ensureSession(testProjectRoot);
      const result = setSessionTitle(testProjectRoot, sessionId, '修复登录页OAuth回调异常');

      expect(result.title).toBe('修复登录页OAuth回调异常');
      expect(result.sessionId).toBe(sessionId);

      const metaPath = join(testProjectRoot, '.peaks', sessionId, 'session.json');
      const raw = JSON.parse(readFileSync(metaPath, 'utf8'));
      expect(raw.title).toBe('修复登录页OAuth回调异常');
    });

    test('setSessionMeta does partial update (preserves existing fields)', async () => {
      const sessionId = await ensureSession(testProjectRoot);
      setSessionTitle(testProjectRoot, sessionId, '原始标题');

      setSessionMeta(testProjectRoot, sessionId, { skill: 'peaks-solo', mode: 'full-auto' });

      const meta = getSessionMeta(testProjectRoot, sessionId);
      expect(meta).not.toBeNull();
      expect(meta!.title).toBe('原始标题');
      expect(meta!.skill).toBe('peaks-solo');
      expect(meta!.mode).toBe('full-auto');
      expect(meta!.lastActivity).toBeTruthy();
    });

    test('setSessionTitle creates meta if session dir exists but no meta file', () => {
      const sessionId = '2026-05-28-session-create01';
      mkdirSync(join(testProjectRoot, '.peaks', sessionId), { recursive: true });

      const result = setSessionTitle(testProjectRoot, sessionId, '新建标题');

      expect(result.title).toBe('新建标题');
      expect(result.sessionId).toBe(sessionId);
      expect(result.createdAt).toBeTruthy();
    });

    test('listSessionMetas returns all sessions with metadata', async () => {
      await ensureSession(testProjectRoot);

      const sid2 = '2026-05-28-session-abcdef';
      mkdirSync(join(testProjectRoot, '.peaks', sid2), { recursive: true });
      setSessionTitle(testProjectRoot, sid2, '第二个会话');

      const metas = listSessionMetas(testProjectRoot);
      expect(metas.length).toBeGreaterThanOrEqual(2);

      const withTitle = metas.find((m) => m.sessionId === sid2);
      expect(withTitle).toBeDefined();
      expect(withTitle!.title).toBe('第二个会话');
    });

    test('listSessionMetas returns empty array when no .peaks dir', () => {
      const noPeaks = join(tmpdir(), 'test-no-metas-' + Date.now());
      mkdirSync(noPeaks, { recursive: true });
      try {
        expect(listSessionMetas(noPeaks)).toEqual([]);
      } finally {
        rmSync(noPeaks, { recursive: true, force: true });
      }
    });

    test('getSessionMeta returns null for corrupt session.json', () => {
      const sessionId = '2026-05-28-session-corrupt';
      mkdirSync(join(testProjectRoot, '.peaks', sessionId), { recursive: true });
      writeFileSync(join(testProjectRoot, '.peaks', sessionId, 'session.json'), '{broken', 'utf8');

      expect(getSessionMeta(testProjectRoot, sessionId)).toBeNull();
    });

    test('getSessionMeta returns null for session.json with empty sessionId', () => {
      const sessionId = '2026-05-28-session-empty';
      mkdirSync(join(testProjectRoot, '.peaks', sessionId), { recursive: true });
      writeFileSync(join(testProjectRoot, '.peaks', sessionId, 'session.json'), JSON.stringify({ sessionId: '' }), 'utf8');

      expect(getSessionMeta(testProjectRoot, sessionId)).toBeNull();
    });

    test('listSessionMetas returns default meta for session dir without session.json', () => {
      const sessionId = '2026-05-28-session-a1b2c3';
      mkdirSync(join(testProjectRoot, '.peaks', sessionId), { recursive: true });

      const metas = listSessionMetas(testProjectRoot);
      const found = metas.find((m) => m.sessionId === sessionId);
      expect(found).toBeDefined();
      expect(found!.createdAt).toBe('');
    });
  });
});

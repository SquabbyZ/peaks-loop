import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test, vi, afterEach } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const unlinkSyncMock = vi.fn((...args: Parameters<typeof actual.unlinkSync>) => actual.unlinkSync(...args));
  return { ...actual, unlinkSync: unlinkSyncMock };
});

import { setSkillPresence, getSkillPresence, clearSkillPresence, exportSkillPresence, touchSkillHeartbeat } from '../../src/services/skills/skill-presence-service.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-skill-presence-'));
}

function writeSessionFile(root: string, sessionId: string): void {
  const peaksDir = join(root, '.peaks');
  if (!existsSync(peaksDir)) {
    mkdirSync(peaksDir, { recursive: true });
  }
  writeFileSync(join(peaksDir, '.session.json'), JSON.stringify({
    sessionId,
    createdAt: new Date().toISOString(),
    projectRoot: root
  }), 'utf8');
}

describe('skill presence service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('exportSkillPresence', () => {
    test('returns the resolved path to the presence file', () => {
      const cwd = '/fake/project';
      vi.spyOn(process, 'cwd').mockReturnValue(cwd);

      const result = exportSkillPresence();

      expect(result).toBe(resolve(cwd, '.peaks/.active-skill.json'));
    });
  });

  describe('setSkillPresence', () => {
    test('writes presence file and returns the presence object', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);

        const presence = setSkillPresence('peaks-solo', 'assisted', 'doctor');

        expect(presence.skill).toBe('peaks-solo');
        expect(presence.mode).toBe('assisted');
        expect(presence.gate).toBe('doctor');
        expect(presence.setAt).toBeTruthy();

        const filePath = join(root, '.peaks', '.active-skill.json');
        expect(existsSync(filePath)).toBe(true);
        const raw = JSON.parse(readFileSync(filePath, 'utf8'));
        expect(raw.skill).toBe('peaks-solo');
        expect(raw.mode).toBe('assisted');
        expect(raw.gate).toBe('doctor');
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('writes presence file without optional mode and gate', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);

        const presence = setSkillPresence('peaks-rd');

        expect(presence.skill).toBe('peaks-rd');
        expect(presence.mode).toBeUndefined();
        expect(presence.gate).toBeUndefined();

        const filePath = join(root, '.peaks', '.active-skill.json');
        const raw = JSON.parse(readFileSync(filePath, 'utf8'));
        expect(raw.mode).toBeUndefined();
        expect(raw.gate).toBeUndefined();
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('creates the .peaks directory when it does not exist', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);

        const peaksDir = join(root, '.peaks');
        expect(existsSync(peaksDir)).toBe(false);

        setSkillPresence('peaks-qa');

        expect(existsSync(peaksDir)).toBe(true);
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('bootstraps .peaks/memory/ + full-shape empty index.json on first skill activation', () => {
      // Stock project cold start: a fresh dir with no .peaks at all. After
      // the very first peaks skill call, the memory directory and a
      // well-formed empty index must be on disk so subsequent
      // `peaks project memories` reads return a stable result.
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);

        const memoryDir = join(root, '.peaks', 'memory');
        const indexPath = join(memoryDir, 'index.json');
        expect(existsSync(memoryDir)).toBe(false);

        setSkillPresence('peaks-solo', 'full-auto', 'startup');

        expect(existsSync(memoryDir)).toBe(true);
        expect(existsSync(indexPath)).toBe(true);

        const raw = JSON.parse(readFileSync(indexPath, 'utf8'));
        expect(raw.version).toBe(1);
        expect(typeof raw.updatedAt).toBe('string');
        expect(raw.hot).toBeDefined();
        expect(raw.warm).toBeDefined();
        // every kind bucket must be present and empty, not missing
        for (const kind of ['feedback', 'decision', 'rule', 'convention', 'module']) {
          expect(Array.isArray(raw.hot[kind])).toBe(true);
          expect(raw.hot[kind]).toHaveLength(0);
        }
        for (const kind of ['project', 'reference']) {
          expect(Array.isArray(raw.warm[kind])).toBe(true);
          expect(raw.warm[kind]).toHaveLength(0);
        }
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('does NOT overwrite an existing memory index.json', () => {
      // If the user already has a populated index, presence must not stomp
      // it. We pre-write a hand-crafted index, call setSkillPresence, and
      // assert the file content is byte-equal.
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);

        const memoryDir = join(root, '.peaks', 'memory');
        const indexPath = join(memoryDir, 'index.json');
        mkdirSync(memoryDir, { recursive: true });
        const handCrafted = {
          version: 1,
          updatedAt: '2026-06-01T17:11:22.024Z',
          hot: { feedback: [{ name: 'preserve-me', kind: 'feedback', description: 'do not stomp', sourcePath: '/x', sourceArtifact: null, updatedAt: '2026-06-01' }], decision: [], rule: [], convention: [], module: [] },
          warm: { project: [], reference: [] }
        };
        writeFileSync(indexPath, JSON.stringify(handCrafted, null, 2), 'utf8');

        setSkillPresence('peaks-rd', 'assisted', 'spec-locked');

        const after = JSON.parse(readFileSync(indexPath, 'utf8'));
        expect(after.hot.feedback).toHaveLength(1);
        expect(after.hot.feedback[0].name).toBe('preserve-me');
        expect(after.updatedAt).toBe('2026-06-01T17:11:22.024Z');
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('stores sessionId when .peaks/.session.json exists', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        writeSessionFile(root, '2026-05-28-session-test01');

        const presence = setSkillPresence('peaks-solo', 'full-auto', 'startup');

        expect(presence.sessionId).toBe('2026-05-28-session-test01');

        const filePath = join(root, '.peaks', '.active-skill.json');
        const raw = JSON.parse(readFileSync(filePath, 'utf8'));
        expect(raw.sessionId).toBe('2026-05-28-session-test01');
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('does not store sessionId when no session file exists', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);

        const presence = setSkillPresence('peaks-solo', 'full-auto', 'startup');

        expect(presence.sessionId).toBeUndefined();
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('stamps claudeSessionId from CLAUDE_CODE_SESSION_ID env', () => {
      const root = createTempDir();
      const prev = process.env.CLAUDE_CODE_SESSION_ID;
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        process.env.CLAUDE_CODE_SESSION_ID = 'claude-session-abc';

        const presence = setSkillPresence('peaks-solo', 'full-auto', 'startup', root);

        expect(presence.claudeSessionId).toBe('claude-session-abc');
        const raw = JSON.parse(readFileSync(join(root, '.peaks', '.active-skill.json'), 'utf8'));
        expect(raw.claudeSessionId).toBe('claude-session-abc');
      } finally {
        if (prev === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
        else process.env.CLAUDE_CODE_SESSION_ID = prev;
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('omits claudeSessionId when CLAUDE_CODE_SESSION_ID env is absent', () => {
      const root = createTempDir();
      const prev = process.env.CLAUDE_CODE_SESSION_ID;
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        delete process.env.CLAUDE_CODE_SESSION_ID;

        const presence = setSkillPresence('peaks-solo', 'full-auto', 'startup', root);

        expect(presence.claudeSessionId).toBeUndefined();
      } finally {
        if (prev === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
        else process.env.CLAUDE_CODE_SESSION_ID = prev;
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('getSkillPresence', () => {
    test('returns null when presence file does not exist', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);

        const result = getSkillPresence();

        expect(result).toBeNull();
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('returns presence when a valid file exists', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        setSkillPresence('peaks-ui', undefined, 'validation');

        const result = getSkillPresence();

        expect(result).not.toBeNull();
        expect(result!.skill).toBe('peaks-ui');
        expect(result!.mode).toBeUndefined();
        expect(result!.gate).toBe('validation');
        expect(result!.setAt).toBeTruthy();
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('returns null when file contains invalid JSON', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const peaksDir = join(root, '.peaks');
        mkdirSync(peaksDir, { recursive: true });
        writeFileSync(join(peaksDir, '.active-skill.json'), 'not-json', 'utf8');

        const result = getSkillPresence();

        expect(result).toBeNull();
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('returns null when file has missing skill field', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const peaksDir = join(root, '.peaks');
        mkdirSync(peaksDir, { recursive: true });
        writeFileSync(join(peaksDir, '.active-skill.json'), JSON.stringify({ mode: 'x' }), 'utf8');

        const result = getSkillPresence();

        expect(result).toBeNull();
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('returns null when skill field is empty string', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const peaksDir = join(root, '.peaks');
        mkdirSync(peaksDir, { recursive: true });
        writeFileSync(join(peaksDir, '.active-skill.json'), JSON.stringify({ skill: '' }), 'utf8');

        const result = getSkillPresence();

        expect(result).toBeNull();
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('returns presence when sessionId matches current session', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        writeSessionFile(root, '2026-05-28-session-match');
        setSkillPresence('peaks-solo', 'full-auto', 'startup');

        const result = getSkillPresence();

        expect(result).not.toBeNull();
        expect(result!.skill).toBe('peaks-solo');
        expect(result!.mode).toBe('full-auto');
        expect(result!.sessionId).toBe('2026-05-28-session-match');
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('returns null and clears file when presence sessionId differs from current session', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        // Set up presence with session A
        writeSessionFile(root, '2026-05-28-session-old');
        setSkillPresence('peaks-solo', 'full-auto', 'startup');

        const presencePath = join(root, '.peaks', '.active-skill.json');
        expect(existsSync(presencePath)).toBe(true);

        // Simulate new session B: overwrite .session.json
        writeSessionFile(root, '2026-05-28-session-new');

        const result = getSkillPresence();

        expect(result).toBeNull();
        // Stale presence file should be deleted
        expect(existsSync(presencePath)).toBe(false);
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('returns presence normally when presence has no sessionId (backward compat)', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        // Write presence manually without sessionId
        const peaksDir = join(root, '.peaks');
        mkdirSync(peaksDir, { recursive: true });
        writeFileSync(join(peaksDir, '.active-skill.json'), JSON.stringify({
          skill: 'peaks-solo',
          mode: 'assisted',
          setAt: new Date().toISOString()
        }), 'utf8');

        const result = getSkillPresence();

        expect(result).not.toBeNull();
        expect(result!.skill).toBe('peaks-solo');
        expect(result!.mode).toBe('assisted');
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('clearSkillPresence', () => {
    test('returns false when presence file does not exist', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);

        const result = clearSkillPresence();

        expect(result).toBe(false);
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('removes the file and returns true when file exists', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        setSkillPresence('peaks-sc');

        const filePath = join(root, '.peaks', '.active-skill.json');
        expect(existsSync(filePath)).toBe(true);

        const result = clearSkillPresence();

        expect(result).toBe(true);
        expect(existsSync(filePath)).toBe(false);
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('returns false when unlink fails', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        setSkillPresence('peaks-sc');

        vi.mocked(unlinkSync).mockImplementationOnce(() => {
          throw new Error('permission denied');
        });

        const result = clearSkillPresence();

        expect(result).toBe(false);
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('touchSkillHeartbeat', () => {
    test('returns null when presence file does not exist', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);

        const result = touchSkillHeartbeat();

        expect(result).toBeNull();
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('updates lastHeartbeat when presence file exists', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const presence = setSkillPresence('peaks-solo', 'full-auto', 'startup');
        const originalHeartbeat = presence.lastHeartbeat!;

        // Wait a tiny bit so timestamps differ
        const start = Date.now();
        while (Date.now() - start < 10) { /* busy-wait for distinct timestamp */ }

        const updated = touchSkillHeartbeat();

        expect(updated).not.toBeNull();
        expect(updated!.skill).toBe('peaks-solo');
        expect(updated!.lastHeartbeat).not.toBe(originalHeartbeat);
        // Verify the file was actually updated
        const filePath = join(root, '.peaks', '.active-skill.json');
        const raw = JSON.parse(readFileSync(filePath, 'utf8'));
        expect(raw.lastHeartbeat).toBe(updated!.lastHeartbeat);
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('heartbeat lifecycle: set → touch → clear → touch returns null', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);

        // Set presence → heartbeat initialized
        const p1 = setSkillPresence('peaks-solo');
        expect(p1.lastHeartbeat).toBeDefined();

        // Touch heartbeat → updated
        const p2 = touchSkillHeartbeat();
        expect(p2).not.toBeNull();

        // Clear presence
        clearSkillPresence();

        // Touch after clear → null (no presence file)
        const p3 = touchSkillHeartbeat();
        expect(p3).toBeNull();
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('touch returns null and clears file when presence sessionId differs from current session', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        writeSessionFile(root, '2026-05-28-session-old');
        setSkillPresence('peaks-solo', 'full-auto', 'startup');

        const presencePath = join(root, '.peaks', '.active-skill.json');
        expect(existsSync(presencePath)).toBe(true);

        // Simulate new session
        writeSessionFile(root, '2026-05-28-session-new');

        const result = touchSkillHeartbeat();

        expect(result).toBeNull();
        expect(existsSync(presencePath)).toBe(false);
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('touch works when sessionId matches current session', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        writeSessionFile(root, '2026-05-28-session-match');
        setSkillPresence('peaks-solo', 'full-auto', 'startup');

        const result = touchSkillHeartbeat();

        expect(result).not.toBeNull();
        expect(result!.skill).toBe('peaks-solo');
        expect(result!.sessionId).toBe('2026-05-28-session-match');
        expect(result!.lastHeartbeat).toBeTruthy();
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('exit flow lifecycle (set → header → clear → exit message)', () => {
    test('full peaks-solo exit lifecycle: presence set, header displayed, presence cleared, header removed', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);

        // Step 1: peaks-solo workflow enters — set presence
        const step1 = setSkillPresence('peaks-solo', 'full-auto', 'startup');
        expect(step1.skill).toBe('peaks-solo');
        expect(step1.mode).toBe('full-auto');
        expect(step1.gate).toBe('startup');

        // Step 2: CLAUDE.md reads presence — header is displayed
        const step2 = getSkillPresence();
        expect(step2).not.toBeNull();
        expect(step2!.skill).toBe('peaks-solo');
        // At this point, CLAUDE.md shows:
        // "Peaks-Cli Skill: peaks-solo | Peaks-Cli Gate: startup | Next: ..."

        // Step 3: Workflow completes — peaks skill presence:clear
        const step3 = clearSkillPresence();
        expect(step3).toBe(true);

        // Step 4: CLAUDE.md reads presence again — file is gone, no header
        const step4 = getSkillPresence();
        expect(step4).toBeNull();
        // At this point, CLAUDE.md shows NOTHING — user is outside peaks workflow
        // Solo MUST display: "Peaks-Cli Solo workflow has ended..."
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('exit flow: double-clear is safe (idempotent)', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        setSkillPresence('peaks-solo');

        expect(clearSkillPresence()).toBe(true);
        expect(clearSkillPresence()).toBe(false); // already deleted, safe
        expect(getSkillPresence()).toBeNull();
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('cross-session: presence from old session is invisible in new session', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);

        // Session A: user selects full-auto mode
        writeSessionFile(root, '2026-05-28-session-a');
        const p1 = setSkillPresence('peaks-solo', 'full-auto', 'startup');
        expect(p1.sessionId).toBe('2026-05-28-session-a');

        const presencePath = join(root, '.peaks', '.active-skill.json');
        expect(existsSync(presencePath)).toBe(true);

        // Session B: user starts a new session, should re-prompt for mode
        writeSessionFile(root, '2026-05-28-session-b');

        const p2 = getSkillPresence();
        expect(p2).toBeNull();
        expect(existsSync(presencePath)).toBe(false);

        // Session B then sets its own presence (user re-selects mode)
        setSkillPresence('peaks-solo', 'assisted', 'startup');
        const p3 = getSkillPresence();
        expect(p3).not.toBeNull();
        expect(p3!.mode).toBe('assisted');
        expect(p3!.sessionId).toBe('2026-05-28-session-b');
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('mode validation', () => {
    test('isSkillPresenceMode returns true for valid modes', async () => {
      const { isSkillPresenceMode } = await import('../../src/services/skills/skill-presence-service.js');
      expect(isSkillPresenceMode('full-auto')).toBe(true);
      expect(isSkillPresenceMode('assisted')).toBe(true);
      expect(isSkillPresenceMode('swarm')).toBe(true);
      expect(isSkillPresenceMode('strict')).toBe(true);
    });

    test('isSkillPresenceMode returns false for invalid modes', async () => {
      const { isSkillPresenceMode } = await import('../../src/services/skills/skill-presence-service.js');
      expect(isSkillPresenceMode('invalid')).toBe(false);
      expect(isSkillPresenceMode('')).toBe(false);
      expect(isSkillPresenceMode('auto')).toBe(false);
    });

    test('setSkillPresence ignores invalid mode string', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const presence = setSkillPresence('peaks-solo', 'not-a-mode', 'startup');
        expect(presence.mode).toBeUndefined();
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('touchSkillHeartbeat edge cases', () => {
    test('returns null when presence file has invalid JSON', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const peaksDir = join(root, '.peaks');
        mkdirSync(peaksDir, { recursive: true });
        writeFileSync(join(peaksDir, '.active-skill.json'), 'not-json', 'utf8');

        const result = touchSkillHeartbeat();
        expect(result).toBeNull();
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('returns null when presence file has empty skill', () => {
      const root = createTempDir();
      try {
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const peaksDir = join(root, '.peaks');
        mkdirSync(peaksDir, { recursive: true });
        writeFileSync(join(peaksDir, '.active-skill.json'), JSON.stringify({ skill: '' }), 'utf8');

        const result = touchSkillHeartbeat();
        expect(result).toBeNull();
      } finally {
        vi.restoreAllMocks();
        rmSync(root, { recursive: true, force: true });
      }
    });
  });
});

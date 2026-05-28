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
  });
});

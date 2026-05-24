import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test, vi, afterEach } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const unlinkSyncMock = vi.fn((...args: Parameters<typeof actual.unlinkSync>) => actual.unlinkSync(...args));
  return { ...actual, unlinkSync: unlinkSyncMock };
});

import { setSkillPresence, getSkillPresence, clearSkillPresence, exportSkillPresence } from '../../src/services/skills/skill-presence-service.js';

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

        const presence = setSkillPresence('peaks-solo', 'solo', 'doctor');

        expect(presence.skill).toBe('peaks-solo');
        expect(presence.mode).toBe('solo');
        expect(presence.gate).toBe('doctor');
        expect(presence.setAt).toBeTruthy();

        const filePath = join(root, '.peaks', '.active-skill.json');
        expect(existsSync(filePath)).toBe(true);
        const raw = JSON.parse(readFileSync(filePath, 'utf8'));
        expect(raw.skill).toBe('peaks-solo');
        expect(raw.mode).toBe('solo');
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
});

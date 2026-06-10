import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  loadPreferences,
  savePreferences,
  DEFAULT_PREFERENCES,
  PREFERENCES_SCHEMA_VERSION,
  type ProjectPreferences,
} from '../../src/services/preferences/preferences-service.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-prefs-'));
}

describe('loadPreferences', () => {
  test('returns defaults when .peaks/preferences.json does not exist', () => {
    const project = makeProject();
    try {
      const prefs = loadPreferences(project);
      expect(prefs).toEqual(DEFAULT_PREFERENCES);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('returns merged object when partial preferences file exists', () => {
    const project = makeProject();
    try {
      const dir = join(project, '.peaks');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'preferences.json'), JSON.stringify({
        schema_version: '2.0.0',
        economyMode: false,
      }));
      const prefs = loadPreferences(project);
      expect(prefs.economyMode).toBe(false);
      expect(prefs.swarmMode).toBe(DEFAULT_PREFERENCES.swarmMode);
      expect(prefs.schema_version).toBe(PREFERENCES_SCHEMA_VERSION);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('throws on schema_version mismatch', () => {
    const project = makeProject();
    try {
      const dir = join(project, '.peaks');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'preferences.json'), JSON.stringify({
        schema_version: '1.0.0',
      }));
      expect(() => loadPreferences(project)).toThrow(/PREFERENCES_SCHEMA_MISMATCH/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('throws on invalid JSON', () => {
    const project = makeProject();
    try {
      const dir = join(project, '.peaks');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'preferences.json'), '{ invalid json');
      expect(() => loadPreferences(project)).toThrow(/PREFERENCES_JSON_INVALID/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('savePreferences', () => {
  test('writes preferences.json and creates .peaks/ if missing', () => {
    const project = makeProject();
    try {
      const overrides: Partial<ProjectPreferences> = { economyMode: false, uaPrompt: 'skip-forever' };
      savePreferences(project, overrides);
      const filePath = join(project, '.peaks/preferences.json');
      expect(existsSync(filePath)).toBe(true);
      const written = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(written.economyMode).toBe(false);
      expect(written.uaPrompt).toBe('skip-forever');
      expect(written.swarmMode).toBe(DEFAULT_PREFERENCES.swarmMode);
      expect(written.schema_version).toBe(PREFERENCES_SCHEMA_VERSION);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('merges with existing preferences instead of overwriting', () => {
    const project = makeProject();
    try {
      const dir = join(project, '.peaks');
      mkdirSync(dir, { recursive: true });
      savePreferences(project, { swarmMode: false, uaPrompt: 'skip-forever' });
      savePreferences(project, { economyMode: false });
      const written = JSON.parse(readFileSync(join(dir, 'preferences.json'), 'utf8'));
      expect(written.swarmMode).toBe(false);
      expect(written.economyMode).toBe(false);
      expect(written.uaPrompt).toBe('skip-forever');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { restoreField, listAvailableFields } from '../../src/services/config/config-restore.js';

let HOME_DIR: string;
const origHome = process.env.HOME;

beforeEach(() => {
  HOME_DIR = mkdtempSync(join(tmpdir(), 'peaks-restore-home-'));
  process.env.HOME = HOME_DIR;
  process.env.USERPROFILE = HOME_DIR;
});
afterEach(() => {
  rmSync(HOME_DIR, { recursive: true, force: true });
  process.env.HOME = origHome;
});

function writeBak(content: Record<string, unknown>): void {
  const dir = join(HOME_DIR, '.peaks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json.1.x.bak'), JSON.stringify(content), 'utf8');
}

describe('listAvailableFields', () => {
  test('returns all fields present in .bak', () => {
    writeBak({
      version: '1.4.2',
      economyMode: true,
      swarmMode: false,
      currentWorkspace: '/proj',
      workspaces: [],
      language: 'zh',
      model: 'sonnet',
      tokens: {},
      providers: {},
      proxy: {},
    });
    const fields = listAvailableFields();
    expect(fields.sort()).toEqual(
      ['currentWorkspace', 'economyMode', 'language', 'model', 'providers', 'proxy', 'swarmMode', 'tokens', 'workspaces'].sort()
    );
  });

  test('throws NO_BACKUP when .bak missing', () => {
    expect(() => listAvailableFields()).toThrow(/NO_BACKUP/);
  });
});

describe('restoreField', () => {
  test('writes a sidecar file restoring the named field', () => {
    writeBak({ version: '1.4.2', tokens: { anthropic: { api_key: 'sk-...' } } });
    const result = restoreField({ field: 'tokens', apply: true });
    expect(result.applied).toBe(true);
    const restoreFile = join(HOME_DIR, '.peaks/config.json.restore-tokens.json');
    const content = JSON.parse(readFileSync(restoreFile, 'utf8'));
    expect(content.field).toBe('tokens');
    expect(content.value).toEqual({ anthropic: { api_key: 'sk-...' } });
    expect(content.source).toBe('config.json.1.x.bak');
    expect(content.restoredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('throws FIELD_NOT_FOUND when field missing from .bak', () => {
    writeBak({ version: '1.4.2' });
    expect(() => restoreField({ field: 'tokens', apply: true })).toThrow(/FIELD_NOT_FOUND/);
  });

  test('throws RESTORE_GUARDED when field is one of the v2-archived set we discourage (workspaces)', () => {
    writeBak({ version: '1.4.2', workspaces: [] });
    expect(() => restoreField({ field: 'workspaces', apply: true })).toThrow(/RESTORE_GUARDED/);
  });

  test('dry-run does not write sidecar', () => {
    writeBak({ version: '1.4.2', language: 'zh' });
    const result = restoreField({ field: 'language', apply: false });
    expect(result.applied).toBe(false);
    const restoreFile = join(HOME_DIR, '.peaks/config.json.restore-language.json');
    expect(existsSync(restoreFile)).toBe(false);
  });
});

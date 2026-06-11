import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  planMigration,
  executeMigration,
  CONFIG_SCHEMA_VERSION_V2,
} from '../../src/services/config/config-migration.js';

let HOME_DIR: string;
const origHome = process.env.HOME;

beforeEach(() => {
  HOME_DIR = mkdtempSync(join(tmpdir(), 'peaks-home-'));
  process.env.HOME = HOME_DIR;
  // On Windows: process.env.USERPROFILE is also relevant
  process.env.USERPROFILE = HOME_DIR;
});
afterEach(() => {
  rmSync(HOME_DIR, { recursive: true, force: true });
  process.env.HOME = origHome;
});

function writeGlobalConfig_1x(obj: Record<string, unknown>): void {
  const dir = join(HOME_DIR, '.peaks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(obj), 'utf8');
}

function makeProjectWithPreferences(): string {
  const project = mkdtempSync(join(tmpdir(), 'peaks-cfg-mig-proj-'));
  mkdirSync(join(project, '.peaks'), { recursive: true });
  writeFileSync(
    join(project, '.peaks/preferences.json'),
    JSON.stringify({ schema_version: '2.0.0' }),
    'utf8'
  );
  return project;
}

describe('planMigration', () => {
  test('1.x → 2.0 plan: split fields, slim config.json, backup', () => {
    writeGlobalConfig_1x({
      version: '1.4.2',
      currentWorkspace: '/proj',
      workspaces: [],
      language: 'zh',
      model: 'sonnet',
      economyMode: true,
      swarmMode: false,
      tokens: {},
      providers: {},
      proxy: {},
    });
    const project = makeProjectWithPreferences();
    try {
      const plan = planMigration({ currentProjectRoot: project });
      expect(plan.willMigrateFields).toContain('economyMode');
      expect(plan.willMigrateFields).toContain('swarmMode');
      expect(plan.willKeepFields).toEqual([]);
      expect(plan.willArchiveFields).toContain('currentWorkspace');
      expect(plan.willArchiveFields).toContain('workspaces');
      expect(plan.willArchiveFields).toContain('language');
      expect(plan.willArchiveFields).toContain('model');
      expect(plan.willArchiveFields).toContain('tokens');
      expect(plan.willArchiveFields).toContain('providers');
      expect(plan.willArchiveFields).toContain('proxy');
      expect(plan.newConfigSchemaVersion).toBe(CONFIG_SCHEMA_VERSION_V2);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('already 2.0 config returns no-op plan', () => {
    const dir = join(HOME_DIR, '.peaks');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ version: '2.0.0' }), 'utf8');
    const project = makeProjectWithPreferences();
    try {
      const plan = planMigration({ currentProjectRoot: project });
      expect(plan.alreadyAtV2).toBe(true);
      expect(plan.willArchiveFields).toEqual([]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('executeMigration', () => {
  test('dry-run: does not write', () => {
    writeGlobalConfig_1x({
      version: '1.4.2',
      economyMode: true,
      swarmMode: true,
    });
    const project = makeProjectWithPreferences();
    try {
      const result = executeMigration({ currentProjectRoot: project, apply: false });
      expect(result.applied).toBe(false);
      const v1File = join(HOME_DIR, '.peaks/config.json');
      const before = readFileSync(v1File, 'utf8');
      expect(before).toContain('1.4.2');
      expect(existsSync(join(HOME_DIR, '.peaks/config.json.1.x.bak'))).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('apply: backups 1.x, writes slim 2.0 config.json, migrates per-project fields', () => {
    writeGlobalConfig_1x({
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
    const project = makeProjectWithPreferences();
    try {
      const result = executeMigration({ currentProjectRoot: project, apply: true });
      expect(result.applied).toBe(true);
      const newConfig = JSON.parse(readFileSync(join(HOME_DIR, '.peaks/config.json'), 'utf8'));
      expect(newConfig).toEqual({ version: '2.0.0' });

      const bak = readFileSync(join(HOME_DIR, '.peaks/config.json.1.x.bak'), 'utf8');
      expect(bak).toContain('1.4.2');
      expect(bak).toContain('currentWorkspace');

      const prefs = JSON.parse(readFileSync(join(project, '.peaks/preferences.json'), 'utf8'));
      expect(prefs.swarmMode).toBe(false);
      expect(prefs.economyMode).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('apply: throws NO_CONFIG when ~/.peaks/config.json is missing', () => {
    const project = makeProjectWithPreferences();
    try {
      expect(() => executeMigration({ currentProjectRoot: project, apply: true })).toThrow(/NO_CONFIG/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

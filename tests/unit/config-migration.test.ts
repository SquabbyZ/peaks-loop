import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  planMigration,
  executeMigration,
  CONFIG_SCHEMA_VERSION_V2,
} from '../../src/services/config/config-migration.js';

// Override the hoisted `os.homedir()` mock from cli-program-test-utils
// so this test uses the per-test HOME_DIR instead of the stale
// cliProgramTestState.home. Without this, the full-vitest run
// (which runs cli-program tests first) leaves the mock pointing
// at the cli-program test's mkdtemp dir, and our HOME_DIR write
// to ~/.peaks/config.json ends up at a path the service never
// reads from.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return new Proxy(actual, {
    get(target, prop) {
      if (prop === 'homedir') {
        return () => process.env.HOME ?? process.env.USERPROFILE ?? target.homedir();
      }
      return Reflect.get(target, prop);
    }
  });
});

let HOME_DIR: string;
const origHome = process.env.HOME;

beforeEach(() => {
  HOME_DIR = mkdtempSync(join(tmpdir(), 'peaks-home-'));
  process.env.HOME = HOME_DIR;
  process.env.USERPROFILE = HOME_DIR;
});
afterEach(() => {
  rmSync(HOME_DIR, { recursive: true, force: true });
  process.env.HOME = origHome;
});

function writeGlobalConfig(obj: Record<string, unknown>): void {
  const dir = join(HOME_DIR, '.peaks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(obj), 'utf8');
}

describe('planMigration', () => {
  test('1.x plan: detects old version', () => {
    writeGlobalConfig({ version: '1.4.2' });
    const project = mkdtempSync(join(tmpdir(), 'peaks-cfg-mig-proj-'));
    try {
      const plan = planMigration({ currentProjectRoot: project });
      expect(plan.alreadyAtV2).toBe(false);
      expect(plan.detectedSchemaVersion).toBe('1.4.2');
      expect(plan.newConfigSchemaVersion).toBe(CONFIG_SCHEMA_VERSION_V2);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('already 2.0 config returns no-op plan', () => {
    writeGlobalConfig({ version: '2.0.0' });
    const project = mkdtempSync(join(tmpdir(), 'peaks-cfg-mig-proj-'));
    try {
      const plan = planMigration({ currentProjectRoot: project });
      expect(plan.alreadyAtV2).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('executeMigration', () => {
  test('apply: backups 1.x, writes slim 2.0 config.json', () => {
    writeGlobalConfig({ version: '1.4.2' });
    const project = mkdtempSync(join(tmpdir(), 'peaks-cfg-mig-proj-'));
    try {
      const result = executeMigration({ currentProjectRoot: project, apply: true });
      expect(result.applied).toBe(true);
      const newConfig = JSON.parse(readFileSync(join(HOME_DIR, '.peaks/config.json'), 'utf8'));
      expect(newConfig).toEqual({ version: '2.0.0' });

      const bak = readFileSync(join(HOME_DIR, '.peaks/config.json.1.x.bak'), 'utf8');
      expect(bak).toContain('1.4.2');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('apply: throws NO_CONFIG when ~/.peaks/config.json is missing', () => {
    const project = mkdtempSync(join(tmpdir(), 'peaks-cfg-mig-proj-'));
    try {
      expect(() => executeMigration({ currentProjectRoot: project, apply: true })).toThrow(/NO_CONFIG/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

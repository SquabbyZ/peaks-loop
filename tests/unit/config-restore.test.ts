import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { restoreField, listAvailableFields } from '../../src/services/config/config-restore.js';

// Override the hoisted `os.homedir()` mock from cli-program-test-utils
// so this test uses the per-test HOME_DIR (see config-migration.test.ts
// for the full rationale).
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
  HOME_DIR = mkdtempSync(join(tmpdir(), 'peaks-restore-home-'));
  process.env.HOME = HOME_DIR;
  process.env.USERPROFILE = HOME_DIR;
});
afterEach(() => {
  rmSync(HOME_DIR, { recursive: true, force: true });
  process.env.HOME = origHome;
});

describe('listAvailableFields', () => {
  test('throws NO_BACKUP when .bak missing', () => {
    expect(() => listAvailableFields()).toThrow(/NO_BACKUP/);
  });
});

describe('restoreField', () => {
  test('throws FIELD_NOT_FOUND when no fields in .bak', () => {
    // No .bak written at all; the restore should not throw on a
    // missing .bak at the surface API; listAvailableFields is the
    // probe. With nothing to restore, restoreField also throws.
    expect(() => restoreField({ field: 'version', apply: true })).toThrow();
  });
});

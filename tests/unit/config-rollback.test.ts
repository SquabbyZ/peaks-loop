import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { executeRollback, planRollback } from '../../src/services/config/config-rollback.js';

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
  HOME_DIR = mkdtempSync(join(tmpdir(), 'peaks-rb-home-'));
  process.env.HOME = HOME_DIR;
  process.env.USERPROFILE = HOME_DIR;
});
afterEach(() => {
  rmSync(HOME_DIR, { recursive: true, force: true });
  process.env.HOME = origHome;
});

function writeSlimV2(): void {
  const dir = join(HOME_DIR, '.peaks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ version: '2.0.0' }), 'utf8');
}
function writeBak(content: Record<string, unknown>): void {
  const dir = join(HOME_DIR, '.peaks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json.1.x.bak'), JSON.stringify(content), 'utf8');
}

describe('planRollback', () => {
  test('returns available=false when no .bak', () => {
    writeSlimV2();
    const plan = planRollback();
    expect(plan.available).toBe(false);
  });
});

describe('executeRollback', () => {
  test('throws NO_BACKUP when .bak missing', () => {
    writeSlimV2();
    expect(() => executeRollback({ apply: true })).toThrow(/NO_BACKUP/);
  });
});

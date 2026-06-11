import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { executeRollback, planRollback } from '../../src/services/config/config-rollback.js';

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
  test('returns available=true when .bak exists', () => {
    writeSlimV2();
    writeBak({ version: '1.4.2', economyMode: true });
    const plan = planRollback();
    expect(plan.available).toBe(true);
    expect(plan.detectedVersion).toBe('1.4.2');
  });

  test('returns available=false when no .bak', () => {
    writeSlimV2();
    const plan = planRollback();
    expect(plan.available).toBe(false);
  });
});

describe('executeRollback', () => {
  test('dry-run does not write', () => {
    writeSlimV2();
    writeBak({ version: '1.4.2', economyMode: true });
    const result = executeRollback({ apply: false });
    expect(result.applied).toBe(false);
    const cur = JSON.parse(readFileSync(join(HOME_DIR, '.peaks/config.json'), 'utf8'));
    expect(cur.version).toBe('2.0.0');
  });

  test('apply restores config.json from .bak', () => {
    writeSlimV2();
    const originalBak = { version: '1.4.2', economyMode: true, swarmMode: false };
    writeBak(originalBak);
    const result = executeRollback({ apply: true });
    expect(result.applied).toBe(true);
    const restored = JSON.parse(readFileSync(join(HOME_DIR, '.peaks/config.json'), 'utf8'));
    expect(restored).toEqual(originalBak);
  });

  test('throws NO_BACKUP when .bak missing', () => {
    writeSlimV2();
    expect(() => executeRollback({ apply: true })).toThrow(/NO_BACKUP/);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const homeDirMock = vi.hoisted(() => ({ value: '' }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => homeDirMock.value };
});

import { applyRetention } from '../../../src/services/log/retention.js';
import { resolveLogDir } from '../../../src/services/log/logger.js';

describe('log/retention', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'peaks-log-retention-'));
    homeDirMock.value = tempHome;
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('removes files older than retention days', () => {
    const dir = resolveLogDir();
    mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    // Create 9 files dated 0..8 days ago. The PRD contract is
    // "files older than 7 days are deleted", so only the i=8
    // file (8 days old) is the borderline candidate; i=7 (7
    // days old) is the last survivor.
    for (let i = 0; i < 9; i++) {
      const date = new Date(now - i * day).toISOString().slice(0, 10);
      const file = join(dir, `peaks-cli-${date}.log`);
      writeFileSync(file, 'log line\n');
    }
    expect(readdirSync(dir).filter((n) => n.startsWith('peaks-cli-')).length).toBe(9);

    const removed = applyRetention({ retentionDays: 7, nowMs: now });
    expect(removed.length).toBe(1);

    const remaining = readdirSync(dir).filter((n) => n.startsWith('peaks-cli-'));
    expect(remaining.length).toBe(8);
  });

  it('does nothing when no log file is older than retention window', () => {
    const dir = resolveLogDir();
    mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    for (let i = 0; i < 3; i++) {
      const date = new Date(now - i * day).toISOString().slice(0, 10);
      writeFileSync(join(dir, `peaks-cli-${date}.log`), 'log line\n');
    }
    const removed = applyRetention({ retentionDays: 7, nowMs: now });
    expect(removed.length).toBe(0);
  });

  it('does not throw when log dir is missing', () => {
    expect(() => applyRetention({ retentionDays: 7, nowMs: Date.now() })).not.toThrow();
    expect(existsSync(resolveLogDir())).toBe(false);
  });
});

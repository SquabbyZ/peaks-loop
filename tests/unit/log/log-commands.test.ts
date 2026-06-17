import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const homeDirMock = vi.hoisted(() => ({ value: '' }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => homeDirMock.value };
});

import { tailLog, listLogFiles } from '../../../src/services/log/log-commands-service.js';

describe('log/log-commands-service', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'peaks-log-cmd-'));
    homeDirMock.value = tempHome;
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  describe('listLogFiles', () => {
    it('returns an empty array when no logs exist', () => {
      const files = listLogFiles();
      expect(files).toEqual([]);
    });

    it('returns all peaks-cli-*.log files sorted by date desc', () => {
      const dir = join(tempHome, '.peaks', 'logs');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'peaks-cli-2026-06-13.log'), '');
      writeFileSync(join(dir, 'peaks-cli-2026-06-15.log'), '');
      writeFileSync(join(dir, 'peaks-cli-2026-06-14.log'), '');
      writeFileSync(join(dir, 'other-file.txt'), '');
      const files = listLogFiles();
      expect(files.length).toBe(3);
      expect(files[0]).toBe('peaks-cli-2026-06-15.log');
      expect(files[1]).toBe('peaks-cli-2026-06-14.log');
      expect(files[2]).toBe('peaks-cli-2026-06-13.log');
    });
  });

  describe('tailLog', () => {
    it('returns empty when no log file for today', () => {
      const result = tailLog({ lines: 50 });
      expect(result.entries).toEqual([]);
      expect(result.file).toBe(null);
    });

    it('returns the last N lines of today\'s log', () => {
      const dir = join(tempHome, '.peaks', 'logs');
      mkdirSync(dir, { recursive: true });
      const now = new Date('2026-06-15T10:00:00.000Z');
      const yyyy = now.getUTCFullYear();
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(now.getUTCDate()).padStart(2, '0');
      const file = join(dir, `peaks-cli-${yyyy}-${mm}-${dd}.log`);
      const lines: string[] = [];
      for (let i = 0; i < 10; i++) {
        lines.push(JSON.stringify({ ts: `2026-06-15T10:0${i}:00.000Z`, level: 'info', command: 'main', msg: `m${i}` }));
      }
      writeFileSync(file, lines.join('\n') + '\n');

      const result = tailLog({ lines: 3, now: () => now });
      expect(result.entries.length).toBe(3);
      expect(result.entries[0]?.msg).toBe('m7');
      expect(result.entries[2]?.msg).toBe('m9');
    });

    it('returns at most lines parameter even when log has more entries', () => {
      const dir = join(tempHome, '.peaks', 'logs');
      mkdirSync(dir, { recursive: true });
      const now = new Date('2026-06-15T10:00:00.000Z');
      const yyyy = now.getUTCFullYear();
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(now.getUTCDate()).padStart(2, '0');
      const file = join(dir, `peaks-cli-${yyyy}-${mm}-${dd}.log`);
      const lines: string[] = [];
      for (let i = 0; i < 100; i++) {
        lines.push(JSON.stringify({ ts: `2026-06-15T10:00:${String(i).padStart(2, '0')}.000Z`, level: 'info', command: 'main', msg: `m${i}` }));
      }
      writeFileSync(file, lines.join('\n') + '\n');

      const result = tailLog({ lines: 50, now: () => now });
      expect(result.entries.length).toBe(50);
    });
  });
});

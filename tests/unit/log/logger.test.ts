import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We mock `os.homedir` so resolveLogDir() resolves into the test tmpdir.
const homeDirMock = vi.hoisted(() => ({ value: '' }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => homeDirMock.value
  };
});

// Use the real implementation
import { resolveLogDir, writeLogEntry, readLogEntries, buildLogFileName } from '../../../src/services/log/logger.js';

describe('log/logger', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'peaks-log-test-'));
    homeDirMock.value = tempHome;
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  describe('buildLogFileName', () => {
    it('builds a UTC date-stamped file name', () => {
      const date = new Date('2026-06-15T03:00:00.000Z');
      expect(buildLogFileName(date)).toBe('peaks-cli-2026-06-15.log');
    });
  });

  describe('resolveLogDir', () => {
    it('returns <homedir>/.peaks/logs', () => {
      expect(resolveLogDir()).toBe(join(tempHome, '.peaks', 'logs'));
    });
  });

  describe('writeLogEntry', () => {
    it('creates the log dir on first write and appends a JSONL line', () => {
      const logDir = resolveLogDir();
      expect(existsSync(logDir)).toBe(false);
      writeLogEntry({
        ts: '2026-06-15T10:00:00.000Z',
        level: 'info',
        command: 'main',
        msg: 'peaks-cli start',
        version: '2.2.2'
      }, { now: () => new Date('2026-06-15T10:00:00.000Z') });

      const todayFile = join(logDir, 'peaks-cli-2026-06-15.log');
      expect(existsSync(todayFile)).toBe(true);
      const body = readFileSync(todayFile, 'utf8');
      const lines = body.trim().split('\n');
      expect(lines.length).toBe(1);
      const parsed = JSON.parse(lines[0]!);
      expect(parsed.level).toBe('info');
      expect(parsed.command).toBe('main');
      expect(parsed.msg).toBe('peaks-cli start');
      expect(parsed.version).toBe('2.2.2');
      expect(parsed.ts).toBe('2026-06-15T10:00:00.000Z');
    });

    it('appends multiple entries on separate lines', () => {
      writeLogEntry({ ts: '2026-06-15T10:00:00.000Z', level: 'info', command: 'main', msg: 'one' }, { now: () => new Date('2026-06-15T10:00:00.000Z') });
      writeLogEntry({ ts: '2026-06-15T10:00:01.000Z', level: 'info', command: 'main', msg: 'two' }, { now: () => new Date('2026-06-15T10:00:01.000Z') });
      const logDir = resolveLogDir();
      const body = readFileSync(join(logDir, 'peaks-cli-2026-06-15.log'), 'utf8');
      const lines = body.trim().split('\n');
      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[0]!).msg).toBe('one');
      expect(JSON.parse(lines[1]!).msg).toBe('two');
    });

    it('redacts secret values before writing', () => {
      writeLogEntry({
        ts: '2026-06-15T10:00:00.000Z',
        level: 'info',
        command: 'main',
        msg: 'curl -H "Authorization: Bearer abc.def.ghi"',
        data: { apiKey: 'ghp_1234567890abcdefghij', password: 'hunter2hunter2' }
      }, { now: () => new Date('2026-06-15T10:00:00.000Z') });

      const logDir = resolveLogDir();
      const body = readFileSync(join(logDir, 'peaks-cli-2026-06-15.log'), 'utf8');
      expect(body).not.toContain('abc.def.ghi');
      expect(body).not.toContain('ghp_1234567890abcdefghij');
      expect(body).not.toContain('hunter2hunter2');
      expect(body).toContain('<redacted>');
    });

    it('sets file mode to 0o600 on supported OS', () => {
      // Skip on Windows where 0o600 maps to ACLs, not POSIX mode.
      if (process.platform === 'win32') return;
      writeLogEntry({ ts: '2026-06-15T10:00:00.000Z', level: 'info', command: 'main', msg: 'm' }, { now: () => new Date('2026-06-15T10:00:00.000Z') });
      const logDir = resolveLogDir();
      const file = join(logDir, 'peaks-cli-2026-06-15.log');
      const stat = statSync(file);
      // Mask to permission bits
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });

  describe('readLogEntries', () => {
    it('returns parsed JSONL entries from the current day', () => {
      writeLogEntry({ ts: '2026-06-15T10:00:00.000Z', level: 'info', command: 'main', msg: 'a' }, { now: () => new Date('2026-06-15T10:00:00.000Z') });
      writeLogEntry({ ts: '2026-06-15T10:00:01.000Z', level: 'info', command: 'main', msg: 'b' }, { now: () => new Date('2026-06-15T10:00:01.000Z') });
      const entries = readLogEntries({ now: () => new Date('2026-06-15T10:00:02.000Z') });
      expect(entries.length).toBe(2);
      expect(entries[0]?.msg).toBe('a');
      expect(entries[1]?.msg).toBe('b');
    });

    it('returns empty array when log file missing', () => {
      const entries = readLogEntries({ now: () => new Date('2026-06-15T10:00:00.000Z') });
      expect(entries).toEqual([]);
    });

    it('skips malformed lines', () => {
      const logDir = resolveLogDir();
      mkdirSync(logDir, { recursive: true });
      const file = join(logDir, 'peaks-cli-2026-06-15.log');
      writeFileSync(file, JSON.stringify({ ts: '2026-06-15T10:00:00.000Z', level: 'info', command: 'main', msg: 'good' }) + '\nthis is not json\n');
      const entries = readLogEntries({ now: () => new Date('2026-06-15T10:00:01.000Z') });
      expect(entries.length).toBe(1);
      expect(entries[0]?.msg).toBe('good');
    });
  });
});

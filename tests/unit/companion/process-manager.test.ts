import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearProcessRecord,
  closeLogFd,
  companionLogFile,
  companionPidFile,
  COMPANION_KILL_TIMEOUT_MS,
  COMPANION_LOG_FILENAME,
  COMPANION_PID_FILENAME,
  isPidAlive,
  parseProcessRecord,
  readProcessRecord,
  serializeProcessRecord,
  spawnCompanion,
  writeProcessRecord
} from '../../../src/services/companion/process-manager.js';
import type { CompanionProcessRecord } from '../../../src/services/companion/process-manager.js';

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'peaks-process-manager-'));
  previousHome = process.env['HOME'];
  process.env['HOME'] = home;
});

afterEach(() => {
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  process.env['HOME'] = previousHome;
});

describe('paths', () => {
  it('companionPidFile and companionLogFile live under ~/.peaks/companion', () => {
    const pid = companionPidFile(home);
    const log = companionLogFile(home);
    expect(pid.endsWith(COMPANION_PID_FILENAME)).toBe(true);
    expect(log.endsWith(COMPANION_LOG_FILENAME)).toBe(true);
    expect(pid).toContain('.peaks/companion');
    expect(log).toContain('.peaks/companion');
  });

  it('exposes a 5s kill timeout constant', () => {
    expect(COMPANION_KILL_TIMEOUT_MS).toBe(5000);
  });
});

describe('serialize/parse round-trip', () => {
  it('round-trips a record', () => {
    const record: CompanionProcessRecord = {
      pid: 12345,
      binaryPath: '/usr/local/bin/cc-connect',
      channel: 'weixin',
      startedAt: '2026-06-14T08:00:00.000Z',
      argv: ['--daemon']
    };
    expect(parseProcessRecord(serializeProcessRecord(record))).toEqual(record);
  });

  it('round-trips a record with empty argv', () => {
    const record: CompanionProcessRecord = {
      pid: 7,
      binaryPath: '/bin/cc-connect',
      channel: 'weixin',
      startedAt: '2026-06-14T08:00:00.000Z',
      argv: []
    };
    const parsed = parseProcessRecord(serializeProcessRecord(record));
    expect(parsed).not.toBeNull();
    expect(parsed?.argv).toEqual([]);
  });

  it('returns null for empty input', () => {
    expect(parseProcessRecord('')).toBeNull();
  });

  it('returns null for too few fields', () => {
    expect(parseProcessRecord('1|2|3')).toBeNull();
  });

  it('returns null for a non-numeric pid', () => {
    expect(parseProcessRecord('abc|/bin/cc-connect|weixin|2026-06-14T08:00:00.000Z|--daemon')).toBeNull();
  });

  it('returns null for a zero or negative pid', () => {
    expect(parseProcessRecord('0|/bin/cc-connect|weixin|2026-06-14T08:00:00.000Z|--daemon')).toBeNull();
    expect(parseProcessRecord('-1|/bin/cc-connect|weixin|2026-06-14T08:00:00.000Z|--daemon')).toBeNull();
  });

  it('rejects a non-weixin channel (slice 1 only supports weixin)', () => {
    expect(parseProcessRecord('123|/bin/cc-connect|slack|2026-06-14T08:00:00.000Z|--daemon')).toBeNull();
  });

  it('returns null when any required field is empty', () => {
    expect(parseProcessRecord('123||weixin|2026-06-14T08:00:00.000Z|--daemon')).toBeNull();
    expect(parseProcessRecord('123|/bin/cc-connect||2026-06-14T08:00:00.000Z|--daemon')).toBeNull();
    expect(parseProcessRecord('123|/bin/cc-connect|weixin||--daemon')).toBeNull();
  });
});

describe('read/write/clear process record', () => {
  it('readProcessRecord returns null when no file', () => {
    expect(readProcessRecord(home)).toBeNull();
  });

  it('writeProcessRecord creates the file and readProcessRecord round-trips', () => {
    const record: CompanionProcessRecord = {
      pid: 99,
      binaryPath: '/bin/cc-connect',
      channel: 'weixin',
      startedAt: '2026-06-14T08:00:00.000Z',
      argv: ['--daemon']
    };
    const result = writeProcessRecord(record, home);
    expect(result.ok).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    expect(readProcessRecord(home)).toEqual(record);
    const raw = readFileSync(result.path, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('writeProcessRecord returns ok=false when mkdir fails', () => {
    const blocker = join(home, '.peaks');
    writeFileSync(blocker, 'not a dir');
    const result = writeProcessRecord({
      pid: 1,
      binaryPath: '/bin/cc-connect',
      channel: 'weixin',
      startedAt: '2026-06-14T08:00:00.000Z',
      argv: ['--daemon']
    }, home);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('clearProcessRecord removes the file', () => {
    writeProcessRecord({ pid: 1, binaryPath: '/bin/cc-connect', channel: 'weixin', startedAt: '2026-06-14T08:00:00.000Z', argv: [] }, home);
    const cleared = clearProcessRecord(home);
    expect(cleared.ok).toBe(true);
    expect(cleared.removed).toBe(true);
    expect(readProcessRecord(home)).toBeNull();
  });

  it('clearProcessRecord reports removed=false when nothing to clear', () => {
    const cleared = clearProcessRecord(home);
    expect(cleared.removed).toBe(false);
    expect(cleared.ok).toBe(true);
  });
});

describe('isPidAlive', () => {
  it('returns false for 0 / negative / non-finite pids', () => {
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive(Number.NaN)).toBe(false);
  });

  it('returns true for the current process pid', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it('returns false for a non-existent (very high) pid', () => {
    expect(isPidAlive(2_000_000_000)).toBe(false);
  });
});

describe('spawnCompanion + closeLogFd', () => {
  it('spawns a detached child and writes to the log file', () => {
    const child = spawnCompanion('/bin/echo', ['hello-from-companion-test']);
    return new Promise<void>((resolve) => {
      child.child.on('exit', () => {
        setTimeout(() => {
          const log = readFileSync(companionLogFile(), 'utf8');
          expect(log).toContain('hello-from-companion-test');
          closeLogFd(child.logFd);
          resolve();
        }, 20);
      });
    });
  });
});

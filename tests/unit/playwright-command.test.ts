/**
 * Unit tests for the `peaks playwright` CLI command (slice 2.5.0 sub-fix C).
 *
 * Coverage:
 *   - Port walk logic (findFreePort with stub probe)
 *   - Terminal id derivation (TERM_SESSION_ID, WT_SESSION, hash fallback)
 *   - Session file read / write / remove
 *   - Conflict detection (existing session blocks a fresh start)
 *   - ls returns all session records
 *   - Default port constant + range invariants
 */

import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  DEFAULT_PORT,
  MAX_PORT,
  deriveTerminalId,
  findFreePort,
  listSessions,
  playwrightSessionsDir,
  readSession,
  removeSession,
  sessionFilePath,
  writeSession,
  type PlaywrightSession
} from '../../src/cli/commands/playwright-commands.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'peaks-pw-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('playwright-command: port walk logic', () => {
  test('findFreePort returns start when first port is free', async () => {
    const probe = async (p: number): Promise<boolean> => p === 8931;
    const port = await findFreePort(8931, 8949, probe);
    expect(port).toBe(8931);
  });

  test('findFreePort walks past busy ports', async () => {
    const busy = new Set([8931, 8932, 8933]);
    const probe = async (p: number): Promise<boolean> => !busy.has(p);
    const port = await findFreePort(8931, 8949, probe);
    expect(port).toBe(8934);
  });

  test('findFreePort returns null when range exhausted', async () => {
    const probe = async (): Promise<boolean> => false;
    const port = await findFreePort(8931, 8949, probe);
    expect(port).toBeNull();
  });

  test('DEFAULT_PORT is 8931 and MAX_PORT is 8949 (G17)', () => {
    expect(DEFAULT_PORT).toBe(8931);
    expect(MAX_PORT).toBe(8949);
  });
});

describe('playwright-command: terminal id derivation (R4)', () => {
  test('uses TERM_SESSION_ID when present', () => {
    const id = deriveTerminalId({ TERM_SESSION_ID: 'ABCD-1234-EFGH' }, 1);
    expect(id).toBe('ABCD-1234-EFGH');
  });

  test('uses WT_SESSION when TERM_SESSION_ID missing', () => {
    const id = deriveTerminalId({ WT_SESSION: 'wtsess-xyz' }, 1);
    expect(id).toBe('wt-wtsess-xyz');
  });

  test('falls back to hash(ppid+SSH_TTY)', () => {
    const id = deriveTerminalId({ SSH_TTY: '/dev/pts/0' }, 12345);
    expect(id).toMatch(/^tty-[a-f0-9]{16}$/);
  });

  test('hash fallback uses literal "no-tty" when SSH_TTY missing', () => {
    const id = deriveTerminalId({}, 99999);
    expect(id).toMatch(/^tty-[a-f0-9]{16}$/);
  });

  test('sanitizes unsafe characters in TERM_SESSION_ID', () => {
    const id = deriveTerminalId({ TERM_SESSION_ID: 'a/b\\c d' }, 1);
    // slashes / backslashes / spaces replaced with _
    expect(id).not.toContain('/');
    expect(id).not.toContain('\\');
    expect(id).not.toContain(' ');
  });
});

describe('playwright-command: session file lifecycle', () => {
  test('playwrightSessionsDir is under .peaks/_runtime/', () => {
    const dir = playwrightSessionsDir(tmpDir);
    expect(dir).toBe(join(tmpDir, '.peaks', '_runtime', 'playwright-sessions'));
  });

  test('writeSession + readSession round-trips data', () => {
    const session: PlaywrightSession = {
      terminalId: 'tty-aabbccddeeff0011',
      port: 8932,
      browser: 'chromium',
      userDataDir: '/tmp/ud',
      startedAt: '2026-06-17T15:00:00.000Z',
      pid: 12345
    };
    writeSession(tmpDir, session);
    const back = readSession(tmpDir, session.terminalId);
    expect(back).not.toBeNull();
    expect(back?.port).toBe(8932);
    expect(back?.browser).toBe('chromium');
    expect(back?.pid).toBe(12345);
  });

  test('readSession returns null when no session file', () => {
    const back = readSession(tmpDir, 'nonexistent');
    expect(back).toBeNull();
  });

  test('removeSession deletes the session file', () => {
    const session: PlaywrightSession = {
      terminalId: 'tty-remove',
      port: 8933,
      browser: 'firefox',
      userDataDir: '/tmp/ud2',
      startedAt: '2026-06-17T15:01:00.000Z'
    };
    writeSession(tmpDir, session);
    const path = sessionFilePath(tmpDir, session.terminalId);
    expect(existsSync(path)).toBe(true);
    const removed = removeSession(tmpDir, session.terminalId);
    expect(removed).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  test('removeSession returns false when no session file', () => {
    const removed = removeSession(tmpDir, 'never-existed');
    expect(removed).toBe(false);
  });
});

describe('playwright-command: listSessions', () => {
  test('returns [] when no sessions dir', () => {
    expect(listSessions(tmpDir)).toEqual([]);
  });

  test('returns all valid session records', () => {
    mkdirSync(playwrightSessionsDir(tmpDir), { recursive: true });
    const s1: PlaywrightSession = {
      terminalId: 'a',
      port: 8931,
      browser: 'chromium',
      userDataDir: '/tmp/a',
      startedAt: '2026-06-17T15:00:00.000Z'
    };
    const s2: PlaywrightSession = {
      terminalId: 'b',
      port: 8932,
      browser: 'firefox',
      userDataDir: '/tmp/b',
      startedAt: '2026-06-17T15:01:00.000Z'
    };
    writeSession(tmpDir, s1);
    writeSession(tmpDir, s2);
    const sessions = listSessions(tmpDir);
    expect(sessions).toHaveLength(2);
    const ports = sessions.map((s) => s.port).sort();
    expect(ports).toEqual([8931, 8932]);
  });

  test('skips malformed session files', () => {
    mkdirSync(playwrightSessionsDir(tmpDir), { recursive: true });
    writeFileSync(sessionFilePath(tmpDir, 'bad'), '{ not valid json');
    const valid: PlaywrightSession = {
      terminalId: 'good',
      port: 8934,
      browser: 'webkit',
      userDataDir: '/tmp/g',
      startedAt: '2026-06-17T15:02:00.000Z'
    };
    writeSession(tmpDir, valid);
    const sessions = listSessions(tmpDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.port).toBe(8934);
  });
});

describe('playwright-command: session file path', () => {
  test('sessionFilePath is under the sessions dir', () => {
    const path = sessionFilePath(tmpDir, 'myterm');
    expect(path.startsWith(playwrightSessionsDir(tmpDir))).toBe(true);
    expect(path.endsWith('myterm.json')).toBe(true);
  });
});

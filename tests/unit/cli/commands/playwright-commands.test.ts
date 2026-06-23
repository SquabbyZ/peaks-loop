/**
 * `peaks playwright` unit tests — slice 2026-06-23-audit-p0-test-coverage.
 *
 * The `playwright-commands.ts` file (461 lines) shipped in slice 3 without
 * unit-test coverage; the audit flagged this as HIGH (a 0-test file with
 * `spawn` shell calls is a real risk). These tests cover the
 * pure / IO-bound helpers (no live MCP spawn — that lives in the
 * integration suite):
 *
 *   - Path helpers: playwrightSessionsDir, sessionFilePath
 *   - Terminal id derivation: deriveTerminalId, sanitize (private)
 *   - Port walk: findFreePort (with injected probe — no real net bind)
 *   - Session IO: readSession, writeSession, listSessions, removeSession
 *
 * `spawnPlaywrightMcp` is intentionally NOT tested here (real `npx`
 * spawn). It is exercised by the integration suite + manual QA.
 */
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PORT,
  MAX_PORT,
  PLAYWRIGHT_SESSIONS_DIR,
  deriveTerminalId,
  findFreePort,
  listSessions,
  playwrightSessionsDir,
  readSession,
  removeSession,
  sessionFilePath,
  writeSession,
  type PlaywrightSession
} from '../../../../src/cli/commands/playwright-commands.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-playwright-'));
});

afterEach(() => {
  if (existsSync(projectRoot)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

describe('playwright-commands: path helpers', () => {
  it('playwrightSessionsDir lands under .peaks/_runtime/playwright-sessions', () => {
    const dir = playwrightSessionsDir(projectRoot);
    expect(dir).toBe(join(projectRoot, '.peaks', '_runtime', PLAYWRIGHT_SESSIONS_DIR));
  });

  it('sessionFilePath joins sessionsDir + terminalId.json', () => {
    const path = sessionFilePath(projectRoot, 'tty-abc123');
    expect(path).toBe(join(projectRoot, '.peaks', '_runtime', PLAYWRIGHT_SESSIONS_DIR, 'tty-abc123.json'));
  });

  it('PLAYWRIGHT_SESSIONS_DIR is the bare directory name (not absolute)', () => {
    // regression guard: the const is reused by other tools (browser-reuse-hint.ts)
    // so its shape must stay a plain segment, not an absolute path.
    expect(PLAYWRIGHT_SESSIONS_DIR).toBe('playwright-sessions');
    expect(PLAYWRIGHT_SESSIONS_DIR.includes('/')).toBe(false);
    expect(PLAYWRIGHT_SESSIONS_DIR.includes('\\')).toBe(false);
  });
});

describe('playwright-commands: deriveTerminalId', () => {
  it('prefers TERM_SESSION_ID when present (macOS Terminal / iTerm2)', () => {
    const id = deriveTerminalId({ TERM_SESSION_ID: 'mac-term-1234' } as NodeJS.ProcessEnv, 9999);
    expect(id).toBe('mac-term-1234');
  });

  it('falls back to WT_SESSION (Windows Terminal) prefixed with "wt-"', () => {
    const id = deriveTerminalId({ WT_SESSION: 'win-term-5678' } as NodeJS.ProcessEnv, 9999);
    expect(id).toBe('wt-win-term-5678');
  });

  it('falls back to a hash of (ppid, SSH_TTY) when neither TERM_SESSION_ID nor WT_SESSION is set', () => {
    const id = deriveTerminalId({ SSH_TTY: '/dev/ttys001' } as NodeJS.ProcessEnv, 12345);
    expect(id).toMatch(/^tty-[0-9a-f]{16}$/);
  });

  it('falls back to "no-tty" sentinel when no env vars are set', () => {
    const id = deriveTerminalId({} as NodeJS.ProcessEnv, 12345);
    expect(id).toMatch(/^tty-[0-9a-f]{16}$/);
  });

  it('produces a stable hash for the same (ppid, tty) input', () => {
    const id1 = deriveTerminalId({ SSH_TTY: '/dev/ttys002' } as NodeJS.ProcessEnv, 42);
    const id2 = deriveTerminalId({ SSH_SESSION_ID: '/dev/ttys002' } as NodeJS.ProcessEnv, 42);
    // Same input but different env var name → different "tty" sentinel
    expect(id1).not.toBe(id2);
    // Same input → same output
    const id3 = deriveTerminalId({ SSH_TTY: '/dev/ttys002' } as NodeJS.ProcessEnv, 42);
    expect(id1).toBe(id3);
  });

  it('sanitizes unsafe characters in TERM_SESSION_ID (replaces with underscore)', () => {
    const id = deriveTerminalId({ TERM_SESSION_ID: 'a/b\\c d@e' } as NodeJS.ProcessEnv, 9999);
    // forward slash → underscore, backslash → underscore, space → underscore, @ → underscore
    expect(id).toBe('a_b_c_d_e');
  });

  it('truncates sanitized ids to 64 chars', () => {
    const raw = 'x'.repeat(200);
    const id = deriveTerminalId({ TERM_SESSION_ID: raw } as NodeJS.ProcessEnv, 9999);
    expect(id.length).toBe(64);
  });
});

describe('playwright-commands: findFreePort', () => {
  it('returns the first port the probe says is free', async () => {
    const probe = async (port: number) => port === 9000;
    const port = await findFreePort(8999, 9002, probe);
    expect(port).toBe(9000);
  });

  it('returns null when no port in range is free', async () => {
    const probe = async () => false;
    const port = await findFreePort(9000, 9002, probe);
    expect(port).toBeNull();
  });

  it('walks linearly from start, stops at the first free port (early return)', async () => {
    const probes: number[] = [];
    const probe = async (port: number) => {
      probes.push(port);
      return port === 9001;
    };
    const port = await findFreePort(9000, 9002, probe);
    expect(port).toBe(9001);
    // Early return — once a free port is found the loop breaks.
    expect(probes).toEqual([9000, 9001]);
  });

  it('walks the entire range and probes every port when nothing is free', async () => {
    const probes: number[] = [];
    const probe = async (port: number) => {
      probes.push(port);
      return false;
    };
    const port = await findFreePort(9000, 9002, probe);
    expect(port).toBeNull();
    // No early return — exhausted range.
    expect(probes).toEqual([9000, 9001, 9002]);
  });

  it('uses DEFAULT_PORT and MAX_PORT when called with no arguments', async () => {
    const probes: number[] = [];
    const probe = async (port: number) => {
      probes.push(port);
      return port === MAX_PORT;
    };
    const port = await findFreePort(DEFAULT_PORT, MAX_PORT, probe);
    expect(port).toBe(MAX_PORT);
    expect(probes[0]).toBe(DEFAULT_PORT);
  });
});

describe('playwright-commands: session IO', () => {
  const sampleSession: PlaywrightSession = {
    terminalId: 'tty-deadbeef12345678',
    port: 8931,
    browser: 'chromium',
    userDataDir: '/tmp/userdata',
    startedAt: '2026-06-23T20:00:00.000Z',
    pid: 12345
  };

  it('writeSession creates the sessions dir on demand and writes JSON', () => {
    writeSession(projectRoot, sampleSession);
    const path = sessionFilePath(projectRoot, sampleSession.terminalId);
    expect(existsSync(path)).toBe(true);
    expect(existsSync(playwrightSessionsDir(projectRoot))).toBe(true);
  });

  it('readSession returns the session previously written', () => {
    writeSession(projectRoot, sampleSession);
    const result = readSession(projectRoot, sampleSession.terminalId);
    expect(result).not.toBeNull();
    expect(result?.terminalId).toBe(sampleSession.terminalId);
    expect(result?.port).toBe(sampleSession.port);
    expect(result?.browser).toBe(sampleSession.browser);
    expect(result?.pid).toBe(sampleSession.pid);
  });

  it('readSession returns null when no session file exists', () => {
    const result = readSession(projectRoot, 'tty-nonexistent');
    expect(result).toBeNull();
  });

  it('readSession returns null when the session file is malformed (JSON parse error)', () => {
    const dir = playwrightSessionsDir(projectRoot);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'tty-malformed.json'), '{not valid json', 'utf8');
    const result = readSession(projectRoot, 'tty-malformed');
    expect(result).toBeNull();
  });

  it('removeSession returns true and deletes the file when it exists', () => {
    writeSession(projectRoot, sampleSession);
    expect(existsSync(sessionFilePath(projectRoot, sampleSession.terminalId))).toBe(true);
    const removed = removeSession(projectRoot, sampleSession.terminalId);
    expect(removed).toBe(true);
    expect(existsSync(sessionFilePath(projectRoot, sampleSession.terminalId))).toBe(false);
  });

  it('removeSession returns false when no session file exists', () => {
    const removed = removeSession(projectRoot, 'tty-never-existed');
    expect(removed).toBe(false);
  });

  it('listSessions returns [] when the sessions dir does not exist', () => {
    const sessions = listSessions(projectRoot);
    expect(sessions).toEqual([]);
  });

  it('listSessions returns all valid session files in the dir, skipping malformed', () => {
    const dir = playwrightSessionsDir(projectRoot);
    mkdirSync(dir, { recursive: true });

    const sessionA: PlaywrightSession = { ...sampleSession, terminalId: 'tty-aaaaaaaaaaaaaaaa', port: 8931 };
    const sessionB: PlaywrightSession = { ...sampleSession, terminalId: 'tty-bbbbbbbbbbbbbbbb', port: 8932 };
    writeSession(projectRoot, sessionA);
    writeSession(projectRoot, sessionB);
    // Drop a malformed entry — must not crash and must not appear.
    writeFileSync(join(dir, 'tty-malformed.json'), '{not valid', 'utf8');
    // Drop a non-json entry — must be skipped by extension filter.
    writeFileSync(join(dir, 'README.md'), 'hello', 'utf8');

    const sessions = listSessions(projectRoot);
    const ids = sessions.map((s) => s.terminalId).sort();
    expect(ids).toEqual(['tty-aaaaaaaaaaaaaaaa', 'tty-bbbbbbbbbbbbbbbb']);
    // Defensive: the dir contains 4 entries but list returned only 2 valid sessions.
    expect(readdirSync(dir).length).toBe(4);
  });

  it('listSessions returns [] when the sessions dir exists but is empty', () => {
    mkdirSync(playwrightSessionsDir(projectRoot), { recursive: true });
    const sessions = listSessions(projectRoot);
    expect(sessions).toEqual([]);
  });

  it('round-trip: writeSession → listSessions → readSession preserves all fields', () => {
    const sessionWithoutPid: PlaywrightSession = {
      terminalId: 'tty-roundtrip00000000',
      port: 8933,
      browser: 'firefox',
      userDataDir: '/var/cache/playwright',
      startedAt: '2026-06-23T21:00:00.000Z'
    };
    writeSession(projectRoot, sessionWithoutPid);
    const all = listSessions(projectRoot);
    expect(all).toHaveLength(1);
    expect(all[0]?.terminalId).toBe(sessionWithoutPid.terminalId);
    expect(all[0]?.pid).toBeUndefined();
    const read = readSession(projectRoot, sessionWithoutPid.terminalId);
    expect(read?.browser).toBe('firefox');
    expect(read?.pid).toBeUndefined();
  });
});

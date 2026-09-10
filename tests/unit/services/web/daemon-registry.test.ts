// tests/unit/services/web/daemon-registry.test.ts
//
// `daemon.json` is the only handle on a live daemon, and every field in it is
// later trusted: `port` becomes a URL, `token` becomes a bearer credential and
// `pid` is passed to `process.kill` (which on Windows is `TerminateProcess`).
// These tests pin the three guards that make a planted or stale file harmless:
// range-checked fields, an ownership comparison at the reader, and an EPERM
// liveness probe that does not read "alive but unsignalable" as "dead".
//
// Dimensions covered:
//   - behavior:    what the parser and the liveness probe accept and reject
//   - integration: real files under a tmp workspace's daemon directory
//   - render:      not applicable (returns objects/booleans, no text surface)
//   - a11y:        not applicable (no user-visible text or exit code)

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/services/web/daemon-registry.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'these functions return objects and booleans, not text' },
    { dim: 'a11y', reason: 'no user-visible text or exit code is produced at this layer' },
  ],
);

import {
  acquireSpawnLock,
  isProcessAlive,
  readDaemonInfo,
  releaseSpawnLock,
  writeDaemonInfo,
} from '../../../../src/services/web/daemon-registry.js';
import {
  parseDaemonInfo,
  PROTOCOL_VERSION,
  type WebDaemonInfo,
} from '../../../../src/services/web/web-protocol.js';
import { webDaemonInfoPath, webSpawnLockPath } from '../../../../src/services/web/web-artifact-paths.js';

const SESSION_ID = '2026-09-10-session-528a63';
const ws = withTmpWorkspacePerTest('peaks-web-registry-');

function daemonInfo(root: string, overrides: Partial<WebDaemonInfo> = {}): WebDaemonInfo {
  return {
    protocolVersion: PROTOCOL_VERSION,
    pid: process.pid,
    port: 49_152,
    token: 'a'.repeat(64),
    version: '4.0.36',
    projectRoot: root,
    sessionId: SESSION_ID,
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Write a raw daemon.json, bypassing the typed writer, as an attacker would. */
function writeRawDaemonInfo(root: string, body: Record<string, unknown>): void {
  const target = webDaemonInfoPath(root, SESSION_ID);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(body), 'utf8');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('behavior — parseDaemonInfo field validation', () => {
  it('when the port is outside the TCP range, should reject the record', () => {
    // given: daemon.json bodies whose port cannot mean a listening socket
    // when:  each is parsed
    // then:  port 0, 65536 and a negative port are all rejected
    for (const port of [0, 65_536, -1]) {
      const raw = JSON.stringify({ ...daemonInfo('C:/root'), port });
      expect(parseDaemonInfo(raw)).toBeNull();
    }
  });

  it('when the port is the top of the TCP range, should accept the record', () => {
    // given: a daemon.json body with port 65535
    // when:  it is parsed
    // then:  the boundary value is accepted, not rounded out
    const raw = JSON.stringify({ ...daemonInfo('C:/root'), port: 65_535 });
    expect(parseDaemonInfo(raw)?.port).toBe(65_535);
  });

  it('when the pid is not a positive integer, should reject the record', () => {
    // given: daemon.json bodies whose pid cannot be signalled
    // when:  each is parsed
    // then:  a zero, negative or fractional pid is rejected
    for (const pid of [0, -5, 1.5]) {
      const raw = JSON.stringify({ ...daemonInfo('C:/root'), pid });
      expect(parseDaemonInfo(raw)).toBeNull();
    }
  });
});

describe('behavior — readDaemonInfo ownership', () => {
  it('when the record describes another session, should ignore it', () => {
    // given: a daemon.json whose sessionId is not the caller's
    // when:  the caller reads its own session's daemon
    // then:  the mismatched record is rejected rather than used
    const root = ws().path;
    writeRawDaemonInfo(root, daemonInfo(root, { sessionId: 'someone-elses-session' }));
    expect(readDaemonInfo(root, SESSION_ID)).toBeNull();
  });

  it('when the record describes another project root, should ignore it', () => {
    // given: a daemon.json whose projectRoot is not the caller's
    // when:  the caller reads its own session's daemon
    // then:  the mismatched record is rejected rather than used
    const root = ws().path;
    writeRawDaemonInfo(root, daemonInfo(root, { projectRoot: `${root}-elsewhere` }));
    expect(readDaemonInfo(root, SESSION_ID)).toBeNull();
  });

  it('when the record matches the caller, should return it', () => {
    // given: a daemon.json written by this project for this session
    // when:  the caller reads its own session's daemon
    // then:  the record comes back intact
    const root = ws().path;
    writeDaemonInfo(root, SESSION_ID, daemonInfo(root));
    expect(readDaemonInfo(root, SESSION_ID)?.sessionId).toBe(SESSION_ID);
  });

  it('when the file is absent, should return null rather than throwing', () => {
    // given: a session directory with no daemon.json yet
    // when:  the caller reads it
    // then:  absence is a null, not an error
    expect(readDaemonInfo(ws().path, SESSION_ID)).toBeNull();
  });
});

describe('behavior — isProcessAlive', () => {
  it('when the pid is this process, should report it alive', () => {
    // given: the current process pid
    // when:  the liveness probe runs
    // then:  it reports alive
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('when the pid cannot name a process, should report it dead', () => {
    // given: pids that are not valid process ids
    // when:  the liveness probe runs
    // then:  each is reported dead without touching the OS
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(1.5)).toBe(false);
  });

  it('when the signal probe raises EPERM, should report the pid alive', () => {
    // given: a pid that exists but belongs to another user (EPERM)
    // when:  the liveness probe runs
    // then:  alive-but-unsignalable is NOT reported as dead
    vi.spyOn(process, 'kill').mockImplementation(() => {
      const error = new Error('operation not permitted') as NodeJS.ErrnoException;
      error.code = 'EPERM';
      throw error;
    });
    expect(isProcessAlive(12_345)).toBe(true);
  });

  it('when the signal probe raises ESRCH, should report the pid dead', () => {
    // given: a pid with no process behind it (ESRCH)
    // when:  the liveness probe runs
    // then:  it is reported dead
    vi.spyOn(process, 'kill').mockImplementation(() => {
      const error = new Error('no such process') as NodeJS.ErrnoException;
      error.code = 'ESRCH';
      throw error;
    });
    expect(isProcessAlive(12_345)).toBe(false);
  });
});

describe('integration — the cold-start lock against a real file', () => {
  it('when another live process holds the lock, should not acquire it', () => {
    // given: a fresh lock owned by this (live) process
    // when:  a second acquire is attempted
    // then:  it is refused, so only one caller can be the spawner
    const root = ws().path;
    const lock = webSpawnLockPath(root, SESSION_ID);
    mkdirSync(dirname(lock), { recursive: true });
    writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'utf8');
    expect(acquireSpawnLock(root, SESSION_ID)).toBe(false);
  });

  it('when this process owns the lock, should release it', () => {
    // given: a lock this process just acquired
    // when:  it is released
    // then:  a later acquire succeeds
    const root = ws().path;
    expect(acquireSpawnLock(root, SESSION_ID)).toBe(true);
    releaseSpawnLock(root, SESSION_ID);
    expect(acquireSpawnLock(root, SESSION_ID)).toBe(true);
  });
});

/**
 * `daemon.json` carries the 64-hex bearer token, and 127.0.0.1 is reachable by
 * every local user, so the file mode is the only thing standing between another
 * account on the machine and the browser. Skipped on Windows, where the POSIX
 * mode bits are not the access-control mechanism.
 */
describe('integration — the credential file mode', () => {
  it.skipIf(process.platform === 'win32')(
    'when daemon.json is written, should be readable only by its owner',
    () => {
      // given: a session with no daemon record
      const root = ws().path;
      // when: the record is written
      writeDaemonInfo(root, SESSION_ID, daemonInfo(root));
      // then: the file is 0600 and its directory 0700, not the 0644/0755 default
      const fileMode = statSync(webDaemonInfoPath(root, SESSION_ID)).mode & 0o777;
      const dirMode = statSync(dirname(webDaemonInfoPath(root, SESSION_ID))).mode & 0o777;
      expect(fileMode).toBe(0o600);
      expect(dirMode).toBe(0o700);
    }
  );
});

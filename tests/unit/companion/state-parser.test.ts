import { mkdtempSync, rmSync, existsSync, writeFileSync, utimesSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ccConnectHomeDir,
  ccConnectStateFile,
  CC_CONNECT_HOME_DIRNAME,
  CC_CONNECT_STATE_FILENAME,
  normalizePairingState,
  readCcConnectState
} from '../../../src/services/companion/state-parser.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'peaks-state-parser-'));
});

afterEach(() => {
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
});

describe('paths', () => {
  it('ccConnectHomeDir is home/.cc-connect', () => {
    expect(ccConnectHomeDir(home)).toBe(join(home, CC_CONNECT_HOME_DIRNAME));
  });
  it('ccConnectStateFile is home/.cc-connect/state.json', () => {
    expect(ccConnectStateFile(home)).toBe(join(home, CC_CONNECT_HOME_DIRNAME, CC_CONNECT_STATE_FILENAME));
  });
});

describe('normalizePairingState', () => {
  it('maps snake_case values', () => {
    expect(normalizePairingState('not_scanned')).toBe('not-scanned');
    expect(normalizePairingState('scanned_waiting_confirm')).toBe('scanned-waiting-confirm');
    expect(normalizePairingState('logged_in')).toBe('logged-in');
    expect(normalizePairingState('expired')).toBe('expired');
    expect(normalizePairingState('error')).toBe('error');
  });
  it('maps kebab-case values (forward-compat)', () => {
    expect(normalizePairingState('not-scanned')).toBe('not-scanned');
    expect(normalizePairingState('logged-in')).toBe('logged-in');
  });
  it('maps legacy aliases (pending, active, paired, failed, token_expired)', () => {
    expect(normalizePairingState('pending')).toBe('not-scanned');
    expect(normalizePairingState('active')).toBe('logged-in');
    expect(normalizePairingState('paired')).toBe('logged-in');
    expect(normalizePairingState('failed')).toBe('error');
    expect(normalizePairingState('token_expired')).toBe('expired');
  });
  it('returns unknown for non-string or unrecognized values', () => {
    expect(normalizePairingState(undefined)).toBe('unknown');
    expect(normalizePairingState(null)).toBe('unknown');
    expect(normalizePairingState(42)).toBe('unknown');
    expect(normalizePairingState('mystery')).toBe('unknown');
  });
});

describe('readCcConnectState', () => {
  it('returns unknown with all-null fields when state file is absent', () => {
    const snap = readCcConnectState(home);
    expect(snap.statePath).toBe(ccConnectStateFile(home));
    expect(snap.mtimeMs).toBeNull();
    expect(snap.state).toBe('unknown');
    expect(snap.accountId).toBeNull();
    expect(snap.lastLogin).toBeNull();
    expect(snap.error).toBeNull();
  });

  it('reads a logged-in snapshot', () => {
    mkdirSync(ccConnectHomeDir(home), { recursive: true });
    const payload = {
      pairing_state: 'logged_in',
      account_id: 'bot@ilink',
      last_login: '2026-06-14T08:00:00.000Z',
      error: null
    };
    writeFileSync(ccConnectStateFile(home), JSON.stringify(payload), 'utf8');
    const snap = readCcConnectState(home);
    expect(snap.state).toBe('logged-in');
    expect(snap.accountId).toBe('bot@ilink');
    expect(snap.lastLogin).toBe('2026-06-14T08:00:00.000Z');
    expect(snap.error).toBeNull();
    expect(typeof snap.mtimeMs).toBe('number');
    expect(snap.mtimeMs).not.toBeNull();
  });

  it('accepts the `state` field name as a back-compat alias', () => {
    mkdirSync(ccConnectHomeDir(home), { recursive: true });
    writeFileSync(ccConnectStateFile(home), JSON.stringify({ state: 'scanned_waiting_confirm' }), 'utf8');
    const snap = readCcConnectState(home);
    expect(snap.state).toBe('scanned-waiting-confirm');
  });

  it('returns state=error when JSON is malformed', () => {
    mkdirSync(ccConnectHomeDir(home), { recursive: true });
    writeFileSync(ccConnectStateFile(home), '{ this is not json', 'utf8');
    const snap = readCcConnectState(home);
    expect(snap.state).toBe('error');
    expect(snap.error).toMatch(/not valid JSON/);
  });

  it('tolerates a non-object root (returns unknown)', () => {
    mkdirSync(ccConnectHomeDir(home), { recursive: true });
    writeFileSync(ccConnectStateFile(home), '"a string"', 'utf8');
    const snap = readCcConnectState(home);
    expect(snap.state).toBe('unknown');
  });

  it('records the file mtime when present', () => {
    mkdirSync(ccConnectHomeDir(home), { recursive: true });
    const file = ccConnectStateFile(home);
    writeFileSync(file, JSON.stringify({ pairing_state: 'logged_in' }), 'utf8');
    const future = (Date.now() + 60_000) / 1000;
    utimesSync(file, future, future);
    const snap = readCcConnectState(home);
    expect(snap.mtimeMs).not.toBeNull();
    expect((snap.mtimeMs ?? 0) >= Date.now()).toBe(true);
  });
});

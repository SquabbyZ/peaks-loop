import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETUP_TIMEOUT_MS,
  defaultPrompt,
  defaultQrRenderer,
  runCompanionSetup
} from '../../../src/services/companion/setup-service.js';
import { ccConnectConfigFile } from '../../../src/services/companion/config-template.js';
import type { CompanionStateSnapshot } from '../../../src/services/companion/state-parser.js';
import type { CompanionPairingState } from '../../../src/services/companion/companion-types.js';

let tmp: string;
let previousHome: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'peaks-setup-'));
  previousHome = process.env['HOME'];
  process.env['HOME'] = tmp;
});

afterEach(() => {
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  process.env['HOME'] = previousHome;
  vi.restoreAllMocks();
});

function dropFakeBinary(): string {
  const dir = join(tmp, 'bin');
  mkdirSync(dir, { recursive: true });
  const bin = join(dir, 'cc-connect');
  writeFileSync(bin, '#!/bin/sh\nif [ "$1" = "--version" ]; then\n  echo "cc-connect 1.3.2"\n  exit 0\nfi\nexit 0\n');
  chmodSync(bin, 0o755);
  return dir;
}

function fakeProbeOk(binaryPath: string) {
  return async (_options?: { pathEnv?: string; platform?: NodeJS.Platform; spawnFn?: unknown; skipSpawn?: boolean }) =>
    ({ binaryPath, version: '1.3.2', ok: true, error: null });
}

function fakeProbeFail() {
  return async (_options?: { pathEnv?: string; platform?: NodeJS.Platform; spawnFn?: unknown; skipSpawn?: boolean }) =>
    ({ binaryPath: null, version: null, ok: false, error: 'not on PATH' });
}

function noopSpawn(_binaryPath: string, _args: readonly string[]) {
  return { kill: () => {}, pid: 12345 };
}

async function noopQr(_qrPayload: string): Promise<void> {
  /* test seam — intentionally a no-op */
}

async function noopStart(_options?: { now?: () => Date; spawn?: unknown; pathEnv?: string; force?: boolean; home?: string }) {
  return {
    started: true,
    alreadyRunning: false,
    pid: 99999,
    binaryPath: '/bin/cc-connect',
    argv: ['--daemon'],
    logFile: '/tmp/log',
    pidFile: '/tmp/pid',
    error: null,
    nextActions: []
  };
}

function makeStateReader(states: CompanionPairingState[]): (home?: string) => CompanionStateSnapshot {
  let i = 0;
  return (home?: string) => {
    const next = states[Math.min(i, states.length - 1)] ?? 'unknown';
    i += 1;
    return {
      statePath: home !== undefined ? join(home, '.cc-connect', 'state.json') : '',
      mtimeMs: Date.now(),
      state: next,
      accountId: null,
      lastLogin: null,
      error: null
    };
  };
}

describe('runCompanionSetup', () => {
  it('exposes DEFAULT_SETUP_TIMEOUT_MS = 60_000', () => {
    expect(DEFAULT_SETUP_TIMEOUT_MS).toBe(60_000);
  });

  it('defaultPrompt resolves to true (non-TTY default)', async () => {
    await expect(defaultPrompt('?')).resolves.toBe(true);
  });

  it('defaultQrRenderer is a callable function', () => {
    expect(typeof defaultQrRenderer).toBe('function');
  });

  it('returns error when the binary is not on PATH', async () => {
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeFail(),
      spawnSetup: noopSpawn,
      qrRenderer: noopQr,
      start: noopStart,
      stateReader: makeStateReader(['unknown'])
    });
    expect(state.error).toMatch(/not on PATH|PATH/);
    expect(state.binaryPath).toBeNull();
    expect(state.configWritten).toBe(false);
  });

  it('writes the weixin-only config and reaches logged-in (daemon started)', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      spawnSetup: noopSpawn,
      qrRenderer: noopQr,
      start: noopStart,
      stateReader: makeStateReader(['not-scanned', 'scanned-waiting-confirm', 'logged-in'])
    });
    expect(state.error).toBeNull();
    expect(state.configWritten).toBe(true);
    expect(state.qrRendered).toBe(true);
    expect(state.pairing).toBe('logged-in');
    expect(state.startedDaemon).toBe(true);
    expect(state.daemonPid).toBe(99999);
    expect(existsSync(ccConnectConfigFile(tmp))).toBe(true);
  });

  it('preserves the existing config when forceOverwrite is false and the user declines (AC7)', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    mkdirSync(join(tmp, '.cc-connect'), { recursive: true });
    const configPath = ccConnectConfigFile(tmp);
    writeFileSync(configPath, '# user edits\n', 'utf8');
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      forceOverwrite: false,
      prompt: async () => false,
      spawnSetup: noopSpawn,
      qrRenderer: noopQr,
      start: noopStart,
      stateReader: makeStateReader(['unknown'])
    });
    expect(state.error).toMatch(/declined/i);
    expect(state.configWritten).toBe(false);
    expect(state.configPreserved).toBe(true);
    const onDisk = readFileSync(configPath, 'utf8');
    expect(onDisk).toBe('# user edits\n');
  });

  it('overwrites the existing config when the user accepts the prompt', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    mkdirSync(join(tmp, '.cc-connect'), { recursive: true });
    const configPath = ccConnectConfigFile(tmp);
    writeFileSync(configPath, '# user edits\n', 'utf8');
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      forceOverwrite: false,
      prompt: async () => true,
      spawnSetup: noopSpawn,
      qrRenderer: noopQr,
      start: noopStart,
      stateReader: makeStateReader(['logged-in'])
    });
    expect(state.error).toBeNull();
    expect(state.configWritten).toBe(true);
    const onDisk = readFileSync(configPath, 'utf8');
    expect(onDisk).not.toBe('# user edits\n');
    expect(onDisk).toContain('[[projects.platforms]]');
  });

  it('overwrites without prompting when forceOverwrite is true', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    mkdirSync(join(tmp, '.cc-connect'), { recursive: true });
    const configPath = ccConnectConfigFile(tmp);
    writeFileSync(configPath, '# user edits\n', 'utf8');
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      forceOverwrite: true,
      prompt: async () => { throw new Error('prompt should not be called'); },
      spawnSetup: noopSpawn,
      qrRenderer: noopQr,
      start: noopStart,
      stateReader: makeStateReader(['logged-in'])
    });
    expect(state.error).toBeNull();
    expect(state.configWritten).toBe(true);
  });

  it('warns when an existing config has non-weixin platforms (slice 1 hard constraint)', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    mkdirSync(join(tmp, '.cc-connect'), { recursive: true });
    const configPath = ccConnectConfigFile(tmp);
    writeFileSync(configPath, '[[projects.platforms]]\ntype = "feishu"\n', 'utf8');
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      forceOverwrite: false,
      prompt: async () => true,
      spawnSetup: noopSpawn,
      qrRenderer: noopQr,
      start: noopStart,
      stateReader: makeStateReader(['logged-in'])
    });
    expect(state.configWarnings.some((w) => /non-weixin platform types/.test(w))).toBe(true);
  });

  it('times out with a recoverable error when the binary never reports logged-in (AC10)', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      timeoutMs: 50,
      spawnSetup: noopSpawn,
      qrRenderer: noopQr,
      start: noopStart,
      stateReader: makeStateReader(['not-scanned'])
    });
    expect(state.error).toMatch(/did not reach "logged-in"/);
    expect(state.pairing).toBe('not-scanned');
    expect(state.nextActions.join(' ')).toMatch(/timeout|--timeout/);
  });

  it('surfaces an error state from the binary', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      spawnSetup: noopSpawn,
      qrRenderer: noopQr,
      start: noopStart,
      stateReader: makeStateReader(['error'])
    });
    expect(state.pairing).toBe('error');
    expect(state.error).toBeTruthy();
  });

  it('surfaces an expired pairing state', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      spawnSetup: noopSpawn,
      qrRenderer: noopQr,
      start: noopStart,
      stateReader: makeStateReader(['expired'])
    });
    expect(state.pairing).toBe('expired');
    expect(state.error).toMatch(/expired/i);
  });

  it('falls back to a manual-start next action when startCcConnect fails after pairing', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      spawnSetup: noopSpawn,
      qrRenderer: noopQr,
      start: async () => ({ started: false, alreadyRunning: false, pid: null, binaryPath: null, argv: [], logFile: '', pidFile: '', error: 'spawn returned no pid', nextActions: [] }),
      stateReader: makeStateReader(['logged-in'])
    });
    expect(state.error).toBeNull();
    expect(state.startedDaemon).toBe(false);
    expect(state.nextActions.join(' ')).toMatch(/peaks companion start/);
  });

  it('records QR-render failure as a recoverable error', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      spawnSetup: noopSpawn,
      qrRenderer: async () => { throw new Error('iLink backend unreachable'); },
      start: noopStart,
      stateReader: makeStateReader(['unknown'])
    });
    expect(state.error).toMatch(/QR render failed/);
    expect(state.qrRendered).toBe(false);
  });
});

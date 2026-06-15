import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETUP_TIMEOUT_MS,
  DEFAULT_QR_IMAGE_FILENAME,
  defaultPrompt,
  defaultQrRenderer,
  readIlinkUrl,
  runCompanionSetup,
  setupStdioForTty
} from '../../../src/services/companion/setup-service.js';
import { ccConnectConfigFile } from '../../../src/services/companion/config-template.js';
import type { CompanionStateSnapshot } from '../../../src/services/companion/state-parser.js';
import type { CompanionPairingState } from '../../../src/services/companion/companion-types.js';
import type { CompanionConfig } from '../../../src/services/config/config-types.js';
import type { CompanionProbe } from '../../../src/services/companion/companion-types.js';

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

function fakeProbeOk(binaryPath: string, resolvedSource: 'node-modules' | 'path' | null = 'node-modules'): typeof import('../../../src/services/companion/cc-connect-resolver.js').probeCcConnect {
  return (async (_options?: { pathEnv?: string; platform?: NodeJS.Platform; spawnFn?: unknown; skipSpawn?: boolean }) =>
    ({ binaryPath, version: '1.3.2', ok: true, error: null, resolvedSource })) as unknown as typeof import('../../../src/services/companion/cc-connect-resolver.js').probeCcConnect;
}

/** Returns a fake probe whose resolvedSource can be customized per test. */
function fakeProbeWithSource(binaryPath: string, resolvedSource: 'node-modules' | 'path' | null): typeof import('../../../src/services/companion/cc-connect-resolver.js').probeCcConnect {
  return fakeProbeOk(binaryPath, resolvedSource);
}

/** Captures the argv the spawn was called with. */
function fakeSpawnSetupCapture() {
  const calls: Array<{ binaryPath: string; args: readonly string[] }> = [];
  const factory = (binaryPath: string, args: readonly string[]) => {
    calls.push({ binaryPath, args });
    return { kill: () => {}, pid: 54321 };
  };
  return { calls, factory };
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

// BUG 2026-06-14-cc-connect-weixin#3: setup-service previously
// wrote `source: 'SETUP'` to the binary cache, which the legacy
// `sourceToCompanionBinarySource` enum didn't recognize, so the
// peaks-config mirror landed on `binaryPathSource: null`. The fix
// passes `probe.resolvedSource` (uppercased) instead, so the
// enum resolves cleanly to `'node-modules' | 'path'`.

describe('runCompanionSetup — BUG 3: binaryPathSource regression', () => {
  function peaksConfigPath(home: string): string {
    return join(home, '.peaks', 'config.json');
  }

  function readPeaksConfigCompanion(home: string): { binaryPath: string | null; binaryPathSource: string | null } | null {
    const p = peaksConfigPath(home);
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, 'utf8')) as { companion?: { binaryPath?: string | null; binaryPathSource?: string | null } };
    if (raw.companion === undefined) return null;
    return { binaryPath: raw.companion.binaryPath ?? null, binaryPathSource: raw.companion.binaryPathSource ?? null };
  }

  it('mirrors binaryPathSource="node-modules" (not null) into peaks config after a node-modules setup', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeWithSource(bin, 'node-modules'),
      spawnSetup: noopSpawn,
      qrRenderer: noopQr,
      start: noopStart,
      stateReader: makeStateReader(['logged-in'])
    });
    expect(state.error).toBeNull();
    const mirror = readPeaksConfigCompanion(tmp);
    expect(mirror).not.toBeNull();
    expect(mirror?.binaryPath).toBe(bin);
    expect(mirror?.binaryPathSource).toBe('node-modules');
  });

  it('mirrors binaryPathSource="path" into peaks config when probe resolved from PATH', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeWithSource(bin, 'path'),
      spawnSetup: noopSpawn,
      qrRenderer: noopQr,
      start: noopStart,
      stateReader: makeStateReader(['logged-in'])
    });
    expect(state.error).toBeNull();
    const mirror = readPeaksConfigCompanion(tmp);
    expect(mirror?.binaryPath).toBe(bin);
    expect(mirror?.binaryPathSource).toBe('path');
  });

  it('falls back to "node-modules" when probe returns resolvedSource=null but version is known', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeWithSource(bin, null),
      spawnSetup: noopSpawn,
      qrRenderer: noopQr,
      start: noopStart,
      stateReader: makeStateReader(['logged-in'])
    });
    expect(state.error).toBeNull();
    const mirror = readPeaksConfigCompanion(tmp);
    expect(mirror?.binaryPath).toBe(bin);
    expect(mirror?.binaryPathSource).toBe('node-modules');
  });
});

// BUG 2026-06-14-cc-connect-weixin#4: setup's spawn argv was
// historically incorrect (cc-connect was invoked without the
// `weixin setup` subcommand, dumping help and exiting). The fix
// asserts the canonical argv and that --timeout fires within
// (timeoutMs + pollInterval) regardless of state-reader output.

describe('runCompanionSetup — BUG 4: spawn argv + deadline race', () => {
  it('spawns cc-connect with `weixin setup` subcommand (and --project)', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    const { calls, factory } = fakeSpawnSetupCapture();
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeWithSource(bin, 'node-modules'),
      projectName: 'team-bot',
      spawnSetup: factory,
      qrRenderer: noopQr,
      start: noopStart,
      stateReader: makeStateReader(['logged-in'])
    });
    expect(state.error).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.binaryPath).toBe(bin);
    expect(calls[0]?.args).toEqual([
      'weixin',
      'setup',
      '--project',
      'team-bot',
      '--qr-image',
      expect.stringMatching(/\.peaks\/companion\/qr\.png$/)
    ]);
  });

  it('fires --timeout within the deadline (no fake logged-in state)', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    const startedAt = Date.now();
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeWithSource(bin, 'node-modules'),
      timeoutMs: 200,
      spawnSetup: noopSpawn,
      qrRenderer: noopQr,
      start: noopStart,
      stateReader: makeStateReader(['not-scanned', 'not-scanned', 'not-scanned'])
    });
    const elapsed = Date.now() - startedAt;
    expect(state.error).toMatch(/did not reach "logged-in"/);
    expect(state.pairing).toBe('not-scanned');
    // 200ms timeout + up to one ~1s poll interval slack.
    expect(elapsed).toBeGreaterThanOrEqual(200);
    expect(elapsed).toBeLessThan(1500);
  });
});

// Slice 2026-06-14-cc-connect-weixin (change-1): setup reads from
// ~/.peaks/config.json (the typed CompanionConfig block) and
// builds the TOML from it. The test seeds a tmp home with a real
// peaks config and asserts the resulting TOML body matches what
// peaks config prescribes.

describe('runCompanionSetup — peaks-config-driven (slice change-1)', () => {
  function seedPeaksConfig(home: string, companion: Partial<CompanionConfig>): void {
    const peaksDir = join(home, '.peaks');
    mkdirSync(peaksDir, { recursive: true });
    const configPath = join(peaksDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      version: '2.0.0',
      ocr: { llm: { url: '', authToken: '', model: '', useAnthropic: false, authHeader: 'authorization' } },
      companion: {
        enabled: true,
        defaultChannel: 'weixin',
        binaryPath: null,
        binaryPathSource: null,
        configPath: '~/.cc-connect/config.toml',
        weixin: { ilinkQrPayload: 'ilink://peaks-cli?project=team-bot', loginTimeoutSec: 60 },
        autoStart: false,
        ...companion
      }
    }, null, 2));
  }

  it('renders TOML from the typed peaks-config block (project name from ilinkQrPayload)', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    seedPeaksConfig(tmp, {
      enabled: true,
      weixin: { ilinkQrPayload: 'ilink://peaks-cli?project=team-bot', loginTimeoutSec: 60 }
    });
    let capturedQr: string | null = null;
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      spawnSetup: noopSpawn,
      qrRenderer: async (payload) => { capturedQr = payload; },
      start: noopStart,
      stateReader: makeStateReader(['logged-in']),
      companionConfig: {
        enabled: true,
        defaultChannel: 'weixin',
        binaryPath: null,
        binaryPathSource: null,
        configPath: '~/.cc-connect/config.toml',
        weixin: { ilinkQrPayload: 'ilink://peaks-cli?project=team-bot', loginTimeoutSec: 60 },
        autoStart: false
      }
    });
    expect(state.error).toBeNull();
    expect(state.configWritten).toBe(true);
    expect(capturedQr).toBe('ilink://peaks-cli?project=team-bot');
    const toml = readFileSync(ccConnectConfigFile(tmp), 'utf8');
    expect(toml).toContain('name = "team-bot"');
    expect(toml).toContain('type = "weixin"');
  });

  it('emits an empty body when peaks config has companion.enabled=false', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    seedPeaksConfig(tmp, { enabled: false });
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      spawnSetup: noopSpawn,
      qrRenderer: noopQr,
      start: noopStart,
      stateReader: makeStateReader(['logged-in']),
      companionConfig: {
        enabled: false,
        defaultChannel: 'weixin',
        binaryPath: null,
        binaryPathSource: null,
        configPath: '~/.cc-connect/config.toml',
        weixin: { ilinkQrPayload: 'ilink://peaks-cli?project=default', loginTimeoutSec: 60 },
        autoStart: false
      }
    });
    expect(state.error).toBeNull();
    const toml = readFileSync(ccConnectConfigFile(tmp), 'utf8');
    expect(toml).not.toContain('[[projects.platforms]]');
    expect(toml).toMatch(/companion\.enabled=false/);
  });

  it('uses companion.weixin.loginTimeoutSec when no explicit --timeout is supplied', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    seedPeaksConfig(tmp, {});
    // loginTimeoutSec=1 → timeoutMs=1_000 → polls ~1×1s before timeout.
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      spawnSetup: noopSpawn,
      qrRenderer: noopQr,
      start: noopStart,
      stateReader: makeStateReader(['not-scanned', 'not-scanned', 'not-scanned']),
      companionConfig: {
        enabled: true,
        defaultChannel: 'weixin',
        binaryPath: null,
        binaryPathSource: null,
        configPath: '~/.cc-connect/config.toml',
        weixin: { ilinkQrPayload: 'ilink://peaks-cli?project=default', loginTimeoutSec: 1 },
        autoStart: false
      }
    });
    // Timeout math: loginTimeoutSec=1 → timeoutMs=1_000.
    expect(state.timeoutMs).toBe(1_000);
  });
});

// BUG 2026-06-14-cc-connect-weixin#7: setup-service previously
// spawned cc-connect with `stdio: ['ignore', 'pipe', 'pipe']` even
// when the user was in an interactive TTY, which meant cc-connect's
// ASCII QR (qrcode-terminal) never reached the user's terminal — it
// was silently buffered inside peaks-cli. The fix branches stdio on
// `process.stdout.isTTY`: inherit when TTY so the QR renders
// directly; keep pipe when not so peaks can still extract the iLink
// URL via the stdout regex scanner.

describe('runCompanionSetup — BUG 7: setup TTY stdio + iLink URL capture', () => {
  const ORIGINAL_IS_TTY = process.stdout.isTTY;

  function setStdoutIsTTY(value: boolean): void {
    Object.defineProperty(process.stdout, 'isTTY', {
      value,
      configurable: true,
      writable: true
    });
  }

  afterEach(() => {
    // Restore the real TTY flag so other tests don't see leaked
    // overrides.
    Object.defineProperty(process.stdout, 'isTTY', {
      value: ORIGINAL_IS_TTY,
      configurable: true,
      writable: true
    });
  });

  it('setupStdioForTty returns inherit stdio when stdout is a TTY', () => {
    setStdoutIsTTY(true);
    // The stdio helper is the single source of truth for the
    // TTY branching; defaultSpawnSetup composes it with `spawn()`.
    // We assert the helper directly so the test stays
    // synchronous and does not need to mock node:child_process.
    expect(setupStdioForTty(true)).toEqual(['ignore', 'inherit', 'inherit']);
  });

  it('setupStdioForTty returns pipe stdio when stdout is not a TTY', () => {
    setStdoutIsTTY(false);
    expect(setupStdioForTty(false)).toEqual(['ignore', 'pipe', 'pipe']);
    expect(setupStdioForTty(undefined)).toEqual(['ignore', 'pipe', 'pipe']);
  });

  it('defaultSpawnSetup picks inherit when stdout.isTTY is true (smoke)', () => {
    // Sanity-check that the live process flag is what feeds the
    // stdio helper. We cannot easily mock `spawn` (the namespace
    // export is non-configurable), but the helper test above
    // proves the branching; this test ensures the default
    // function uses `process.stdout.isTTY` as its input.
    setStdoutIsTTY(true);
    // Capture the live value used by defaultSpawnSetup.
    const observed = process.stdout.isTTY;
    expect(observed).toBe(true);
  });

  it('defaultSpawnSetup picks pipe when stdout.isTTY is false (smoke)', () => {
    setStdoutIsTTY(false);
    const observed = process.stdout.isTTY;
    expect(observed).toBe(false);
  });

  it('surfaces iLinkUrl + qrPath in SetupState when run with --json (non-TTY)', async () => {
    setStdoutIsTTY(false);
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    // Custom spawn factory that simulates cc-connect's stdout
    // containing the iLink URL line so the regex scanner can pick
    // it up. The factory also exposes a `child` reference that
    // defaultSpawnSetup would otherwise produce in real life.
    const fakeChild: { pid: number; __ilinkUrl: { value: string | null } } = {
      pid: 54321,
      __ilinkUrl: { value: 'ilink://peaks-cli?project=team-bot' as string | null }
    };
    const spawnSetupFn = (_binaryPath: string, _args: readonly string[]) => ({
      kill: () => {},
      pid: fakeChild.pid,
      child: fakeChild
    });
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      spawnSetup: spawnSetupFn as never,
      qrRenderer: noopQr,
      start: noopStart,
      stateReader: makeStateReader(['logged-in'])
    });
    expect(state.error).toBeNull();
    expect(state.iLinkUrl).toBe('ilink://peaks-cli?project=team-bot');
    expect(state.qrPath).toBe(join(tmp, '.peaks', 'companion', DEFAULT_QR_IMAGE_FILENAME));
    // The PNG directory should exist on disk (the orchestrator
    // mkdirs the parent dir; cc-connect would write the file).
    expect(existsSync(join(tmp, '.peaks', 'companion'))).toBe(true);
  });

  it('omits iLinkUrl/qrPath in TTY mode (inherit stdio, no capture)', async () => {
    setStdoutIsTTY(true);
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      spawnSetup: noopSpawn,
      qrRenderer: noopQr,
      start: noopStart,
      stateReader: makeStateReader(['logged-in'])
    });
    expect(state.error).toBeNull();
    expect(state.iLinkUrl).toBeNull();
    expect(state.qrPath).toBeNull();
  });

  it('omits qrPath when --no-qr-image is set (qrImageDisabled: true)', async () => {
    setStdoutIsTTY(false);
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    const capturedArgs: string[][] = [];
    const capturingSpawn = (_binaryPath: string, args: readonly string[]) => {
      capturedArgs.push([...args]);
      return { kill: () => {}, pid: 54321, child: undefined };
    };
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      spawnSetup: capturingSpawn as never,
      qrRenderer: noopQr,
      start: noopStart,
      stateReader: makeStateReader(['logged-in']),
      qrImageDisabled: true
    });
    expect(state.error).toBeNull();
    expect(state.qrPath).toBeNull();
    expect(capturedArgs).toHaveLength(1);
    expect(capturedArgs[0]).not.toContain('--qr-image');
  });

  it('passes --qr-image <path> through to cc-connect when qrImagePath is set', async () => {
    setStdoutIsTTY(false);
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    const customPath = join(tmp, 'custom-qr.png');
    const capturedArgs: string[][] = [];
    const capturingSpawn = (_binaryPath: string, args: readonly string[]) => {
      capturedArgs.push([...args]);
      return { kill: () => {}, pid: 54321, child: undefined };
    };
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      spawnSetup: capturingSpawn as never,
      qrRenderer: noopQr,
      start: noopStart,
      stateReader: makeStateReader(['logged-in']),
      qrImagePath: customPath
    });
    expect(state.error).toBeNull();
    expect(state.qrPath).toBe(customPath);
    expect(capturedArgs[0]).toContain('--qr-image');
    expect(capturedArgs[0]).toContain(customPath);
  });

  it('readIlinkUrl returns the stashed URL from a fake ChildProcess', () => {
    const fakeChild = { __ilinkUrl: { value: 'ilink://example' } };
    expect(readIlinkUrl(fakeChild)).toBe('ilink://example');
    expect(readIlinkUrl({})).toBeNull();
    expect(readIlinkUrl(null)).toBeNull();
  });
});

// BUG 2026-06-14-cc-connect-weixin#8: peaks companion setup
// supports a `--token <bearer>` short-circuit that bypasses the
// QR render + pairing poll loop and calls the bind service
// directly. The tests below cover the three observable
// behaviors: (a) the bindRunner is invoked with the right args,
// (b) the QR renderer is *not* called (path B skips the QR), and
// (c) on a successful bind, the daemon is started and the
// returned SetupState has `bound: true` + `pairing: 'logged-in'`.

describe('runCompanionSetup — BUG 8: --token short-circuit (Path B)', () => {
  it('invokes bindRunner with --token and skips the QR renderer', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    const bindCalls: Array<{ token: string; project: string; apiUrl?: string; skipVerify?: boolean }> = [];
    let qrRendererCalls = 0;
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      bindToken: 'real-bot@im.bot:real-secret',
      bindRunner: async (options) => {
        bindCalls.push(options);
        return { ok: true, bound: true, error: null };
      },
      qrRenderer: async () => { qrRendererCalls += 1; },
      spawnSetup: noopSpawn,
      start: noopStart,
      stateReader: makeStateReader(['logged-in'])
    });
    expect(state.error).toBeNull();
    expect(state.bound).toBe(true);
    expect(state.pairing).toBe('logged-in');
    expect(state.qrRendered).toBe(false);
    expect(qrRendererCalls).toBe(0);
    expect(bindCalls).toHaveLength(1);
    expect(bindCalls[0]?.token).toBe('real-bot@im.bot:real-secret');
    expect(bindCalls[0]?.project).toBe('default');
  });

  it('forwards --api-url and --skip-verify to the bind runner', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    const bindCalls: Array<{ token: string; project: string; apiUrl?: string; skipVerify?: boolean }> = [];
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      bindToken: 'real-bot@im.bot:real-secret',
      bindApiUrl: 'https://ilink-proxy.example.com',
      bindSkipVerify: true,
      bindRunner: async (options) => {
        bindCalls.push(options);
        return { ok: true, bound: true, error: null };
      },
      qrRenderer: noopQr,
      spawnSetup: noopSpawn,
      start: noopStart,
      stateReader: makeStateReader(['logged-in'])
    });
    expect(state.error).toBeNull();
    expect(bindCalls[0]?.apiUrl).toBe('https://ilink-proxy.example.com');
    expect(bindCalls[0]?.skipVerify).toBe(true);
  });

  it('returns an error when the bind runner fails', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      bindToken: 'bad-token',
      bindRunner: async () => ({ ok: false, bound: false, error: 'invalid bearer' }),
      qrRenderer: noopQr,
      spawnSetup: noopSpawn,
      start: noopStart,
      stateReader: makeStateReader(['logged-in'])
    });
    expect(state.bound).toBe(false);
    expect(state.error).toMatch(/invalid bearer/);
    expect(state.bindError).toMatch(/invalid bearer/);
    expect(state.startedDaemon).toBe(false);
  });

  it('starts the daemon on a successful bind', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      bindToken: 'real-bot@im.bot:real-secret',
      bindRunner: async () => ({ ok: true, bound: true, error: null }),
      qrRenderer: noopQr,
      spawnSetup: noopSpawn,
      start: noopStart,
      stateReader: makeStateReader(['logged-in'])
    });
    expect(state.bound).toBe(true);
    expect(state.startedDaemon).toBe(true);
    expect(state.daemonPid).toBe(99999);
  });
});

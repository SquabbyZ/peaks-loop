/**
 * 2026-06-15-qr-inline-display: unit tests for the new QR renderers.
 *
 * Covers:
 *   - unicodeBlockQrRenderer — emits half/full-block characters (█▀▄ space)
 *   - inlineQrRenderer — emits markdown image syntax with valid base64 PNG
 *   - asciiQrRenderer — wraps the legacy qrcode-terminal small-ASCII path
 *   - resolveQrRenderer — flag > env > default precedence
 *   - runCompanionSetup still bypasses the renderer when --token is set
 *   - renderer failure surfaces state.error + state.nextActions
 *
 * TDD order: these tests were authored BEFORE the production code
 * (`src/services/companion/qr-renderers.ts`) was implemented. They
 * must fail until the renderer module is in place.
 */
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveQrRenderer,
  unicodeBlockQrRenderer,
  inlineQrRenderer,
  asciiQrRenderer,
  detectClaudeCodeEnv
} from '../../../src/services/companion/qr-renderers.js';
import { runCompanionSetup } from '../../../src/services/companion/setup-service.js';

let tmp: string;
let previousHome: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'peaks-qr-renderers-'));
  previousHome = process.env['HOME'];
  process.env['HOME'] = tmp;
  vi.restoreAllMocks();
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
  writeFileSync(bin, '#!/bin/sh\nexit 0\n');
  chmodSync(bin, 0o755);
  return dir;
}

function fakeProbeOk(binaryPath: string): typeof import('../../../src/services/companion/cc-connect-resolver.js').probeCcConnect {
  return (async () => ({ binaryPath, version: '1.3.2', ok: true, error: null, resolvedSource: 'node-modules' as const })) as unknown as typeof import('../../../src/services/companion/cc-connect-resolver.js').probeCcConnect;
}

function noopSpawn(_b: string, _a: readonly string[]) {
  return { kill: () => {}, pid: 12345 };
}

async function noopStart() {
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

const SAMPLE_PAYLOAD = 'ilink://peaks-cli?project=team-bot';
const CLAUDE_CODE_PRESENT_ENV = { CLAUDE_CODE: '1' } as NodeJS.ProcessEnv;
const CLAUDE_CODE_ABSENT_ENV = {} as NodeJS.ProcessEnv;

describe('unicodeBlockQrRenderer', () => {
  it('emits at least one half/full-block character for a non-empty payload', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await unicodeBlockQrRenderer(SAMPLE_PAYLOAD);
    const combined = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    // The renderer must use one of the half-block or full-block chars.
    expect(combined).toMatch(/[█▀▄▌▐]/);
    // And it should NOT be empty (i.e. it actually drew something).
    expect(combined.length).toBeGreaterThan(0);
  });

  it('writes only to stdout (does not throw)', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await expect(unicodeBlockQrRenderer(SAMPLE_PAYLOAD)).resolves.toBeUndefined();
    expect(writeSpy).toHaveBeenCalled();
  });

  it('produces output with multiple QR rows (at least 5 newlines for a typical QR)', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await unicodeBlockQrRenderer(SAMPLE_PAYLOAD);
    const combined = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    // A typical versioned QR for a small iLink URL has >=10 rows; we
    // assert a conservative lower bound to avoid being brittle.
    expect((combined.match(/\n/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});

describe('inlineQrRenderer', () => {
  it('emits a markdown image line with a data: URL containing valid base64 PNG', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await inlineQrRenderer(SAMPLE_PAYLOAD);
    const combined = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    // Expect the markdown image shape: ![QR code](data:image/png;base64,<b64>)
    expect(combined).toMatch(/^!\[QR code\]\(data:image\/png;base64,[A-Za-z0-9+/=]+\)/);
    // Capture the base64 payload and decode it; it should be a PNG
    // (starts with the PNG magic bytes 0x89 0x50 0x4e 0x47).
    const match = /base64,([A-Za-z0-9+/=]+)/.exec(combined);
    expect(match).not.toBeNull();
    if (match === null) return;
    const decoded = Buffer.from(match[1] ?? '', 'base64');
    expect(decoded.length).toBeGreaterThan(0);
    expect(decoded[0]).toBe(0x89);
    expect(decoded[1]).toBe(0x50);
    expect(decoded[2]).toBe(0x4e);
    expect(decoded[3]).toBe(0x47);
  });

  it('emits a trailing newline so the markdown line is complete', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await inlineQrRenderer(SAMPLE_PAYLOAD);
    const combined = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(combined.endsWith('\n')).toBe(true);
  });

  it('does NOT produce any line that matches the iLink URL capture regex', async () => {
    // R5: the pipe-mode stdout scanner regex `iLink URL:\s*(\S+)`
    // must NOT match the base64 data URL. The base64 charset is
    // A-Za-z0-9+/= only (no `:`, no ` `), so this is a structural
    // invariant — assert it explicitly so future changes do not
    // accidentally break it.
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await inlineQrRenderer(SAMPLE_PAYLOAD);
    const combined = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    const regex = /iLink URL:\s*(\S+)/i;
    expect(regex.test(combined)).toBe(false);
  });
});

describe('asciiQrRenderer', () => {
  it('is a callable function and writes to stdout', async () => {
    expect(typeof asciiQrRenderer).toBe('function');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await expect(asciiQrRenderer(SAMPLE_PAYLOAD)).resolves.toBeUndefined();
    expect(writeSpy).toHaveBeenCalled();
  });
});

describe('detectClaudeCodeEnv', () => {
  it('returns true when CLAUDE_CODE is set', () => {
    expect(detectClaudeCodeEnv({ CLAUDE_CODE: '1' })).toBe(true);
  });

  it('returns true when CLAUDE_CODE_ENTRYPOINT is set', () => {
    expect(detectClaudeCodeEnv({ CLAUDE_CODE_ENTRYPOINT: 'cli' })).toBe(true);
  });

  it('returns false when neither marker is set', () => {
    expect(detectClaudeCodeEnv({})).toBe(false);
  });

  it('returns false for empty values', () => {
    expect(detectClaudeCodeEnv({ CLAUDE_CODE: '' })).toBe(false);
    expect(detectClaudeCodeEnv({ CLAUDE_CODE_ENTRYPOINT: '' })).toBe(false);
  });
});

describe('resolveQrRenderer', () => {
  it('returns inlineQrRenderer when --qr-inline is true (flag > env)', () => {
    const renderer = resolveQrRenderer({ qrInline: true, env: CLAUDE_CODE_ABSENT_ENV });
    expect(renderer).toBe(inlineQrRenderer);
  });

  it('returns asciiQrRenderer when --qr-ascii is true (flag > env)', () => {
    const renderer = resolveQrRenderer({ qrAscii: true, env: CLAUDE_CODE_ABSENT_ENV });
    expect(renderer).toBe(asciiQrRenderer);
  });

  it('returns inlineQrRenderer when CLAUDE_CODE env is set and no flag is supplied', () => {
    const renderer = resolveQrRenderer({ env: CLAUDE_CODE_PRESENT_ENV });
    expect(renderer).toBe(inlineQrRenderer);
  });

  it('returns unicodeBlockQrRenderer as the TTY default (no flag, no env)', () => {
    const renderer = resolveQrRenderer({ env: CLAUDE_CODE_ABSENT_ENV });
    expect(renderer).toBe(unicodeBlockQrRenderer);
  });

  it('--qr-inline overrides CLAUDE_CODE env (flag > env)', () => {
    const renderer = resolveQrRenderer({ qrInline: true, env: CLAUDE_CODE_PRESENT_ENV });
    expect(renderer).toBe(inlineQrRenderer);
  });

  it('--qr-ascii overrides CLAUDE_CODE env (flag > env)', () => {
    const renderer = resolveQrRenderer({ qrAscii: true, env: CLAUDE_CODE_PRESENT_ENV });
    expect(renderer).toBe(asciiQrRenderer);
  });

  it('--qr-inline takes precedence over --qr-ascii when both are set', () => {
    const renderer = resolveQrRenderer({ qrInline: true, qrAscii: true, env: CLAUDE_CODE_ABSENT_ENV });
    expect(renderer).toBe(inlineQrRenderer);
  });

  it('falls back to process.env when no env is supplied (default)', () => {
    // Clear process-level CLAUDE_CODE so the fallback default is unicode-block.
    const previous = process.env['CLAUDE_CODE'];
    const previousEntrypoint = process.env['CLAUDE_CODE_ENTRYPOINT'];
    delete process.env['CLAUDE_CODE'];
    delete process.env['CLAUDE_CODE_ENTRYPOINT'];
    try {
      const renderer = resolveQrRenderer({});
      expect(renderer).toBe(unicodeBlockQrRenderer);
    } finally {
      if (previous !== undefined) process.env['CLAUDE_CODE'] = previous;
      if (previousEntrypoint !== undefined) process.env['CLAUDE_CODE_ENTRYPOINT'] = previousEntrypoint;
    }
  });

  it('reads process.env CLAUDE_CODE when no env override is supplied', () => {
    const previous = process.env['CLAUDE_CODE'];
    const previousEntrypoint = process.env['CLAUDE_CODE_ENTRYPOINT'];
    delete process.env['CLAUDE_CODE_ENTRYPOINT'];
    process.env['CLAUDE_CODE'] = '1';
    try {
      const renderer = resolveQrRenderer({});
      expect(renderer).toBe(inlineQrRenderer);
    } finally {
      if (previous === undefined) {
        delete process.env['CLAUDE_CODE'];
      } else {
        process.env['CLAUDE_CODE'] = previous;
      }
      if (previousEntrypoint !== undefined) process.env['CLAUDE_CODE_ENTRYPOINT'] = previousEntrypoint;
    }
  });
});

describe('runCompanionSetup — renderer integration', () => {
  it('Path B (bindToken) bypasses the resolver-selected renderer entirely', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      // No custom qrRenderer; runCompanionSetup must consult
      // resolveQrRenderer, but bindToken must short-circuit BEFORE
      // the renderer is invoked.
      qrInline: true, // would otherwise pick inlineQrRenderer
      env: {}, // would otherwise pick unicodeBlockQrRenderer
      bindToken: 'real-bot@im.bot:real-secret',
      bindRunner: async () => ({ ok: true, bound: true, error: null }),
      spawnSetup: noopSpawn,
      start: noopStart,
      stateReader: () => ({ statePath: '', mtimeMs: 0, state: 'logged-in' as const, accountId: null, lastLogin: null, error: null })
    });
    expect(state.error).toBeNull();
    expect(state.bound).toBe(true);
    expect(state.qrRendered).toBe(false);
  });

  it('renderer failure surfaces state.error and state.nextActions', async () => {
    const dir = dropFakeBinary();
    const bin = join(dir, 'cc-connect');
    const state = await runCompanionSetup({
      home: tmp,
      probe: fakeProbeOk(bin),
      qrRenderer: async () => { throw new Error('iLink backend unreachable'); },
      spawnSetup: noopSpawn,
      start: noopStart,
      stateReader: () => ({ statePath: '', mtimeMs: 0, state: 'unknown' as const, accountId: null, lastLogin: null, error: null })
    });
    expect(state.qrRendered).toBe(false);
    expect(state.error).toMatch(/QR render failed/);
    expect(state.error).toMatch(/iLink backend unreachable/);
    expect(state.nextActions.length).toBeGreaterThan(0);
  });
});

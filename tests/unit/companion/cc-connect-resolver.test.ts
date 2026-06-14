import { mkdtempSync, rmSync, writeFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CC_CONNECT_BINARY_NAME,
  defaultSpawnVersion,
  parseVersionOutput,
  probeCcConnect,
  resolveCcConnectBinary,
  type SpawnVersionFn
} from '../../../src/services/companion/cc-connect-resolver.js';

let tmp: string;
const IS_WIN = process.platform === 'win32';

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'peaks-cc-resolver-'));
});

afterEach(() => {
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('resolveCcConnectBinary', () => {
  it('returns null when PATH is empty', () => {
    expect(resolveCcConnectBinary('', 'linux')).toBeNull();
  });

  it('returns null when no candidate exists', () => {
    expect(resolveCcConnectBinary(`/no/such/dir${delimiter}/also/missing`, 'linux')).toBeNull();
  });

  it('finds the binary on PATH', () => {
    const dir = join(tmp, 'bin');
    mkdirSync(dir, { recursive: true });
    const bin = join(dir, CC_CONNECT_BINARY_NAME);
    writeFileSync(bin, '#!/bin/sh\necho ok\n');
    chmodSync(bin, 0o755);
    expect(resolveCcConnectBinary(dir, 'linux')).toBe(bin);
  });

  it('returns the first hit when multiple dirs contain the binary', () => {
    const a = join(tmp, 'a');
    const b = join(tmp, 'b');
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    const first = join(a, CC_CONNECT_BINARY_NAME);
    const second = join(b, CC_CONNECT_BINARY_NAME);
    writeFileSync(first, '#!/bin/sh\n');
    writeFileSync(second, '#!/bin/sh\n');
    chmodSync(first, 0o755);
    chmodSync(second, 0o755);
    expect(resolveCcConnectBinary(`${a}${delimiter}${b}`, 'linux')).toBe(first);
  });

  it('on win32 consults PATHEXT to find .exe candidates', () => {
    if (!IS_WIN) return;
    const dir = join(tmp, 'win');
    mkdirSync(dir, { recursive: true });
    const bin = join(dir, `${CC_CONNECT_BINARY_NAME}.EXE`);
    writeFileSync(bin, 'binary');
    const result = resolveCcConnectBinary(dir, 'win32');
    expect(result).toBe(bin);
  });
});

describe('parseVersionOutput', () => {
  it('parses a plain "cc-connect 1.3.2" line', () => {
    expect(parseVersionOutput('cc-connect 1.3.2\n')).toBe('1.3.2');
  });

  it('parses a "v"-prefixed line', () => {
    expect(parseVersionOutput('cc-connect v1.3.2-beta.1\n')).toBe('1.3.2-beta.1');
  });

  it('parses a non-prefixed multi-line output', () => {
    expect(parseVersionOutput('Some header\ncc-connect 2.0.0\n')).toBe('2.0.0');
  });

  it('returns null for empty input', () => {
    expect(parseVersionOutput('')).toBeNull();
  });

  it('returns null when no version line is present', () => {
    expect(parseVersionOutput('hello world\n')).toBeNull();
  });

  it('returns null for a malformed version (missing patch)', () => {
    expect(parseVersionOutput('cc-connect 1.3\n')).toBeNull();
  });
});

describe('probeCcConnect', () => {
  it('returns ok=false when the binary is not on PATH', async () => {
    const result = await probeCcConnect({ pathEnv: '/no/such/dir' });
    expect(result.ok).toBe(false);
    expect(result.binaryPath).toBeNull();
    expect(result.error).toMatch(/not found/);
  });

  it('returns ok=true with version when spawn succeeds', async () => {
    const dir = join(tmp, 'p');
    mkdirSync(dir, { recursive: true });
    const bin = join(dir, CC_CONNECT_BINARY_NAME);
    writeFileSync(bin, '#!/bin/sh\necho cc-connect 1.3.2\n');
    chmodSync(bin, 0o755);
    const fakeSpawn: SpawnVersionFn = async () => ({ stdout: 'cc-connect 1.3.2\n', stderr: '', code: 0 });
    const result = await probeCcConnect({ pathEnv: dir, spawnFn: fakeSpawn });
    expect(result.ok).toBe(true);
    expect(result.binaryPath).toBe(bin);
    expect(result.version).toBe('1.3.2');
  });

  it('returns ok=false with stderr message when spawn exits non-zero', async () => {
    const dir = join(tmp, 'q');
    mkdirSync(dir, { recursive: true });
    const bin = join(dir, CC_CONNECT_BINARY_NAME);
    writeFileSync(bin, '#!/bin/sh\nexit 2\n');
    chmodSync(bin, 0o755);
    const fakeSpawn: SpawnVersionFn = async () => ({ stdout: '', stderr: 'boom', code: 2 });
    const result = await probeCcConnect({ pathEnv: dir, spawnFn: fakeSpawn });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('boom');
    expect(result.binaryPath).toBe(bin);
  });

  it('returns ok=false when --version output cannot be parsed', async () => {
    const dir = join(tmp, 'r');
    mkdirSync(dir, { recursive: true });
    const bin = join(dir, CC_CONNECT_BINARY_NAME);
    writeFileSync(bin, '#!/bin/sh\n');
    chmodSync(bin, 0o755);
    const fakeSpawn: SpawnVersionFn = async () => ({ stdout: 'nope', stderr: '', code: 0 });
    const result = await probeCcConnect({ pathEnv: dir, spawnFn: fakeSpawn });
    expect(result.ok).toBe(false);
    expect(result.version).toBeNull();
    expect(result.error).toMatch(/parse --version/);
  });

  it('skipSpawn returns ok=true with binary path and null version', async () => {
    const dir = join(tmp, 's');
    mkdirSync(dir, { recursive: true });
    const bin = join(dir, CC_CONNECT_BINARY_NAME);
    writeFileSync(bin, '#!/bin/sh\n');
    chmodSync(bin, 0o755);
    const result = await probeCcConnect({ pathEnv: dir, skipSpawn: true });
    expect(result.ok).toBe(true);
    expect(result.binaryPath).toBe(bin);
    expect(result.version).toBeNull();
  });

  it('defaultSpawnVersion error path is exposed (smoke)', async () => {
    // Calling defaultSpawnVersion on a missing path resolves to code -1 + error message.
    // We do not assume any real spawn exists.
    const result = await defaultSpawnVersion('/no/such/binary', ['--version']);
    expect(result.code).toBe(-1);
    expect(result.stdout).toBe('');
    expect(typeof result.stderr).toBe('string');
  });
});

import { mkdtempSync, rmSync, writeFileSync, existsSync, chmodSync, mkdirSync, writeFileSync as wfs, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CC_CONNECT_BINARY_NAME,
  CC_CONNECT_NPM_PACKAGE,
  defaultSpawnVersion,
  parseVersionOutput,
  probeCcConnect,
  resolveCcConnectAny,
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

describe.skipIf(process.platform === 'win32')('resolveCcConnectBinary (PATH walk, legacy)', () => {
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

describe.skipIf(process.platform === 'win32')('resolveCcConnectAny (node_modules → require.resolve → PATH)', () => {
  function makeFakeNodeModulesBin(cwd: string, version = '1.3.2'): { binPath: string; pkgDir: string } {
    const pkgDir = join(cwd, 'node_modules', CC_CONNECT_NPM_PACKAGE);
    mkdirSync(pkgDir, { recursive: true });
    const binDir = join(cwd, 'node_modules', '.bin');
    mkdirSync(binDir, { recursive: true });
    const binPath = join(binDir, CC_CONNECT_BINARY_NAME);
    writeFileSync(binPath, `#!/bin/sh\necho "cc-connect ${version}"\n`);
    chmodSync(binPath, 0o755);
    // also write a package.json with a bin entry for the require.resolve path
    wfs(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: CC_CONNECT_NPM_PACKAGE, version, bin: { [CC_CONNECT_BINARY_NAME]: 'run.js' } })
    );
    writeFileSync(join(pkgDir, 'run.js'), '#!/usr/bin/env node\nconsole.log("cc-connect ' + version + '");\n');
    return { binPath, pkgDir };
  }

  it('prefers node_modules/.bin/cc-connect when present (source=node-modules)', () => {
    const cwd = join(tmp, 'with-bins');
    mkdirSync(cwd, { recursive: true });
    const { binPath } = makeFakeNodeModulesBin(cwd);
    // also add a stale PATH candidate — node_modules must win.
    const pathDir = join(tmp, 'path-dir');
    mkdirSync(pathDir, { recursive: true });
    const pathBin = join(pathDir, CC_CONNECT_BINARY_NAME);
    writeFileSync(pathBin, '#!/bin/sh\n');
    chmodSync(pathBin, 0o755);
    const result = resolveCcConnectAny({ cwd, pathEnv: pathDir });
    expect(result).not.toBeNull();
    expect(result?.binaryPath).toBe(binPath);
    expect(result?.source).toBe('node-modules');
  });

  it('falls back to require.resolve bin when no .bin shim exists (source=node-modules)', () => {
    const cwd = join(tmp, 'no-bin-shim');
    mkdirSync(cwd, { recursive: true });
    // We *don't* put anything in node_modules/.bin — only the package
    // directory with a real package.json + bin file. require.resolve
    // should still find the bin via package.json#bin.
    const pkgDir = join(cwd, 'node_modules', CC_CONNECT_NPM_PACKAGE);
    mkdirSync(pkgDir, { recursive: true });
    const binFile = join(pkgDir, 'run.js');
    writeFileSync(binFile, '#!/usr/bin/env node\n');
    wfs(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: CC_CONNECT_NPM_PACKAGE, version: '1.3.2', bin: { [CC_CONNECT_BINARY_NAME]: 'run.js' } })
    );
    const result = resolveCcConnectAny({ cwd, pathEnv: '/no/such/dir' });
    expect(result).not.toBeNull();
    expect(result?.source).toBe('node-modules');
    // require.resolve may canonicalize /tmp → /private/tmp on macOS;
    // use realpathSync to compare.
    expect(result?.binaryPath).toBe(realpathSync(binFile));
  });

  it('falls back to PATH when no node_modules entry exists (source=path)', () => {
    const cwd = join(tmp, 'no-node-modules');
    mkdirSync(cwd, { recursive: true });
    const pathDir = join(tmp, 'p');
    mkdirSync(pathDir, { recursive: true });
    const pathBin = join(pathDir, CC_CONNECT_BINARY_NAME);
    writeFileSync(pathBin, '#!/bin/sh\n');
    chmodSync(pathBin, 0o755);
    const result = resolveCcConnectAny({ cwd, pathEnv: pathDir });
    expect(result).not.toBeNull();
    expect(result?.binaryPath).toBe(pathBin);
    expect(result?.source).toBe('path');
  });

  it('returns null when nothing resolves', () => {
    const cwd = join(tmp, 'empty');
    mkdirSync(cwd, { recursive: true });
    const result = resolveCcConnectAny({ cwd, pathEnv: '/no/such/dir' });
    expect(result).toBeNull();
  });
});

describe.skipIf(process.platform === 'win32')('parseVersionOutput', () => {
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

describe.skipIf(process.platform === 'win32')('probeCcConnect', () => {
  it('returns ok=false when the binary is not on PATH and not in node_modules', async () => {
    const cwd = join(tmp, 'nothing');
    mkdirSync(cwd, { recursive: true });
    const result = await probeCcConnect({ cwd, pathEnv: '/no/such/dir' });
    expect(result.ok).toBe(false);
    expect(result.binaryPath).toBeNull();
    expect(result.resolvedSource).toBeNull();
    expect(result.error).toMatch(/not found/);
  });

  it('resolves from node_modules and reports resolvedSource=node-modules', async () => {
    const cwd = join(tmp, 'with-bins-probe');
    mkdirSync(cwd, { recursive: true });
    const pkgDir = join(cwd, 'node_modules', CC_CONNECT_NPM_PACKAGE);
    mkdirSync(pkgDir, { recursive: true });
    const binFile = join(pkgDir, 'run.js');
    writeFileSync(binFile, '#!/usr/bin/env node\n');
    wfs(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: CC_CONNECT_NPM_PACKAGE, version: '1.3.2', bin: { [CC_CONNECT_BINARY_NAME]: 'run.js' } })
    );
    const fakeSpawn: SpawnVersionFn = async () => ({ stdout: 'cc-connect 1.3.2\n', stderr: '', code: 0 });
    const result = await probeCcConnect({ cwd, pathEnv: '/no/such/dir', spawnFn: fakeSpawn });
    expect(result.ok).toBe(true);
    expect(result.binaryPath).toBe(realpathSync(binFile));
    expect(result.version).toBe('1.3.2');
    expect(result.resolvedSource).toBe('node-modules');
  });

  it('returns ok=true with version when spawn succeeds (PATH legacy)', async () => {
    const cwd = join(tmp, 'no-node-modules-probe');
    mkdirSync(cwd, { recursive: true });
    const dir = join(tmp, 'p');
    mkdirSync(dir, { recursive: true });
    const bin = join(dir, CC_CONNECT_BINARY_NAME);
    writeFileSync(bin, '#!/bin/sh\necho cc-connect 1.3.2\n');
    chmodSync(bin, 0o755);
    const fakeSpawn: SpawnVersionFn = async () => ({ stdout: 'cc-connect 1.3.2\n', stderr: '', code: 0 });
    const result = await probeCcConnect({ cwd, pathEnv: dir, spawnFn: fakeSpawn });
    expect(result.ok).toBe(true);
    expect(result.binaryPath).toBe(bin);
    expect(result.version).toBe('1.3.2');
    expect(result.resolvedSource).toBe('path');
  });

  it('returns ok=false with stderr message when spawn exits non-zero', async () => {
    const cwd = join(tmp, 'no-nm-probe-fail');
    mkdirSync(cwd, { recursive: true });
    const dir = join(tmp, 'q');
    mkdirSync(dir, { recursive: true });
    const bin = join(dir, CC_CONNECT_BINARY_NAME);
    writeFileSync(bin, '#!/bin/sh\nexit 2\n');
    chmodSync(bin, 0o755);
    const fakeSpawn: SpawnVersionFn = async () => ({ stdout: '', stderr: 'boom', code: 2 });
    const result = await probeCcConnect({ cwd, pathEnv: dir, spawnFn: fakeSpawn });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('boom');
    expect(result.binaryPath).toBe(bin);
    expect(result.resolvedSource).toBe('path');
  });

  it('returns ok=false when --version output cannot be parsed', async () => {
    const cwd = join(tmp, 'no-nm-probe-parse');
    mkdirSync(cwd, { recursive: true });
    const dir = join(tmp, 'r');
    mkdirSync(dir, { recursive: true });
    const bin = join(dir, CC_CONNECT_BINARY_NAME);
    writeFileSync(bin, '#!/bin/sh\n');
    chmodSync(bin, 0o755);
    const fakeSpawn: SpawnVersionFn = async () => ({ stdout: 'nope', stderr: '', code: 0 });
    const result = await probeCcConnect({ cwd, pathEnv: dir, spawnFn: fakeSpawn });
    expect(result.ok).toBe(false);
    expect(result.version).toBeNull();
    expect(result.error).toMatch(/parse --version/);
  });

  it('skipSpawn returns ok=true with binary path and null version', async () => {
    const cwd = join(tmp, 'no-nm-skip-spawn');
    mkdirSync(cwd, { recursive: true });
    const dir = join(tmp, 's');
    mkdirSync(dir, { recursive: true });
    const bin = join(dir, CC_CONNECT_BINARY_NAME);
    writeFileSync(bin, '#!/bin/sh\n');
    chmodSync(bin, 0o755);
    const result = await probeCcConnect({ cwd, pathEnv: dir, skipSpawn: true });
    expect(result.ok).toBe(true);
    expect(result.binaryPath).toBe(bin);
    expect(result.version).toBeNull();
    expect(result.resolvedSource).toBe('path');
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

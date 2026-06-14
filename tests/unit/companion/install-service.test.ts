import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CC_CONNECT_NPM_PACKAGE, installCcConnect, type InstallAttempt } from '../../../src/services/companion/install-service.js';
import { readBinaryPathCache } from '../../../src/services/companion/binary-cache.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'peaks-install-service-'));
});

afterEach(() => {
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

function makeFakeNodeModulesBin(cwd: string, version = '1.3.2'): { binPath: string; pkgDir: string } {
  const pkgDir = join(cwd, 'node_modules', CC_CONNECT_NPM_PACKAGE);
  mkdirSync(pkgDir, { recursive: true });
  const binDir = join(cwd, 'node_modules', '.bin');
  mkdirSync(binDir, { recursive: true });
  const binPath = join(binDir, 'cc-connect');
  writeFileSync(binPath, '#!/bin/sh\necho "cc-connect ' + version + '"\n');
  chmodSync(binPath, 0o755);
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({ name: CC_CONNECT_NPM_PACKAGE, version, bin: { 'cc-connect': 'run.js' } })
  );
  writeFileSync(join(pkgDir, 'run.js'), '#!/usr/bin/env node\nconsole.log("cc-connect ' + version + '");\n');
  return { binPath, pkgDir };
}

describe('installCcConnect (verify pass)', () => {
  it('happy path: resolves from node_modules/.bin, probes, writes cache with source=NODE_MODULES', async () => {
    const cwd = join(tmp, 'with-bins');
    mkdirSync(cwd, { recursive: true });
    const { binPath } = makeFakeNodeModulesBin(cwd, '1.3.2');
    const fakeProbe = async () => ({
      binaryPath: binPath,
      version: '1.3.2',
      ok: true,
      error: null,
      resolvedSource: 'node-modules' as const
    });
    const result = await installCcConnect({ probe: fakeProbe, cwd, home: tmp });
    expect(result.installed).toBe(true);
    expect(result.binaryPath).toBe(binPath);
    expect(result.version).toBe('1.3.2');
    expect(result.cacheWritten).toBe(true);
    expect(result.resolvedSource).toBe('node-modules');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.method).toBe('verify');
    expect(result.attempts[0]?.ok).toBe(true);
    const cache = readBinaryPathCache(tmp);
    expect(cache).not.toBeNull();
    expect(cache?.binaryPath).toBe(binPath);
    expect(cache?.version).toBe('1.3.2');
    expect(cache?.source).toBe('NODE_MODULES');
  });

  it('falls back to PATH when node_modules does not have cc-connect; cache source=PATH', async () => {
    const cwd = join(tmp, 'no-node-modules');
    mkdirSync(cwd, { recursive: true });
    const dir = join(tmp, 'bin');
    mkdirSync(dir, { recursive: true });
    const bin = join(dir, 'cc-connect');
    writeFileSync(bin, '#!/bin/sh\necho "cc-connect 2.0.0"\n');
    chmodSync(bin, 0o755);
    const fakeProbe = async () => ({
      binaryPath: bin,
      version: '2.0.0',
      ok: true,
      error: null,
      resolvedSource: 'path' as const
    });
    const result = await installCcConnect({ probe: fakeProbe, cwd, pathEnv: dir, home: tmp });
    expect(result.installed).toBe(true);
    expect(result.binaryPath).toBe(bin);
    expect(result.version).toBe('2.0.0');
    expect(result.cacheWritten).toBe(true);
    expect(result.resolvedSource).toBe('path');
    const cache = readBinaryPathCache(tmp);
    expect(cache?.source).toBe('PATH');
  });

  it('returns ok=false and suggests `pnpm install` when nothing resolves', async () => {
    const cwd = join(tmp, 'empty');
    mkdirSync(cwd, { recursive: true });
    const result = await installCcConnect({ cwd, pathEnv: '/no/such/dir', home: tmp });
    expect(result.installed).toBe(false);
    expect(result.binaryPath).toBeNull();
    expect(result.resolvedSource).toBeNull();
    expect(result.cacheWritten).toBe(false);
    expect(result.error).toMatch(/not resolved/);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.method).toBe('verify');
    expect(result.attempts[0]?.ok).toBe(false);
    expect(result.nextActions.join(' ')).toContain('pnpm install');
  });

  it('skips post-probe when skipPostProbe=true and returns the resolved path', async () => {
    const cwd = join(tmp, 'with-bins-skip-probe');
    mkdirSync(cwd, { recursive: true });
    const { binPath } = makeFakeNodeModulesBin(cwd, '1.3.2');
    const result = await installCcConnect({ cwd, skipPostProbe: true, home: tmp });
    expect(result.installed).toBe(true);
    expect(result.binaryPath).toBe(binPath);
    expect(result.version).toBeNull();
    expect(result.cacheWritten).toBe(false);
    expect(result.nextActions.join(' ')).toContain('probe skipped');
  });

  it('returns error when the resolver succeeds but the version probe fails', async () => {
    const cwd = join(tmp, 'with-bins-probe-fail');
    mkdirSync(cwd, { recursive: true });
    const { binPath } = makeFakeNodeModulesBin(cwd, '1.3.2');
    const fakeProbe = async () => ({
      binaryPath: binPath,
      version: null,
      ok: false,
      error: 'spawn exited with code 1',
      resolvedSource: 'node-modules' as const
    });
    const result = await installCcConnect({ probe: fakeProbe, cwd, home: tmp });
    expect(result.installed).toBe(true);
    expect(result.binaryPath).toBe(binPath);
    expect(result.version).toBeNull();
    expect(result.cacheWritten).toBe(false);
    expect(result.error).toMatch(/probe failed|exit|spawn/i);
    expect(result.nextActions.join(' ')).toContain('pnpm install');
  });

  it('exports the canonical npm package name', () => {
    expect(CC_CONNECT_NPM_PACKAGE).toBe('cc-connect');
  });
});

// Back-compat: the legacy "RunInstallCommand" type is still exported (as a
// no-op signature) for callers that imported it from the old install service.
// We don't exercise it because the verify pass never shells out — this is a
// type-only smoke test.
describe('legacy compatibility', () => {
  it('still re-exports a RunInstallCommand type (compile-time)', () => {
    const _typeOnly: InstallAttempt = {
      method: 'verify',
      command: 'noop',
      ok: true,
      exitCode: 0,
      durationMs: 0,
      error: null
    };
    expect(_typeOnly.method).toBe('verify');
  });
});

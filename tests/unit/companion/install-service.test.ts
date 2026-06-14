import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CC_CONNECT_NPM_PACKAGE,
  installCcConnect,
  type RunInstallCommand
} from '../../../src/services/companion/install-service.js';
import { readBinaryPathCache } from '../../../src/services/companion/binary-cache.js';

type FakeAttempt = { code: number; stderr?: string };
function fakeRunnerFromSequence(seq: FakeAttempt[]): RunInstallCommand {
  let i = 0;
  return async (_method, _command, _args) => {
    const next = seq[i] ?? seq[seq.length - 1] ?? { code: 0 };
    i += 1;
    return { code: next.code, stdout: '', stderr: next.stderr ?? '', durationMs: 1 };
  };
}

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'peaks-install-service-'));
});

afterEach(() => {
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe('installCcConnect', () => {
  it('returns ok=true with cache written when npm install succeeds and probe resolves', async () => {
    const dir = join(tmp, 'bin');
    mkdirSync(dir, { recursive: true });
    const bin = join(dir, 'cc-connect');
    writeFileSync(bin, '#!/bin/sh\necho "cc-connect 1.3.2"\n');
    chmodSync(bin, 0o755);
    const runner = fakeRunnerFromSequence([{ code: 0 }]);
    const result = await installCcConnect({ runCommand: runner, pathEnv: dir, home: tmp });
    expect(result.installed).toBe(true);
    expect(result.binaryPath).toBe(bin);
    expect(result.version).toBe('1.3.2');
    expect(result.cacheWritten).toBe(true);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.method).toBe('npm');
    expect(result.attempts[0]?.ok).toBe(true);
    const cache = readBinaryPathCache(tmp);
    expect(cache).not.toBeNull();
    expect(cache?.binaryPath).toBe(bin);
    expect(cache?.version).toBe('1.3.2');
    expect(cache?.source).toBe('INSTALL');
  });

  it('falls back to brew when npm fails and brew succeeds', async () => {
    const dir = join(tmp, 'bin');
    mkdirSync(dir, { recursive: true });
    const bin = join(dir, 'cc-connect');
    writeFileSync(bin, '#!/bin/sh\necho "cc-connect 2.0.0"\n');
    chmodSync(bin, 0o755);
    const runner = fakeRunnerFromSequence([{ code: 1, stderr: 'no perm' }, { code: 0 }]);
    const result = await installCcConnect({ runCommand: runner, pathEnv: dir, home: tmp });
    expect(result.installed).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.method).toBe('npm');
    expect(result.attempts[0]?.ok).toBe(false);
    expect(result.attempts[1]?.method).toBe('brew');
    expect(result.attempts[1]?.ok).toBe(true);
    expect(result.binaryPath).toBe(bin);
    expect(result.version).toBe('2.0.0');
  });

  it('uses preferBrew to swap the order (brew then npm)', async () => {
    const dir = join(tmp, 'bin');
    mkdirSync(dir, { recursive: true });
    const bin = join(dir, 'cc-connect');
    writeFileSync(bin, '#!/bin/sh\necho "cc-connect 1.0.0"\n');
    chmodSync(bin, 0o755);
    const runner = fakeRunnerFromSequence([{ code: 0 }]);
    const result = await installCcConnect({ runCommand: runner, pathEnv: dir, preferBrew: true, home: tmp });
    expect(result.attempts[0]?.method).toBe('brew');
    expect(result.attempts[0]?.ok).toBe(true);
    expect(result.attempts).toHaveLength(1);
  });

  it('returns ok=false and an error when both methods fail', async () => {
    const runner = fakeRunnerFromSequence([{ code: 1, stderr: 'npm down' }, { code: 1, stderr: 'brew down' }]);
    const result = await installCcConnect({ runCommand: runner });
    expect(result.installed).toBe(false);
    expect(result.binaryPath).toBeNull();
    expect(result.error).toMatch(/all install attempts failed/);
    expect(result.nextActions.length).toBeGreaterThan(0);
  });

  it('passes a versioned package spec when --version is provided', async () => {
    const dir = join(tmp, 'bin');
    mkdirSync(dir, { recursive: true });
    const bin = join(dir, 'cc-connect');
    writeFileSync(bin, '#!/bin/sh\necho "cc-connect 1.2.3"\n');
    chmodSync(bin, 0o755);
    const runner = fakeRunnerFromSequence([{ code: 0 }]);
    const result = await installCcConnect({ runCommand: runner, pathEnv: dir, version: '1.2.3', home: tmp });
    expect(result.attempts[0]?.command).toContain('cc-connect@1.2.3');
  });

  it('skips post-probe when skipPostProbe=true', async () => {
    const runner = fakeRunnerFromSequence([{ code: 0 }]);
    const result = await installCcConnect({ runCommand: runner, skipPostProbe: true });
    expect(result.installed).toBe(true);
    expect(result.binaryPath).toBeNull();
    expect(result.version).toBeNull();
    expect(result.cacheWritten).toBe(false);
    expect(result.nextActions.join(' ')).toContain('probe skipped');
  });

  it('reports an error when the install succeeded but the binary is not on PATH', async () => {
    const runner = fakeRunnerFromSequence([{ code: 0 }]);
    const result = await installCcConnect({ runCommand: runner, pathEnv: '/no/such/dir' });
    expect(result.installed).toBe(true);
    expect(result.binaryPath).toBeNull();
    expect(result.error).toMatch(/PATH/);
  });

  it('exports the canonical npm package name', () => {
    expect(CC_CONNECT_NPM_PACKAGE).toBe('cc-connect');
  });
});

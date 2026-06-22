/**
 * BUG 2026-06-14-cc-connect-weixin#8: tests for the manual ilink
 * token injection path. Covers:
 *
 *   - `bindWeixinToken` builds the right cc-connect argv
 *     (`weixin bind --project <p> --token <bearer>` plus the
 *     optional flags) and surfaces the success / failure contract.
 *   - `readBoundToken` masks the bearer by default and reveals
 *     the raw bearer only when `reveal: true` is set.
 *   - `validateBearer` rejects empty / whitespace / oversized
 *     inputs (cheap fail-fast on the CLI surface).
 *   - The strict post-condition (re-read the config file after
 *     cc-connect exits 0) is enforced: a missing or unchanged
 *     `token = "..."` line is treated as a bind failure even
 *     when cc-connect's exit code is 0.
 */
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bindWeixinToken,
  defaultBindSpawn,
  readBoundToken,
  readBoundTokenFromDisk,
  validateBearer
} from '../../../src/services/companion/bind-service.js';
import type { BindSpawnFn, BindSpawnResult } from '../../../src/services/companion/bind-service.js';
import { resolveCcConnectAny } from '../../../src/services/companion/cc-connect-resolver.js';

let tmp: string;
let previousHome: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'peaks-bind-'));
  previousHome = process.env['HOME'];
  process.env['HOME'] = tmp;
});

afterEach(() => {
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  process.env['HOME'] = previousHome;
  vi.restoreAllMocks();
});

/** Write a fake config.toml to ~/.cc-connect/ with a token line. */
function writeFakeConfig(home: string, body: string): string {
  const dir = join(home, '.cc-connect');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'config.toml');
  writeFileSync(file, body, 'utf8');
  return file;
}

/** Fake cc-connect resolver that always returns a fixed path. */
function fakeResolveOk(binaryPath: string): typeof resolveCcConnectAny {
  return () => ({ binaryPath, source: 'node-modules' as const });
}

/** Fake cc-connect resolver that returns null (binary missing). */
function fakeResolveNull(): typeof resolveCcConnectAny {
  return () => null;
}

/** Capture the args passed to the spawn factory. */
function capturingSpawn(
  response: BindSpawnResult
): { calls: Array<{ binaryPath: string; args: readonly string[] }>; spawn: BindSpawnFn } {
  const calls: Array<{ binaryPath: string; args: readonly string[] }> = [];
  const spawn: BindSpawnFn = async (binaryPath, args) => {
    calls.push({ binaryPath, args });
    return response;
  };
  return { calls, spawn };
}

describe.skipIf(process.platform === 'win32')('validateBearer', () => {
  it('rejects an empty string', () => {
    expect(validateBearer('').ok).toBe(false);
  });

  it('rejects whitespace inside the token', () => {
    const check = validateBearer('abc def');
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/whitespace/);
  });

  it('rejects tokens longer than 512 chars', () => {
    const long = 'a'.repeat(513);
    const check = validateBearer(long);
    expect(check.ok).toBe(false);
  });

  it('accepts a well-formed iLink bearer', () => {
    expect(validateBearer('825d03f9b830@im.bot:0600004cfa82b35be03a85ac8941189410bf41').ok).toBe(true);
  });
});

describe.skipIf(process.platform === 'win32')('bindWeixinToken', () => {
  it('returns an error when the binary is not on PATH', async () => {
    const result = await bindWeixinToken({
      token: '825d03f9b830@im.bot:0600004cfa82b35be03a85ac8941189410bf41',
      resolveBinary: fakeResolveNull(),
      spawn: async () => ({ stdout: '', stderr: '', code: 0 })
    });
    expect(result.ok).toBe(false);
    expect(result.binaryPath).toBeNull();
    expect(result.error).toMatch(/cc-connect binary not found/);
  });

  it('calls cc-connect weixin bind with the right argv', async () => {
    writeFakeConfig(tmp, [
      '[[projects]]',
      'name = "default"',
      '',
      '[[projects.platforms]]',
      'type = "weixin"',
      '',
      '[projects.platforms.options]',
      'token = "825d03f9b830@im.bot:0600004cfa82b35be03a85ac8941189410bf41"',
      ''
    ].join('\n'));
    const { calls, spawn } = capturingSpawn({ stdout: '', stderr: '', code: 0 });
    const result = await bindWeixinToken({
      token: '825d03f9b830@im.bot:0600004cfa82b35be03a85ac8941189410bf41',
      project: 'team-bot',
      apiUrl: 'https://ilink-proxy.example.com',
      platformIndex: 0,
      skipVerify: true,
      resolveBinary: fakeResolveOk('/bin/cc-connect'),
      spawn
    });
    expect(result.ok).toBe(true);
    expect(result.bound).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.binaryPath).toBe('/bin/cc-connect');
    expect(calls[0]?.args).toEqual([
      'weixin',
      'bind',
      '--project',
      'team-bot',
      '--token',
      '825d03f9b830@im.bot:0600004cfa82b35be03a85ac8941189410bf41',
      '--platform-index',
      '0',
      '--api-url',
      'https://ilink-proxy.example.com',
      '--skip-verify'
    ]);
  });

  it('omits optional flags when they are not provided', async () => {
    writeFakeConfig(tmp, [
      '[[projects.platforms.options]]',
      'token = "825d03f9b830@im.bot:0600004cfa82b35be03a85ac8941189410bf41"',
      ''
    ].join('\n'));
    const { calls, spawn } = capturingSpawn({ stdout: '', stderr: '', code: 0 });
    const result = await bindWeixinToken({
      token: '825d03f9b830@im.bot:0600004cfa82b35be03a85ac8941189410bf41',
      resolveBinary: fakeResolveOk('/bin/cc-connect'),
      spawn
    });
    expect(result.ok).toBe(true);
    expect(calls[0]?.args).toEqual([
      'weixin',
      'bind',
      '--project',
      'default',
      '--token',
      '825d03f9b830@im.bot:0600004cfa82b35be03a85ac8941189410bf41'
    ]);
  });

  it('returns ok=true when cc-connect exit 0 and the config has the token line', async () => {
    writeFakeConfig(tmp, [
      '[[projects.platforms.options]]',
      'token = "825d03f9b830@im.bot:0600004cfa82b35be03a85ac8941189410bf41"',
      ''
    ].join('\n'));
    const result = await bindWeixinToken({
      token: '825d03f9b830@im.bot:0600004cfa82b35be03a85ac8941189410bf41',
      resolveBinary: fakeResolveOk('/bin/cc-connect'),
      spawn: async () => ({ stdout: 'ok', stderr: '', code: 0 })
    });
    expect(result.ok).toBe(true);
    expect(result.bound).toBe(true);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('ok');
  });

  it('returns ok=false when cc-connect exits non-zero', async () => {
    writeFakeConfig(tmp, '[[projects.platforms.options]]\ntoken = "old@im.bot:xxx"\n');
    const result = await bindWeixinToken({
      token: '825d03f9b830@im.bot:0600004cfa82b35be03a85ac8941189410bf41',
      resolveBinary: fakeResolveOk('/bin/cc-connect'),
      spawn: async () => ({ stdout: '', stderr: 'invalid bearer', code: 1 })
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(1);
    expect(result.error).toMatch(/bind failed/);
    expect(result.error).toMatch(/invalid bearer/);
  });

  it('returns ok=false when cc-connect exit 0 but no token line was written', async () => {
    // Config exists but no `token = "..."` line — the strict
    // post-condition should fail.
    writeFakeConfig(tmp, '[[projects]]\nname = "default"\n');
    const result = await bindWeixinToken({
      token: '825d03f9b830@im.bot:0600004cfa82b35be03a85ac8941189410bf41',
      resolveBinary: fakeResolveOk('/bin/cc-connect'),
      spawn: async () => ({ stdout: '', stderr: '', code: 0 })
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no `token = "..."` line/);
  });

  it('returns ok=false when the config file is missing entirely', async () => {
    // No .cc-connect/ at all.
    const result = await bindWeixinToken({
      token: '825d03f9b830@im.bot:0600004cfa82b35be03a85ac8941189410bf41',
      resolveBinary: fakeResolveOk('/bin/cc-connect'),
      spawn: async () => ({ stdout: '', stderr: '', code: 0 })
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/does not exist/);
  });

  it('rejects an empty bearer without spawning cc-connect', async () => {
    const spawnFn: BindSpawnFn = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }));
    const result = await bindWeixinToken({
      token: '',
      resolveBinary: fakeResolveOk('/bin/cc-connect'),
      spawn: spawnFn
    });
    expect(result.ok).toBe(false);
    expect(spawnFn).not.toHaveBeenCalled();
  });
});

describe.skipIf(process.platform === 'win32')('readBoundToken', () => {
  it('returns bound=false when the config file does not exist', () => {
    const snap = readBoundToken({ home: tmp });
    expect(snap.bound).toBe(false);
    expect(snap.configPresent).toBe(false);
    expect(snap.maskedToken).toBeNull();
  });

  it('returns the masked token when the config has a token line', () => {
    writeFakeConfig(tmp, [
      '[[projects.platforms.options]]',
      'token = "825d03f9b830@im.bot:0600004cfa82b35be03a85ac8941189410bf41"',
      ''
    ].join('\n'));
    const snap = readBoundToken({ home: tmp });
    expect(snap.bound).toBe(true);
    expect(snap.botid).toBe('825d03f9b830@im.bot');
    expect(snap.maskedToken).toBe('825d03f9b830@im.bot:****');
    expect(snap.rawToken).toBeNull();
  });

  it('includes the raw token when reveal=true', () => {
    writeFakeConfig(tmp, [
      '[[projects.platforms.options]]',
      'token = "825d03f9b830@im.bot:0600004cfa82b35be03a85ac8941189410bf41"',
      ''
    ].join('\n'));
    const snap = readBoundToken({ home: tmp, reveal: true });
    expect(snap.bound).toBe(true);
    expect(snap.rawToken).toBe('825d03f9b830@im.bot:0600004cfa82b35be03a85ac8941189410bf41');
  });

  it('returns configPresent=true but bound=false when the file lacks a token line', () => {
    writeFakeConfig(tmp, '[[projects]]\nname = "default"\n');
    const snap = readBoundToken({ home: tmp });
    expect(snap.bound).toBe(false);
    expect(snap.configPresent).toBe(true);
    expect(snap.maskedToken).toBeNull();
  });
});

describe.skipIf(process.platform === 'win32')('readBoundTokenFromDisk (lower-level helper)', () => {
  it('masks the bearer when reveal=false; reveals when reveal=true', () => {
    const file = writeFakeConfig(tmp, [
      '[[projects.platforms.options]]',
      'token = "abcd@im.bot:deadbeef"',
      ''
    ].join('\n'));
    const masked = readBoundTokenFromDisk(file, { reveal: false });
    expect(masked.maskedToken).toBe('abcd@im.bot:****');
    expect(masked.rawToken).toBeNull();

    const revealed = readBoundTokenFromDisk(file, { reveal: true });
    expect(revealed.rawToken).toBe('abcd@im.bot:deadbeef');
    expect(revealed.maskedToken).toBe('abcd@im.bot:****');
  });

  it('returns a missing-file snapshot when the path does not exist', () => {
    const snap = readBoundTokenFromDisk(join(tmp, 'no-such-file.toml'));
    expect(snap.bound).toBe(false);
    expect(snap.configPresent).toBe(false);
  });
});

describe.skipIf(process.platform === 'win32')('defaultBindSpawn', () => {
  it('is a callable function (smoke)', () => {
    expect(typeof defaultBindSpawn).toBe('function');
  });

  it('writes the token into the config file (integration with a real shell)', async () => {
    // This test only runs when /bin/sh is available. We use a small
    // shell script to mimic cc-connect's "write token to config"
    // side effect, so we can assert the full spawn → read loop.
    const configPath = writeFakeConfig(tmp, '');
    const shimPath = join(tmp, 'cc-connect-shim.sh');
    const shim = `#!/bin/sh
# Mimic cc-connect weixin bind: write the bearer into the config.
BEARER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --token) BEARER="$2"; shift 2;;
    *) shift;;
  esac
done
if [ -z "$BEARER" ]; then
  echo "missing token" >&2
  exit 1
fi
mkdir -p "$(dirname "${configPath}")"
cat >> "${configPath}" <<EOF
[[projects.platforms.options]]
token = "$BEARER"
EOF
exit 0
`;
    writeFileSync(shimPath, shim, 'utf8');
    chmodSync(shimPath, 0o755);

    const result = await bindWeixinToken({
      token: 'real-bot@im.bot:real-secret',
      resolveBinary: fakeResolveOk(shimPath)
    });
    expect(result.ok).toBe(true);
    expect(result.bound).toBe(true);
    const onDisk = readFileSync(configPath, 'utf8');
    expect(onDisk).toContain('token = "real-bot@im.bot:real-secret"');
  });
});

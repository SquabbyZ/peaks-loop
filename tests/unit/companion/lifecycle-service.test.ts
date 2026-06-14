import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startCcConnect,
  stopCcConnect,
  restartCcConnect,
  statusCcConnect
} from '../../../src/services/companion/lifecycle-service.js';
import {
  companionPidFile,
  writeProcessRecord,
  readProcessRecord,
  spawnCompanion
} from '../../../src/services/companion/process-manager.js';

let tmp: string;
let previousHome: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'peaks-lifecycle-'));
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
  // The script handles BOTH `--version` (used by probeCcConnect) and
  // a default no-op (used by spawnCompanion). Without a version line,
  // probeCcConnect fails and startCcConnect short-circuits before
  // reaching the spawn.
  writeFileSync(bin, '#!/bin/sh\nif [ "$1" = "--version" ]; then\n  echo "cc-connect 9.9.9"\n  exit 0\nfi\nexit 0\n');
  chmodSync(bin, 0o755);
  return dir;
}

describe('startCcConnect', () => {
  it('returns started=false with a clear error when the binary is not on PATH', async () => {
    // Use a tmp cwd so the resolver doesn't accidentally pick up
    // peaks-cli's own node_modules/.bin/cc-connect (which now exists
    // because slice 2 added cc-connect as a peaks-cli dep).
    const result = await startCcConnect({ pathEnv: '/no/such/dir', cwd: tmp, home: tmp });
    expect(result.started).toBe(false);
    expect(result.alreadyRunning).toBe(false);
    expect(result.error).toMatch(/cc-connect|PATH/i);
  });

  it('returns alreadyRunning=true when a live process record exists', async () => {
    const dir = dropFakeBinary();
    writeProcessRecord({
      pid: process.pid,
      binaryPath: join(dir, 'cc-connect'),
      channel: 'weixin',
      startedAt: '2026-06-14T08:00:00.000Z',
      argv: ['--daemon']
    }, tmp);
    const result = await startCcConnect({ pathEnv: dir, home: tmp });
    expect(result.alreadyRunning).toBe(true);
    expect(result.pid).toBe(process.pid);
    expect(result.nextActions.join(' ')).toContain('restart');
  });

  it('starts a child and writes the pid file when binary resolves and no record exists', async () => {
    const dir = dropFakeBinary();
    const result = await startCcConnect({ pathEnv: dir, home: tmp, spawn: (bin, args) => spawnCompanion(bin, args) });
    expect(result.started).toBe(true);
    expect(result.pid).not.toBeNull();
    expect(result.pidFile).toBe(companionPidFile(tmp));
    const record = readProcessRecord(tmp);
    expect(record).not.toBeNull();
    expect(record?.pid).toBe(result.pid);
    expect(record?.channel).toBe('weixin');
  });

  it('clears a stale pid file before launching a new process', async () => {
    const dir = dropFakeBinary();
    writeProcessRecord({
      pid: 2_000_000_000,
      binaryPath: join(dir, 'cc-connect'),
      channel: 'weixin',
      startedAt: '2026-06-14T08:00:00.000Z',
      argv: ['--daemon']
    }, tmp);
    const result = await startCcConnect({ pathEnv: dir, home: tmp, spawn: (bin, args) => spawnCompanion(bin, args) });
    expect(result.started).toBe(true);
    const record = readProcessRecord(tmp);
    expect(record?.pid).toBe(result.pid);
  });
});

describe('stopCcConnect', () => {
  it('returns wasRunning=false and stopped=true when no record exists', async () => {
    const result = await stopCcConnect({ home: tmp });
    expect(result.stopped).toBe(true);
    expect(result.wasRunning).toBe(false);
    expect(result.signal).toBeNull();
  });

  it('clears a stale record silently', async () => {
    writeProcessRecord({
      pid: 2_000_000_000,
      binaryPath: '/bin/cc-connect',
      channel: 'weixin',
      startedAt: '2026-06-14T08:00:00.000Z',
      argv: ['--daemon']
    }, tmp);
    const result = await stopCcConnect({ home: tmp });
    expect(result.wasRunning).toBe(false);
    expect(result.stopped).toBe(true);
    expect(readProcessRecord(tmp)).toBeNull();
  });

  it('returns stopped=true with SIGTERM when the process exits within the timeout', async () => {
    const dir = dropFakeBinary();
    const realSpawn = spawnCompanion('/bin/sh', ['-c', 'sleep 30']);
    realSpawn.child.unref();
    const pid = realSpawn.child.pid;
    expect(typeof pid).toBe('number');
    if (typeof pid !== 'number') return;
    writeProcessRecord({
      pid,
      binaryPath: '/bin/sh',
      channel: 'weixin',
      startedAt: '2026-06-14T08:00:00.000Z',
      argv: ['-c', 'sleep 30']
    }, tmp);
    let alive = true;
    const aliveProbe = (p: number): boolean => p === pid && alive;
    setTimeout(() => {
      alive = false;
    }, 200);
    const result = await stopCcConnect({ alive: aliveProbe, timeoutMs: 5_000, home: tmp });
    expect(result.stopped).toBe(true);
    expect(result.signal).toBe('SIGTERM');
    expect(result.pid).toBe(pid);
  });

  it('escalates to SIGKILL when the process ignores SIGTERM', async () => {
    const dir = dropFakeBinary();
    const realSpawn = spawnCompanion('/bin/sh', ['-c', 'sleep 30']);
    realSpawn.child.unref();
    const pid = realSpawn.child.pid;
    expect(typeof pid).toBe('number');
    if (typeof pid !== 'number') return;
    writeProcessRecord({
      pid,
      binaryPath: '/bin/sh',
      channel: 'weixin',
      startedAt: '2026-06-14T08:00:00.000Z',
      argv: ['-c', 'sleep 30']
    }, tmp);
    const result = await stopCcConnect({ alive: () => true, timeoutMs: 50, noEscalate: false, home: tmp });
    expect(result.signal).toBe('SIGKILL');
    try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
  });
});

describe('restartCcConnect', () => {
  it('restarts a fresh process even when the previous pid was stale', async () => {
    const dir = dropFakeBinary();
    writeProcessRecord({
      pid: 2_000_000_000,
      binaryPath: join(dir, 'cc-connect'),
      channel: 'weixin',
      startedAt: '2026-06-14T08:00:00.000Z',
      argv: ['--daemon']
    }, tmp);
    const result = await restartCcConnect({ pathEnv: dir, home: tmp, spawn: (bin, args) => spawnCompanion(bin, args) });
    expect(result.restarted).toBe(true);
    expect(result.stop.wasRunning).toBe(false);
    expect(result.start.started).toBe(true);
    expect(result.start.pid).not.toBeNull();
  });
});

describe('statusCcConnect', () => {
  it('returns running=false with no pid when no record exists', async () => {
    const status = await statusCcConnect({ pathEnv: '/no/such/dir', home: tmp });
    expect(status.running).toBe(false);
    expect(status.pid).toBeNull();
    expect(status.channel).toBe('weixin');
  });

  it('returns running=true with the current pid when the record references this process', async () => {
    const dir = dropFakeBinary();
    writeProcessRecord({
      pid: process.pid,
      binaryPath: join(dir, 'cc-connect'),
      channel: 'weixin',
      startedAt: '2026-06-14T08:00:00.000Z',
      argv: ['--daemon']
    }, tmp);
    const status = await statusCcConnect({ pathEnv: dir, home: tmp });
    expect(status.running).toBe(true);
    expect(status.pid).toBe(process.pid);
    expect(status.startedAt).toBe('2026-06-14T08:00:00.000Z');
  });

  // BUG FIX (2026-06-14 dogfood): a stale PID record (PID dead) that
  // points at a non-existent binaryPath must NOT shadow the live
  // probe resolution. Without this guard, `status` would render the
  // stale path even though a working cc-connect is resolvable.
  it('ignores stale binaryPath in PID record when PID is dead', async () => {
    const dir = dropFakeBinary();
    writeProcessRecord({
      pid: 99999, // guaranteed-dead PID (well above any plausible kernel pid_max for tests)
      binaryPath: '/tmp/fake/bin/cc-connect',
      channel: 'weixin',
      startedAt: '2026-06-14T08:00:00.000Z',
      argv: ['--daemon']
    }, tmp);
    const status = await statusCcConnect({ pathEnv: dir, home: tmp, cwd: tmp });
    expect(status.running).toBe(false);
    expect(status.pid).toBeNull();
    expect(status.binaryPath).not.toBe('/tmp/fake/bin/cc-connect');
    expect(status.binaryPath).toBe(join(dir, 'cc-connect'));
  });
});

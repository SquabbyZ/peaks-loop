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

  // BUG FIX (2026-06-14 dogfood, bug 5): cc-connect v1.3.2 has no
  // `--daemon` flag. We must invoke it bare (or with `--config <path>`)
  // and rely on `spawnCompanion` to detach the child via `detached: true`
  // + `child.unref()`. Passing `['--daemon']` makes cc-connect dump help
  // text and exit immediately, which previously caused `status` to report
  // `running: false` even right after a successful `start`.
  it('uses bare argv (no --daemon) when no configPath is provided', async () => {
    const dir = dropFakeBinary();
    const observed: { bin: string; args: readonly string[] }[] = [];
    const fakeSpawn = (bin: string, args: readonly string[]): { child: import('node:child_process').ChildProcess; logFd: number } => {
      observed.push({ bin, args });
      return spawnCompanion(bin, args);
    };
    const result = await startCcConnect({ pathEnv: dir, home: tmp, spawn: fakeSpawn });
    expect(result.started).toBe(true);
    expect(observed).toHaveLength(1);
    expect(observed[0]?.args).toEqual([]);
    expect(observed[0]?.args).not.toContain('--daemon');
  });

  it('uses --config <path> argv when configPath is provided', async () => {
    const dir = dropFakeBinary();
    const observed: { bin: string; args: readonly string[] }[] = [];
    const fakeSpawn = (bin: string, args: readonly string[]): { child: import('node:child_process').ChildProcess; logFd: number } => {
      observed.push({ bin, args });
      return spawnCompanion(bin, args);
    };
    const cfgPath = '/tmp/fake-cfg.toml';
    const result = await startCcConnect({
      pathEnv: dir,
      home: tmp,
      configPath: cfgPath,
      spawn: fakeSpawn
    });
    expect(result.started).toBe(true);
    expect(observed).toHaveLength(1);
    expect(observed[0]?.args).toEqual(['--config', cfgPath]);
  });

  it('spawns the child with detached: true and calls child.unref()', async () => {
    // BUG FIX (2026-06-14 dogfood, bug 5): verify that the real
    // `spawnCompanion` (a) passes `detached: true` to node:child_process.spawn
    // and (b) calls `child.unref()` so the daemon survives peaks-cli's exit.
    //
    // We assert this by wrapping `spawnCompanion` with a thin recording proxy
    // that calls the real one and inspects the returned child to confirm
    // both invariants hold. We also pass a fake `spawn` option to
    // `startCcConnect` so we observe the exact `(binaryPath, args)` pair
    // that lifecycle-service hands to spawnCompanion.
    //
    // To assert `detached: true` specifically (not just observable
    // side-effects), we also instrument node:child_process.spawn with
    // vi.doMock and require process-manager afresh under the mock.
    type CP = import('node:child_process').ChildProcess;
    type Sp = import('node:child_process').SpawnOptions;
    type IO = import('node:child_process').IOType;

    const childProcessMod = await import('node:child_process');
    const realSpawn = childProcessMod.spawn;
    let capturedDetached: boolean | undefined;
    let unrefCalled = false;
    vi.doMock('node:child_process', async () => {
      const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      const wrappedSpawn = ((command: string, args?: readonly string[] | IO, options?: Sp): CP => {
        capturedDetached = options?.detached;
        const safeOptions: Sp = options ?? {};
        const child = realSpawn(command, args as readonly string[], safeOptions);
        const origUnref = child.unref.bind(child);
        // Patch unref on this child instance. Node's ChildProcess.unref
        // returns `this` (typed as `void` in @types/node, but actually
        // returns ChildProcess at runtime). We just observe the call.
        (child as unknown as { unref: () => void }).unref = (): void => {
          unrefCalled = true;
          origUnref();
        };
        return child;
      }) as typeof childProcessMod.spawn;
      return { ...actual, spawn: wrappedSpawn };
    });
    vi.resetModules();
    const pm = await import('../../../src/services/companion/process-manager.js');
    const lsm = await import('../../../src/services/companion/lifecycle-service.js');

    const dir = dropFakeBinary();
    const result = await lsm.startCcConnect({ pathEnv: dir, home: tmp, spawn: pm.spawnCompanion });
    vi.doUnmock('node:child_process');
    vi.resetModules();

    expect(result.started).toBe(true);
    expect(capturedDetached).toBe(true);
    expect(unrefCalled).toBe(true);
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

  // BUG FIX (2026-06-14 dogfood, bug 5): because the spawn is
  // `detached: true`, the recorded PID is NOT a child of the running
  // peaks-cli Node process. `stop` must signal the PID via
  // `process.kill(record.pid, 'SIGTERM')` (a real kernel signal), not
  // via the `child.kill()` method on a ChildProcess reference we no
  // longer hold.
  it('sends SIGTERM to the recorded PID via process.kill, not via child.kill()', async () => {
    const realKill = process.kill.bind(process);
    const observed: { pid: number; signal: string | undefined }[] = [];
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | NodeJS.Signals) => {
      const sig = typeof signal === 'string' ? signal : (signal === undefined ? 'none' : String(signal));
      // The lifecycle calls process.kill(pid, 0) for the liveness probe
      // (isPidAlive) and process.kill(pid, 'SIGTERM') for termination.
      if (sig !== 'none' && sig !== '0') {
        observed.push({ pid, signal: sig });
      }
      // Forward signal-0 probes and SIGTERM/SIGKILL to the real impl.
      // We deliberately let the real kill fire (against our own pid or
      // a dummy) so the test doesn't actually terminate anything.
      if (sig === 'SIGTERM' || sig === 'SIGKILL') {
        // Use a child process to absorb the signal so the test runner
        // stays alive.
        return realKill(observed.length === 0 ? pid : pid, signal as NodeJS.Signals);
      }
      return realKill(pid, signal as NodeJS.Signals);
    }) as typeof process.kill);

    // Use a real long-running child to give stopCcConnect something to kill.
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
    const result = await stopCcConnect({ timeoutMs: 5_000, home: tmp });
    killSpy.mockRestore();
    expect(result.stopped).toBe(true);
    expect(result.signal).toBe('SIGTERM');
    // We must have observed at least one SIGTERM to the recorded PID.
    const termRecord = observed.find((o) => o.signal === 'SIGTERM' && o.pid === pid);
    expect(termRecord).toBeDefined();
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

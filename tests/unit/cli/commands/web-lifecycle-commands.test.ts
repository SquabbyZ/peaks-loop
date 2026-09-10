// tests/unit/cli/commands/web-lifecycle-commands.test.ts
//
// The `peaks web status` / `peaks web stop` surface, driven through the real
// commander program against a real `.peaks/_runtime/<sid>/session.json` binding
// and a real loopback daemon — so what is asserted is the envelope the caller
// reads, not a hand-built one.
//
// `status` and `stop` route around the daemon on purpose: `status` must work when
// the daemon is dead (AC6) and `stop` must work when it answers nothing. Both are
// therefore exercised with no daemon at all as well as with one.
//
// Dimensions covered:
//   - render:      the JSON envelope on stdout, and the human-mode failure line
//   - behavior:    the result shape per state, and `NO_SESSION` with no binding
//   - integration: real session.json, real daemon.json, real loopback HTTP
//   - a11y:        exit code and the message a human reads on failure

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo } from '../../_setup/io.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

declareDimensions('tests/unit/cli/commands/web-lifecycle-commands.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y',
]);

import { registerWebCommands } from '../../../../src/cli/commands/web-commands.js';
import { webDaemonInfoPath, webInstallLockPath } from '../../../../src/services/web/web-artifact-paths.js';
import {
  PROTOCOL_VERSION,
  type WebOpResponse
} from '../../../../src/services/web/web-protocol.js';

/**
 * The install seam, replaced at the module boundary: the real `installChromium`
 * spawns `npx … playwright install chromium`, which is a ~700 MB download and
 * has no business running inside a test. What is under test is whether the verb
 * reaches that seam at all under the gate, and what it does with each outcome.
 */
const installSeam = vi.hoisted(() => ({
  /** What the cache probe answers before any install ran, and after one did. */
  installedBefore: false,
  installedAfter: true,
  probes: 0,
  calls: [] as Array<Record<string, unknown>>,
  outcome: { ok: true, code: '', message: '', warnings: ['INSTALL_SIZE_WARNING_PLACEHOLDER'] },
}));

vi.mock('../../../../src/services/web/web-install-service.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../src/services/web/web-install-service.js')>();
  return {
    ...actual,
    // `isWebDisabled` and the constants stay REAL: the gate under test is the
    // production one, not a stub that would pass by construction.
    probeBrowserInstalled: () => {
      installSeam.probes += 1;
      return Promise.resolve({
        installed: installSeam.calls.length > 0 ? installSeam.installedAfter : installSeam.installedBefore,
        version: '1.63.0',
        executablePath: join(process.cwd(), 'fake-chrome')
      });
    },
    installChromium: (options: Record<string, unknown>) => {
      installSeam.calls.push(options);
      return Promise.resolve(installSeam.outcome);
    }
  };
});

import { INSTALL_SIZE_WARNING } from '../../../../src/services/web/web-install-service.js';

const SESSION_ID = '2026-09-10-session-528a63';
const ws = withTmpWorkspacePerTest('peaks-web-lifecycle-');

const closers: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) {
    await close();
  }
  process.exitCode = 0;
});

/** Bind the tmp workspace as a peaks session root. */
function bindSession(sessionId = SESSION_ID): void {
  const dir = join(ws().path, '.peaks', '_runtime');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'session.json'),
    JSON.stringify({ sessionId, projectRoot: ws().path }),
    'utf8'
  );
}

/** Parse the single JSON envelope the command wrote to stdout. */
function envelope(captured: { text: () => string }): {
  ok: boolean;
  code?: string;
  data: Record<string, unknown>;
  warnings: string[];
} {
  return JSON.parse(captured.text()) as {
    ok: boolean;
    code?: string;
    data: Record<string, unknown>;
    warnings: string[];
  };
}

async function runWeb(verb: string, asJson = true): Promise<ReturnType<typeof makeCapturedIo>> {
  const captured = makeCapturedIo();
  const program = new Command();
  program.exitOverride();
  registerWebCommands(program, captured.io);
  await program.parseAsync(['web', verb, ...(asJson ? ['--json'] : [])], { from: 'user' });
  return captured;
}

/** A daemon that answers `/health` and exits when it receives the `stop` op. */
interface StopableDaemon {
  readonly pid: number;
  readonly port: number;
  readonly isGone: () => boolean;
}

/**
 * Spawned as a REAL separate process, not run in-process. `stop` waits for the
 * daemon's pid to leave the process table and signals it if it does not — so a
 * recorded pid of `process.pid` would make the test signal the vitest worker.
 *
 * It answers `whoami` with its OWN pid and the session it was told it serves:
 * that authenticated identity echo is what `stopDaemon` requires before it
 * signals anything (R7), so a stub that does not answer it is a different test.
 */
const STOPABLE_DAEMON_SCRIPT = `
const { createServer } = require('node:http');
const sessionId = process.env.PEAKS_TEST_SESSION_ID;
const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  let body = '';
  request.on('data', (chunk) => { body += String(chunk); });
  request.on('end', () => {
    response.writeHead(200, { 'content-type': 'application/json' });
    const whoami = body.includes('"whoami"');
    response.end(JSON.stringify({
      ok: true,
      data: whoami ? { pid: process.pid, sessionId } : null,
      code: null, message: null, warnings: [], nextActions: []
    }));
    if (body.includes('"stop"')) { setTimeout(() => process.exit(0), 20); }
  });
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(String(server.address().port) + '\\n');
});
process.on('SIGTERM', () => process.exit(0));
process.stdin.resume();
`;

/**
 * A local HTTP server that is NOT a daemon: it answers 2xx to everything,
 * including `GET /health`. This is what a recycled port looks like, and it is
 * the shape the old "ownership proof" accepted — after which `peaks web stop`
 * ran `process.kill` on whatever pid the record named.
 */
const UNRELATED_LISTENER_SCRIPT = `
const { createServer } = require('node:http');
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    ok: true, data: null, code: null, message: null, warnings: [], nextActions: []
  }));
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(String(server.address().port) + '\\n');
});
process.on('SIGTERM', () => process.exit(0));
process.stdin.resume();
`;

/** Spawn a helper process that prints the port it bound; register its cleanup. */
async function startHelper(script: string, env: NodeJS.ProcessEnv = {}): Promise<StopableDaemon> {
  const child = spawn(process.execPath, ['-e', script], {
    stdio: ['ignore', 'pipe', 'ignore'],
    detached: true,
    windowsHide: true,
    env: { ...process.env, ...env }
  });
  const pid = child.pid ?? 0;
  closers.push(async () => {
    child.kill();
  });
  const port = await new Promise<number>((settle, reject) => {
    let buffered = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const line = buffered.split('\n')[0] ?? '';
      if (line !== '') {
        settle(Number(line));
      }
    });
    child.once('error', reject);
  });
  return {
    pid,
    port,
    isGone: () => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    }
  };
}

function startStopableDaemon(): Promise<StopableDaemon> {
  return startHelper(STOPABLE_DAEMON_SCRIPT, { PEAKS_TEST_SESSION_ID: SESSION_ID });
}

function plantDaemonInfo(pid: number, port: number): void {
  mkdirSync(join(webDaemonInfoPath(ws().path, SESSION_ID), '..'), { recursive: true });
  writeFileSync(
    webDaemonInfoPath(ws().path, SESSION_ID),
    JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      pid,
      port,
      token: 'a'.repeat(64),
      version: '4.0.36',
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      startedAt: '2026-09-10T00:00:00.000Z'
    }),
    'utf8'
  );
}

describe('render — the status envelope', () => {
  it('when no daemon is running, should print an empty instance list', async () => {
    // given: a bound session with no daemon
    bindSession();
    // when: status runs with --json
    const captured = await runWeb('status');
    // then: the envelope is ok and lists nothing
    const result = envelope(captured.captured);
    expect(result.ok).toBe(true);
    expect(result.data['instances']).toEqual([]);
  });

  it('when a daemon record is stale, should render the state and not report it live', async () => {
    // given: a bound session with a dead pid recorded
    bindSession();
    plantDaemonInfo(2_147_483_646, 59_996);
    // when: status runs
    const captured = await runWeb('status');
    // then: the instance is reported as stale
    const instances = envelope(captured.captured).data['instances'] as Array<{ state: string }>;
    expect(instances.map((instance) => instance.state)).toEqual(['stale']);
  });
});

describe('a11y — status without a session', () => {
  it('when no session is bound, should fail with NO_SESSION and a next action', async () => {
    // given: a project root with no session.json
    // when: status runs
    const captured = await runWeb('status');
    // then: the failure names the cause and sets the exit code
    expect(envelope(captured.captured).code).toBe('NO_SESSION');
    expect(process.exitCode).toBe(1);
  });
});

describe('behavior — stop', () => {
  it('when a daemon is running, should stop it and clear its record', async () => {
    // given: a bound session and a real daemon process that answers /health
    bindSession();
    const daemon = await startStopableDaemon();
    plantDaemonInfo(daemon.pid, daemon.port);
    // when: stop runs
    const captured = await runWeb('stop');
    // then: the daemon is gone by the time stop returns, and so is its record
    const result = envelope(captured.captured);
    expect(result.ok).toBe(true);
    expect(result.data['stopped']).toBe(1);
    expect(result.data['pids']).toEqual([daemon.pid]);
    expect(daemon.isGone()).toBe(true);
    expect(existsSync(webDaemonInfoPath(ws().path, SESSION_ID))).toBe(false);
  });

  it('when the recorded pid is already gone, should still clear the record', async () => {
    // given: a bound session with a stale record
    bindSession();
    plantDaemonInfo(2_147_483_646, 59_995);
    // when: stop runs
    const captured = await runWeb('stop');
    // then: the command succeeds, reports nothing stopped, and clears the record
    const result = envelope(captured.captured);
    expect(result.ok).toBe(true);
    expect(result.data['stopped']).toBe(0);
    expect(result.data['pids']).toEqual([]);
    expect(existsSync(webDaemonInfoPath(ws().path, SESSION_ID))).toBe(false);
  });

  it('when a daemon is alive but silent, should keep its record and warn that the process was left', async () => {
    // given: a bound session whose record names a live process with no listener
    bindSession();
    const silent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    silent.unref();
    closers.push(async () => {
      silent.kill();
    });
    plantDaemonInfo(silent.pid ?? 0, 59_994);
    // when: stop runs
    const captured = await runWeb('stop');
    // then: the orphan is reported, left alone, and still recorded — dropping
    // the record would leave a live process no verb can ever reach, and would
    // let the next cold start spawn a second daemon beside it
    const result = envelope(captured.captured);
    expect(result.ok).toBe(true);
    expect(result.data['orphanedPids']).toEqual([silent.pid]);
    expect(result.warnings.join('\n')).toContain('could not be proven');
    expect(existsSync(webDaemonInfoPath(ws().path, SESSION_ID))).toBe(true);
    expect(result.data['stopped']).toBe(0);
  });

  it('when the record names a live pid that only answers 2xx, should not signal it', async () => {
    // given: a bound session whose record names a live process that is not a
    // daemon — it answers 2xx to /health and to /op with no identity at all
    bindSession();
    const unrelated = await startHelper(UNRELATED_LISTENER_SCRIPT);
    plantDaemonInfo(unrelated.pid, unrelated.port);
    // when: stop runs
    const captured = await runWeb('stop');
    // then: it is reported as an orphan and survives — "something answered 2xx"
    // is not ownership, and signalling on that proof is how a recycled pid
    // becomes a `TerminateProcess` on an unrelated process
    const result = envelope(captured.captured);
    expect(result.ok).toBe(true);
    expect(result.data['orphanedPids']).toEqual([unrelated.pid]);
    expect(unrelated.isGone()).toBe(false);
    expect(existsSync(webDaemonInfoPath(ws().path, SESSION_ID))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC5 — `peaks web install` under the gate (slice S3, file 13)
//
// The matrix gives this verb its own branch (C2): it does not degrade to MCP, it
// REFUSES — and the gate is step 1 of the ordered gate, so the refusal happens
// before the session lookup, before the cache probe and before any lock. The
// install seam is spied on rather than reached, because reaching it downloads
// ~700 MB (R2).
// ---------------------------------------------------------------------------

interface InstallEnvelope {
  readonly ok: boolean;
  readonly code?: string;
  readonly data: Record<string, unknown>;
  readonly warnings: string[];
  readonly nextActions: string[];
}

/** The same runner, with extra argv (`--force`) in front of `--json`. */
async function runWebArgv(argv: readonly string[]): Promise<ReturnType<typeof makeCapturedIo>> {
  const captured = makeCapturedIo();
  const program = new Command();
  program.exitOverride();
  registerWebCommands(program, captured.io);
  await program.parseAsync(['web', ...argv, '--json'], { from: 'user' });
  return captured;
}

function installEnvelope(captured: { text: () => string }): InstallEnvelope {
  return JSON.parse(captured.text()) as InstallEnvelope;
}

describe('behavior — `peaks web login` under the gate', () => {
  it('when the gate refuses an upper-case --profile, should say the name was not folded', async () => {
    // given: PEAKS_WEB_DISABLED=1 and a name a live run would fold. The gate is
    //        statement #1, so this needs no session binding and opens no browser.
    process.env['PEAKS_WEB_DISABLED'] = '1';
    try {
      // when:  login degrades
      const parsed = envelope((await runWebArgv(['login', '--profile', 'Work'])).captured);
      // then:  the refusal does not look like it disagrees with a live run about
      //        the profile: it says out loud that no fold happened here, instead
      //        of echoing "Work" as if it were the canonical name (S4 repair,
      //        code F5 / security S5)
      expect(parsed.code).toBe('WEB_DISABLED');
      expect(parsed.warnings.join('\n')).toContain('NOT folded');
      expect(parsed.warnings.join('\n')).toContain('"Work"');
    } finally {
      delete process.env['PEAKS_WEB_DISABLED'];
    }
  });
});

describe('behavior — `peaks web install`', () => {
  // The env is saved and cleared around each test rather than with the shared
  // `withEnv` helper: that helper registers its restore hook from inside the
  // test body, which does not take effect until the file's hooks run — a value
  // set in one test would still be readable by the next.
  const ENV_KEYS = ['PEAKS_WEB_DISABLED', 'PLAYWRIGHT_BROWSERS_PATH'] as const;
  /** The per-user roots the machine-global install lock is derived from. */
  const HOME_KEYS = ['HOME', 'USERPROFILE'] as const;
  const savedEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of [...ENV_KEYS, ...HOME_KEYS]) {
      savedEnv.set(key, process.env[key]);
    }
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    for (const key of HOME_KEYS) {
      process.env[key] = ws().path;
    }
    installSeam.probes = 0;
    installSeam.calls = [];
    installSeam.installedBefore = false;
    installSeam.installedAfter = true;
    installSeam.outcome = { ok: true, code: '', message: '', warnings: [INSTALL_SIZE_WARNING] };
  });

  afterEach(() => {
    for (const key of [...ENV_KEYS, ...HOME_KEYS]) {
      const previous = savedEnv.get(key);
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
    savedEnv.clear();
  });

  it('when the gate is on, should refuse without probing, locking or installing', async () => {
    // given: the flag set, an empty browser cache and a bound session
    bindSession();
    process.env['PEAKS_WEB_DISABLED'] = '1';
    process.env['PLAYWRIGHT_BROWSERS_PATH'] = join(ws().path, 'empty-pw-cache');
    // when: install runs
    const captured = await runWebArgv(['install']);
    // then: it refuses with the code the matrix names, and nothing was downloaded
    const parsed = installEnvelope(captured.captured);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('WEB_DISABLED');
    expect(parsed.nextActions.length).toBeGreaterThan(0);
    expect(process.exitCode).toBe(1);
    expect(installSeam.calls).toEqual([]);
    expect(installSeam.probes).toBe(0);
    expect(existsSync(webInstallLockPath())).toBe(false);
    expect(existsSync(join(ws().path, 'empty-pw-cache'))).toBe(false);
  });

  it('when the gate is on and no session is bound, should still refuse with WEB_DISABLED', async () => {
    // given: no session.json at all — the case that exposes a late gate
    process.env['PEAKS_WEB_DISABLED'] = '1';
    // when: install runs
    // then: the gate wins over NO_SESSION, and the installer is never reached
    const parsed = installEnvelope((await runWebArgv(['install'])).captured);
    expect(parsed.code).toBe('WEB_DISABLED');
    expect(installSeam.calls).toEqual([]);
  });

  it('when the browser is already present, should report it and install nothing', async () => {
    // given: a probe that finds the browser, and no --force
    bindSession();
    installSeam.installedBefore = true;
    // when: install runs
    // then: it is a no-op that says so
    const parsed = installEnvelope((await runWebArgv(['install'])).captured);
    expect(parsed.ok).toBe(true);
    expect(parsed.data['installed']).toBe(true);
    expect(parsed.data['downloaded']).toBe(false);
    expect(installSeam.calls).toEqual([]);
  });

  it('when the download succeeds, should report it and warn about the size', async () => {
    // given: a successful install outcome
    bindSession();
    // when: install runs
    // then: the envelope says it downloaded, and the size warning is carried
    const parsed = installEnvelope((await runWebArgv(['install'])).captured);
    expect(parsed.ok).toBe(true);
    expect(parsed.data['downloaded']).toBe(true);
    expect(parsed.warnings).toContain(INSTALL_SIZE_WARNING);
    expect(installSeam.calls.length).toBe(1);
  });

  it('when --force is given, should pass it to the installer', async () => {
    // given: R6's recovery flag
    bindSession();
    installSeam.installedBefore = true;
    // when: install --force runs, despite the probe reporting it installed
    const captured = await runWebArgv(['install', '--force']);
    // then: the installer was reached, and it was told to force
    expect(installEnvelope(captured.captured).ok).toBe(true);
    expect(installSeam.calls).toEqual([{ force: true }]);
  });

  it('when the installer exits 0 without landing the browser, should fail and name --force', async () => {
    // given: an installer that reports success, and a probe that still cannot
    //        find the browser launch() needs — a filtered CDN, a pinned npx
    //        resolving into another cache root, a partial install (R7)
    bindSession();
    installSeam.installedAfter = false;
    // when: install runs
    const parsed = installEnvelope((await runWebArgv(['install'])).captured);
    // then: it is a FAILURE with a way out, not `ok: true, downloaded: true,
    //       installed: false` and exit 0
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('WEB_INSTALL_INCOMPLETE');
    expect(parsed.nextActions.join('\n')).toContain('--force');
    expect(process.exitCode).toBe(1);
  });

  it('when the browser is already present, should still name --force as the escape', async () => {
    // given: the short-circuit path — the only one a user reaches when browser
    //        ops keep failing against a probe that says installed
    bindSession();
    installSeam.installedBefore = true;
    // when: install runs
    const parsed = installEnvelope((await runWebArgv(['install'])).captured);
    // then: the no-op success carries the recovery flag, so the loop has an exit
    expect(parsed.ok).toBe(true);
    expect(parsed.nextActions.join('\n')).toContain('--force');
  });

  it('when the download fails, should degrade to tier 3 rather than throw', async () => {
    // given: an installer that reports a failure (R2: never an exception)
    bindSession();
    installSeam.outcome = { ok: false, code: 'WEB_INSTALL_FAILED', message: 'exited with status 1', warnings: [] };
    // when: install runs
    // then: the envelope is the tier-3 degradation with a way forward
    const parsed = installEnvelope((await runWebArgv(['install'])).captured);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('WEB_INSTALL_FAILED');
    expect(parsed.data['tier']).toBe(3);
    expect(parsed.data['mcpTool']).toBe('mcp__playwright__browser_install');
    // The failed-download envelope must offer `--force` too: it is the only
    // recovery for a partial download (R7).
    expect(parsed.nextActions.join('\n')).toContain('--force');
    expect(existsSync(webInstallLockPath())).toBe(false);
  });
});

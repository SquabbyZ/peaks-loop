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
import { afterEach, describe, expect, it } from 'vitest';

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
import { webDaemonInfoPath } from '../../../../src/services/web/web-artifact-paths.js';
import {
  PROTOCOL_VERSION,
  type WebOpResponse
} from '../../../../src/services/web/web-protocol.js';

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

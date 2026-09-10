// tests/unit/services/web/web-status-report.test.ts
//
// AC6's diagnosis half: `peaks web status` must tell the three states apart —
// `live` (pid alive, `/health` answers), `orphaned` (pid alive, `/health` dead:
// the SIGKILLed-parent case R3 exists for), `stale` (pid dead, the record left
// behind). The orphan is built by planting a live-but-silent pid in a real
// `daemon.json`, which is exactly how QA's AC6 case constructs it.
//
// Dimensions covered:
//   - behavior:    the three-way classification
//   - integration: real `daemon.json` on disk, real process probes, real loopback HTTP
//   - render:      not applicable (returns a structure; the CLI layer renders it)
//   - a11y:        not applicable (no user-visible text at this layer)

import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/services/web/web-status-report.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the report is a structure; `peaks web status` owns every text surface' },
    { dim: 'a11y', reason: 'no user-visible text or exit code is produced at this layer' },
  ],
);

import { webDaemonDir, webDaemonInfoPath } from '../../../../src/services/web/web-artifact-paths.js';
import { PROTOCOL_VERSION } from '../../../../src/services/web/web-protocol.js';
import { buildStatusReport } from '../../../../src/services/web/web-status-report.js';

const SESSION_ID = '2026-09-10-session-528a63';
const ws = withTmpWorkspacePerTest('peaks-web-status-');

const spawned: ChildProcess[] = [];

afterEach(() => {
  for (const child of spawned.splice(0)) {
    child.kill();
  }
});

/** Plant a `daemon.json` describing `pid` on a port that answers nothing. */
function plantDaemonInfo(pid: number, port: number): void {
  const dir = webDaemonDir(ws().path, SESSION_ID);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    webDaemonInfoPath(ws().path, SESSION_ID),
    JSON.stringify(
      {
        protocolVersion: PROTOCOL_VERSION,
        pid,
        port,
        token: 'a'.repeat(64),
        version: '4.0.36',
        projectRoot: ws().path,
        sessionId: SESSION_ID,
        startedAt: '2026-09-10T00:00:00.000Z'
      },
      null,
      2
    ),
    'utf8'
  );
}

/** A live process that answers nothing — the orphan's pid. */
function spawnSilentProcess(): number {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
  spawned.push(child);
  if (child.pid === undefined) {
    throw new Error('could not spawn the silent process');
  }
  return child.pid;
}

describe('behavior — buildStatusReport', () => {
  it('when no daemon record exists, should report no instances', async () => {
    // given: a project root with no daemon.json
    // when: the report is built
    const report = await buildStatusReport(ws().path, SESSION_ID);
    // then: there is nothing to report
    expect(report.instances).toEqual([]);
  });

  it('when the recorded pid is gone, should classify the instance as stale, never live', async () => {
    // given: a daemon.json naming a pid that cannot exist
    plantDaemonInfo(2_147_483_646, 59_999);
    // when: the report is built
    const report = await buildStatusReport(ws().path, SESSION_ID);
    // then: the record is reported as a leftover, not as a usable daemon
    expect(report.instances.map((instance) => instance.state)).toEqual(['stale']);
  });

  it('when the pid is alive but /health does not answer, should classify the instance as orphaned', async () => {
    // given: a live process on a port with no listener
    plantDaemonInfo(spawnSilentProcess(), 59_998);
    // when: the report is built
    const report = await buildStatusReport(ws().path, SESSION_ID);
    // then: it is an orphan, and never reported as live
    expect(report.instances.map((instance) => instance.state)).toEqual(['orphaned']);
  });

  it('when a daemon answers /health, should classify it as live', async () => {
    // given: a real loopback server answering /health on a port we hold
    const { createServer } = await import('node:http');
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    });
    const port = await new Promise<number>((settle) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        settle(typeof address === 'object' && address !== null ? address.port : 0);
      });
    });
    plantDaemonInfo(process.pid, port);
    // when: the report is built
    const report = await buildStatusReport(ws().path, SESSION_ID);
    // then: this process is the live daemon
    expect(report.instances.map((instance) => instance.state)).toEqual(['live']);
    await new Promise<void>((settle) => {
      server.close(() => settle());
    });
  });

  it('when a record belongs to another session, should not report it here', async () => {
    // given: a daemon.json planted for a different session id
    plantDaemonInfo(process.pid, 59_997);
    // when: the report is built for a different session in the same root
    const report = await buildStatusReport(ws().path, '2026-09-10-session-other');
    // then: ownership is per (projectRoot, sessionId), so nothing is listed
    expect(report.instances).toEqual([]);
  });
});

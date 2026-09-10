// tests/unit/services/web/web-daemon-health-oracle.test.ts
//
// R1's independent scenario: a daemon that is ALIVE but slow is not an ABSENT
// daemon.
//
// The race test's only trigger is "the loser is delayed at the lock". That
// trigger set was narrower than reality, which is how the defect shipped: the
// incumbent daemon can stall its own event loop past `HEALTH_TIMEOUT_MS = 500`
// (`runChromiumInstall`'s `spawnSync`, or a synchronous `snap` prune/render on a
// large page) and be judged dead by a `/health` probe that never checks whether
// the recorded pid is alive. `ensureDaemon` then removed the LIVE daemon's
// record and spawned a second one for the same `(projectRoot, sessionId)` — a
// Q8 violation, and AC6 false-passes because the first daemon (with its
// chromium) becomes unreachable by every verb.
//
// The trigger here is therefore NOT the lock: it is a `/health` false negative
// against a peer that answers slowly — the same shape perf reproduced (a 700 ms
// peer, after which `ensureDaemon` booted a second daemon while the first stayed
// alive).
//
// Dimensions covered:
//   - behavior:    the cold-start decision under a health false negative
//   - integration: a real `daemon.json`, a real live pid, real loopback HTTP

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/services/web/web-daemon-health-oracle.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'no user-visible text: this asserts the cold-start decision' },
    { dim: 'a11y', reason: 'no CLI envelope or exit code is produced at this layer' },
  ],
);

import { isProcessAlive, readDaemonInfo } from '../../../../src/services/web/daemon-registry.js';
import { ensureDaemon } from '../../../../src/services/web/daemon-supervisor.js';
import { webDaemonDir, webDaemonInfoPath, webLogPath } from '../../../../src/services/web/web-artifact-paths.js';
import { PROTOCOL_VERSION } from '../../../../src/services/web/web-protocol.js';

const SESSION_ID = '2026-09-10-session-slowpeer';

/** How long the peer stalls before answering — twice the 500 ms health budget. */
const SLOW_ANSWER_MS = 700;

/**
 * How many `/health` requests are answered slowly.
 *
 * Two, so the stall is still in progress for BOTH probes the unfixed
 * `ensureDaemon` makes before it decides (the pre-lock probe and the
 * double-check under the lock). One would not discriminate: the second probe
 * would already be fast and the incumbent would be reused by luck.
 */
const SLOW_ANSWERS = 2;

const ws = withTmpWorkspacePerTest('peaks-web-oracle-');
const roots: string[] = [];

/**
 * Reap anything a FAILING run left behind. A green run spawns nothing, so this
 * is the evidence that the test does not leak the very daemon it forbids.
 */
afterEach(async () => {
  for (const projectRoot of roots.splice(0)) {
    for (const pid of daemonPids(projectRoot)) {
      if (isProcessAlive(pid)) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // It exited between the probe and the signal.
        }
      }
    }
    await waitUntil(() => daemonPids(projectRoot).every((pid) => !isProcessAlive(pid)));
    expect(daemonPids(projectRoot).filter((pid) => isProcessAlive(pid))).toEqual([]);
  }
});

/** A peer that answers `/health` slowly at first, then promptly. */
interface SlowPeer {
  readonly port: number;
  readonly close: () => Promise<void>;
}

async function startSlowPeer(): Promise<SlowPeer> {
  let remaining = SLOW_ANSWERS;
  const server: Server = createServer((_request, response) => {
    const slow = remaining > 0;
    remaining -= 1;
    const answer = (): void => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    };
    if (slow) {
      setTimeout(answer, SLOW_ANSWER_MS);
    } else {
      answer();
    }
  });
  const port = await new Promise<number>((settle) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      settle(typeof address === 'object' && address !== null ? address.port : 0);
    });
  });
  return {
    port,
    close: () =>
      new Promise<void>((settle) => {
        server.close(() => {
          settle();
        });
        server.closeAllConnections();
      })
  };
}

/** Plant a record naming a pid that IS alive, on the peer's port. */
function plantLiveDaemon(projectRoot: string, pid: number, port: number): void {
  const dir = webDaemonDir(projectRoot, SESSION_ID);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    webDaemonInfoPath(projectRoot, SESSION_ID),
    JSON.stringify(
      {
        protocolVersion: PROTOCOL_VERSION,
        pid,
        port,
        token: 'b'.repeat(64),
        version: '4.0.36',
        projectRoot,
        sessionId: SESSION_ID,
        startedAt: '2026-09-10T00:00:00.000Z'
      },
      null,
      2
    ),
    'utf8'
  );
}

/** How many daemons have ever booted for this session. One log line per boot. */
function bootCount(projectRoot: string): number {
  return daemonPids(projectRoot).length;
}

/** Every pid that has booted for this session — the only handle on a lost daemon. */
function daemonPids(projectRoot: string): number[] {
  const log = webLogPath(projectRoot, SESSION_ID);
  if (!existsSync(log)) {
    return [];
  }
  return [...readFileSync(log, 'utf8').matchAll(/daemon listening on \S+ \(pid (\d+)/g)].map(
    (match) => Number(match[1])
  );
}

async function waitUntil(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !predicate()) {
    await new Promise((resume) => {
      setTimeout(resume, 50);
    });
  }
}

describe('integration — a live daemon that stalls', () => {
  it(
    'when the recorded daemon is alive but answers /health slowly, should reuse it and spawn nothing',
    async () => {
      // given: a live pid recorded as this session's daemon on a peer whose
      // first /health answers arrive after the health budget has expired
      const projectRoot = ws().path;
      roots.push(projectRoot);
      const peer = await startSlowPeer();
      plantLiveDaemon(projectRoot, process.pid, peer.port);
      // when: a daemon is requested for that session
      const info = await ensureDaemon(projectRoot, SESSION_ID);
      // then: the live daemon was reused, its record survived, and no second
      // daemon was ever booted
      expect(info.pid).toBe(process.pid);
      expect(readDaemonInfo(projectRoot, SESSION_ID)?.pid).toBe(process.pid);
      expect(bootCount(projectRoot)).toBe(0);
      await peer.close();
    },
    30_000
  );
});

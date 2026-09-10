// tests/unit/services/web/web-daemon-service.test.ts
//
// The daemon's two halves, tested where each actually lives:
//   - `routeOp` is driven directly with a REAL `BrowserSessionManager` built on
//     a fake Playwright module, so every verb's payload shape and failure code
//     is asserted without a socket and without a browser;
//   - the HTTP surface (bind on loopback, `/health`, bearer auth on `/op`, the
//     `stop` op) is driven over a real listening socket, because the whole point
//     of the daemon is that the CLI can reach it there.
//
// No chromium is launched: the only ops exercised over HTTP are ones that must
// answer BEFORE a browser exists (unknown op, stop).
//
// Dimensions covered:
//   - behavior:    op routing, failure-code mapping, close() semantics
//   - integration: real loopback HTTP, real `daemon.json` on disk
//   - a11y:        the envelope a caller sees (ok / code / message)
//   - render:      the JSON body actually written to the socket

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

declareDimensions('tests/unit/services/web/web-daemon-service.test.ts', [
  'behavior',
  'integration',
  'a11y',
  'render',
]);

import { BrowserSessionManager } from '../../../../src/services/web/browser-session-manager.js';
import { readDaemonInfo } from '../../../../src/services/web/daemon-registry.js';
import type { PwBrowser, PwContext, PwPage } from '../../../../src/services/web/playwright-loader.js';
import { PROTOCOL_VERSION } from '../../../../src/services/web/web-protocol.js';
import { startWebDaemon, routeOp } from '../../../../src/services/web/web-daemon-service.js';

const SESSION_ID = '2026-09-10-session-528a63';
const ws = withTmpWorkspacePerTest('peaks-web-daemon-');

const running: Array<() => Promise<unknown>> = [];
const signalListeners: Array<() => void> = [];

afterEach(async () => {
  for (const remove of signalListeners.splice(0)) {
    remove();
  }
  for (const close of running.splice(0)) {
    await close();
  }
});

/** A fake Playwright module: the same seam S1's manager test uses. */
function fakeBrowser(): PwBrowser {
  const page: PwPage = {
    goto: async () => undefined,
    title: async () => 'Fake Title',
    url: () => 'https://example.test/',
    screenshot: async (options?: { path?: string }) => {
      if (options?.path !== undefined) {
        mkdirSync(dirname(options.path), { recursive: true });
        writeFileSync(options.path, 'PNG', 'utf8');
      }
      return Buffer.from('PNG', 'utf8');
    },
    evaluate: async <T,>() => ({ lcp: 12, cls: 0.1, inp: 34 }) as T,
    locator: () => ({
      click: async () => undefined,
      innerText: async () => 'page text',
      ariaSnapshotJSON: async () => [{ role: 'heading', name: 'Hi' }],
      screenshot: async () => Buffer.from('PNG', 'utf8')
    })
  };
  const context: PwContext = {
    newPage: async () => page,
    addInitScript: async () => undefined,
    storageState: async () => undefined,
    close: async () => undefined
  };
  return {
    newContext: async () => context,
    version: () => 'fake-1',
    close: async () => undefined
  };
}

function fakeManager(root: string): BrowserSessionManager {
  return new BrowserSessionManager(fakeBrowser(), { projectRoot: root, sessionId: SESSION_ID });
}

/** A provider that must never be called — for ops that answer without a browser. */
function forbiddenManager(): () => Promise<BrowserSessionManager> {
  return async () => {
    throw new Error('WEB_TEST_BROWSER_LAUNCHED: this op must not acquire chromium');
  };
}

describe('behavior — routeOp', () => {
  it('when open is routed, should return the navigated url and title', async () => {
    // given: a manager over a fake browser and an open request
    const manager = fakeManager(ws().path);
    // when: the op is routed
    const response = await routeOp('open', { url: 'https://example.test/' }, async () => manager);
    // then: the payload carries exactly the url and title
    expect(response.ok).toBe(true);
    expect(response.data).toEqual({ url: 'https://example.test/', title: 'Fake Title' });
  });

  it('when a verb fails with a coded error, should surface that code instead of a generic failure', async () => {
    // given: a manager and a url the scheme allowlist rejects
    const manager = fakeManager(ws().path);
    // when: open is routed with a file: url
    const response = await routeOp('open', { url: 'file:///etc/passwd' }, async () => manager);
    // then: the WEB_URL_SCHEME_REJECTED code survives the trip to the caller
    expect(response.ok).toBe(false);
    expect(response.code).toBe('WEB_URL_SCHEME_REJECTED');
  });

  it('when an op the daemon does not serve is routed, should refuse without acquiring a browser', async () => {
    // given: a manager provider that throws if chromium is ever requested
    // when: an S3/S4 verb is routed
    const response = await routeOp('install', {}, forbiddenManager());
    // then: it is refused by name
    expect(response.ok).toBe(false);
    expect(response.code).toBe('WEB_OP_UNSUPPORTED');
  });

  it('when args carry no dispatch id, should default the browser context to current', async () => {
    // given: a manager and a text request with no dispatchId
    const manager = fakeManager(ws().path);
    // when: text is routed
    const response = await routeOp('text', {}, async () => manager);
    // then: the op succeeds against the default dispatch
    expect(response.ok).toBe(true);
    expect(response.data).toEqual({ text: 'page text', truncated: false, droppedBytes: 0 });
  });

  it('when metrics is routed before any navigation, should report no observation window', async () => {
    // given: a manager whose dispatch has no page yet
    const manager = fakeManager(ws().path);
    // when: metrics is routed
    const response = await routeOp('metrics', {}, async () => manager);
    // then: availability is explicit, never fabricated zeros
    expect(response.data).toEqual({
      available: false,
      reason: 'no-observation-window',
      values: null
    });
  });
});

describe('integration — the listening daemon', () => {
  it('when the daemon starts, should bind loopback and record itself in daemon.json', async () => {
    // given: a start request for a session in a tmp project root
    const daemon = await startWebDaemon({
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      version: '4.0.36'
    });
    running.push(daemon.close);
    // when: the recorded info is read back
    const info = readDaemonInfo(ws().path, SESSION_ID);
    // then: it describes this process on the port actually bound
    expect(info).not.toBeNull();
    expect(info?.port).toBe(daemon.port);
    expect(info?.pid).toBe(process.pid);
    expect(info?.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('when /health is requested, should answer ok without a token', async () => {
    // given: a running daemon
    const daemon = await startWebDaemon({
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      version: '4.0.36'
    });
    running.push(daemon.close);
    // when: /health is fetched anonymously
    const response = await fetch(`http://127.0.0.1:${String(daemon.port)}/health`);
    // then: it reports liveness
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('when /op is called without the bearer token, should refuse', async () => {
    // given: a running daemon
    const daemon = await startWebDaemon({
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      version: '4.0.36'
    });
    running.push(daemon.close);
    // when: /op is posted with no Authorization header
    const response = await fetch(`http://127.0.0.1:${String(daemon.port)}/op`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'metrics', args: {} })
    });
    // then: the caller is rejected before any op routing happens
    expect(response.status).toBe(401);
    const denied = (await response.json()) as { code?: string };
    expect(denied.code).toBe('WEB_DAEMON_UNAUTHORIZED');
  });

  it('when /op is called with the bearer token, should route the op', async () => {
    // given: a running daemon and its token
    const daemon = await startWebDaemon({
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      version: '4.0.36'
    });
    running.push(daemon.close);
    // when: an unserved op is posted with the token
    const response = await fetch(`http://127.0.0.1:${String(daemon.port)}/op`, {
      method: 'POST',
      headers: { authorization: `Bearer ${daemon.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'login', args: {} })
    });
    // then: it reaches the router, which names the unsupported op
    expect(response.status).toBe(200);
    const routed = (await response.json()) as { code?: string };
    expect(routed.code).toBe('WEB_OP_UNSUPPORTED');
  });

  it('when whoami is called with the bearer token, should report its own identity without a browser', async () => {
    // given: a running daemon and its token
    const daemon = await startWebDaemon({
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      version: '4.0.36'
    });
    running.push(daemon.close);
    // when: whoami is posted with the token
    const response = await fetch(`http://127.0.0.1:${String(daemon.port)}/op`, {
      method: 'POST',
      headers: { authorization: `Bearer ${daemon.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'whoami', args: {} })
    });
    // then: it names this process and this session — the ownership proof
    expect(response.status).toBe(200);
    const identity = (await response.json()) as { ok?: boolean; data?: { pid?: number; sessionId?: string } };
    expect(identity.ok).toBe(true);
    expect(identity.data?.pid).toBe(process.pid);
    expect(identity.data?.sessionId).toBe(SESSION_ID);
  });

  it('when whoami is called without the bearer token, should refuse it', async () => {
    // given: a running daemon
    const daemon = await startWebDaemon({
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      version: '4.0.36'
    });
    running.push(daemon.close);
    // when: whoami is posted with the wrong token
    const response = await fetch(`http://127.0.0.1:${String(daemon.port)}/op`, {
      method: 'POST',
      headers: { authorization: `Bearer ${'c'.repeat(64)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'whoami', args: {} })
    });
    // then: the identity is unreachable — which is what makes it evidence
    expect(response.status).toBe(401);
  });

  it('when the stop op is received, should tear the daemon down and remove daemon.json', async () => {
    // given: a running daemon and a listener standing in for the entry's SIGTERM handler
    const daemon = await startWebDaemon({
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      version: '4.0.36'
    });
    let signals = 0;
    const onSignal = (): void => {
      signals += 1;
    };
    process.on('SIGTERM', onSignal);
    signalListeners.push(() => process.removeListener('SIGTERM', onSignal));
    // when: stop is posted with the token
    const response = await fetch(`http://127.0.0.1:${String(daemon.port)}/op`, {
      method: 'POST',
      headers: { authorization: `Bearer ${daemon.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'stop', args: {} })
    });
    // then: the caller is answered, the record is gone, and the entry is signalled to exit
    expect(response.status).toBe(200);
    const accepted = (await response.json()) as { ok?: boolean };
    expect(accepted.ok).toBe(true);
    await waitFor(() => readDaemonInfo(ws().path, SESSION_ID) === null);
    await waitFor(() => signals > 0);
    expect(readDaemonInfo(ws().path, SESSION_ID)).toBeNull();
    expect(signals).toBeGreaterThan(0);
  });
});

describe('behavior — close', () => {
  it('when close is called twice, should tear down once and report the same result', async () => {
    // given: a running daemon
    const daemon = await startWebDaemon({
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      version: '4.0.36'
    });
    // when: close is called twice
    const first = await daemon.close();
    const second = await daemon.close();
    // then: both report the same teardown, with nothing to close
    expect(first).toEqual({ closedContexts: 0, stateWriteFailures: [] });
    expect(second).toEqual(first);
    expect(readDaemonInfo(ws().path, SESSION_ID)).toBeNull();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resume) => {
      setTimeout(resume, 25);
    });
  }
}

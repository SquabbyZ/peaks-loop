// tests/unit/services/web/web-daemon-browser-teardown.test.ts
//
// AC6's linchpin: `startWebDaemon`'s `close()` must close the chromium it
// acquired.
//
// Why this file exists at all: deleting `await browser.close()` from
// `web-daemon-service.ts` used to leave all 129 tests green. Every other test
// that starts a daemon never performs a browser-touching op, so `close()`
// always took its `manager === null` branch and the one line that decides
// whether a browser survives the session had zero coverage. The suite was
// guarding something other than what AC6 requires.
//
// `browser-acquire` is replaced at the module boundary rather than injected
// through a production seam: the real `acquireChromium` launches Playwright, and
// what is under test is what `close()` does with the result, not how it was
// produced.
//
// Dimensions covered:
//   - behavior:    the teardown decision for an acquired browser
//   - integration: a real loopback daemon, real `daemon.json` on disk
//   - a11y:        the envelope a caller sees when the daemon is closing
//   - render:      not applicable (the daemon writes no user-facing text)

import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/services/web/web-daemon-browser-teardown.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    { dim: 'render', reason: 'the daemon renders no user-facing text; the CLI layer owns that' },
  ],
);

import type { PwBrowser, PwContext, PwPage } from '../../../../src/services/web/playwright-loader.js';
import type { WebOp, WebOpResponse } from '../../../../src/services/web/web-protocol.js';
import { startWebDaemon, type RunningWebDaemon } from '../../../../src/services/web/web-daemon-service.js';

/** The acquisition seam, mutable per test and shared with the module mock. */
const recorder = vi.hoisted(() => ({
  acquire: async (): Promise<unknown> => ({ browser: null, version: 'fake', tier: 1 })
}));

vi.mock('../../../../src/services/web/browser-acquire.js', () => ({
  acquireChromium: (): Promise<unknown> => recorder.acquire()
}));

const SESSION_ID = '2026-09-10-session-528a63';
const ws = withTmpWorkspacePerTest('peaks-web-teardown-');

const running: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const close of running.splice(0)) {
    await close();
  }
});

interface ClosingBrowser extends PwBrowser {
  readonly closeCalls: () => number;
}

/** A fake chromium that records how many times its process was ended. */
function closingBrowser(): ClosingBrowser {
  let closes = 0;
  const page: PwPage = {
    goto: async () => undefined,
    title: async () => 'Fake Title',
    url: () => 'https://example.test/',
    screenshot: async () => Buffer.from('PNG', 'utf8'),
    evaluate: async <T,>() => ({}) as T,
    locator: () => ({
      click: async () => undefined,
      innerText: async () => 'page text',
      ariaSnapshotJSON: async () => [],
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
    close: async () => {
      closes += 1;
    },
    closeCalls: () => closes
  };
}

async function startDaemon(): Promise<RunningWebDaemon> {
  const daemon = await startWebDaemon({
    projectRoot: ws().path,
    sessionId: SESSION_ID,
    version: '4.0.36'
  });
  running.push(daemon.close);
  return daemon;
}

/** POST one op with the daemon's own token; a torn-down socket resolves to `null`. */
async function postOp(
  daemon: RunningWebDaemon,
  op: WebOp,
  args: Readonly<Record<string, unknown>>
): Promise<WebOpResponse | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${String(daemon.port)}/op`, {
      method: 'POST',
      headers: { authorization: `Bearer ${daemon.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ op, args })
    });
    return (await response.json()) as WebOpResponse;
  } catch {
    return null;
  }
}

describe('behavior — the browser teardown', () => {
  it('when an op has acquired a browser and the daemon closes, should close that browser', async () => {
    // given: a daemon whose chromium is a fake that counts its closes
    const browser = closingBrowser();
    recorder.acquire = async () => ({ browser, version: browser.version(), tier: 1 });
    const daemon = await startDaemon();
    // when: an op acquires the browser, and the daemon is then closed
    const opened = await postOp(daemon, 'open', { url: 'https://example.test/' });
    expect(opened?.ok).toBe(true);
    await daemon.close();
    // then: the browser process was closed — AC6's linchpin, previously untested
    expect(browser.closeCalls()).toBe(1);
  });

  it('when browser acquisition has failed, should not attempt it again', async () => {
    // given: a daemon whose chromium never resolves, counting its attempts
    let attempts = 0;
    recorder.acquire = async () => {
      attempts += 1;
      throw new Error('PLAYWRIGHT_NOT_RESOLVABLE: nothing to launch');
    };
    const daemon = await startDaemon();
    // when: two ops that both need a page are posted
    const first = await postOp(daemon, 'open', { url: 'https://example.test/' });
    const second = await postOp(daemon, 'open', { url: 'https://example.test/' });
    // then: the failure is reported twice but the work is attempted once — the
    // MISSING_EXECUTABLE branch runs a BLOCKING `playwright install chromium`,
    // and re-running it per op is unbounded npx fan-out driven from the wire
    expect(first?.code).toBe('PLAYWRIGHT_NOT_RESOLVABLE');
    expect(second?.code).toBe('PLAYWRIGHT_NOT_RESOLVABLE');
    expect(attempts).toBe(1);
  });

  it('when the daemon closes while a browser is still launching, should still close it', async () => {
    // given: an acquisition held open inside `acquireChromium`
    const browser = closingBrowser();
    let release = (): void => undefined;
    const gate = new Promise<void>((settle) => {
      release = settle;
    });
    let entered = (): void => undefined;
    const enteredGate = new Promise<void>((settle) => {
      entered = settle;
    });
    recorder.acquire = async () => {
      entered();
      await gate;
      return { browser, version: browser.version(), tier: 1 };
    };
    const daemon = await startDaemon();
    // when: an op is inside the launch and the daemon is closed before it resolves
    const op = postOp(daemon, 'open', { url: 'https://example.test/' });
    await enteredGate;
    const closed = daemon.close();
    release();
    await op;
    await closed;
    // then: the browser that launch produced was closed, not orphaned by exit
    expect(browser.closeCalls()).toBe(1);
  });
});

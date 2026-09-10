// tests/unit/services/web/_login-fake.ts
//
// The fake Playwright module the `peaks web login` tests drive, plus the knobs a
// test turns. Extracted from `web-login-profile.test.ts` when the S4 repair round
// pushed that file past the 800-line scan limit.
//
// THE INVARIANT THIS FILE EXISTS TO KEEP: it must not import — not even
// transitively — anything that resolves to a module the tests mock
// (`node:fs`, `playwright-loader.js`). The test file's `vi.mock` factories
// `await import()` this module, so if `_login-fake.ts` (or anything it pulls in)
// imported a mocked module, the factory would be waiting on a load that is
// waiting on the factory. That is a deadlock, not a slow test.
//
// Everything here is therefore self-contained: `node:path`, and nothing else at
// runtime. The per-test hooks, the redirected HOME and the CLI helpers live in
// `_login-harness.ts`, which is imported STATICALLY by the test file and never
// from inside a mock factory.

import { join } from 'node:path';

// TYPE-ONLY, and erased before this module ever loads: the invariant above holds
// (no runtime import of the mocked `playwright-loader.js`), it just lets the fake
// browser keep the shape the loader declares while `launchDelayMs` defers it.
import type { PwBrowser, PwContext } from '../../../../src/services/web/playwright-loader.js';

/** A cookie value that must never reach stdout, stderr, or an envelope. */
export const SECRET_COOKIE_VALUE = 'COOKIE-VALUE-DO-NOT-PRINT';

/**
 * The knobs a test turns.
 *
 * `closeAfterMs` is the whole completion signal: it fires every `disconnected`
 * listener the way the real browser does when the user CLOSES THE WINDOW, and
 * it fires AFTER the browser is open — which is what makes the wait path (the
 * snapshot loop and the disconnect race) positively exercised rather than
 * short-circuited.
 */
export const pw = {
  launches: 0,
  launchOptions: [] as Array<Record<string, unknown>>,
  cookies: 1,
  origins: 2,
  /**
   * When non-empty, returned verbatim instead of a JSON storage state. It is a
   * STRING, so what lands on disk is `"not a storage state"` — JSON that parses
   * but is not a storage state, which is the corrupt-artifact case.
   */
  stateRaw: '',
  launchFails: false,
  stateFails: false,
  closeFails: false,
  /**
   * true: `browser.close()` never settles — a wedged renderer. The teardown
   * bound is the only thing that ends the run (S4 R3).
   */
  closeHangs: false,
  /**
   * true: the PUBLISH's `renameSync` throws, as `ENOSPC`/`EIO` can after a full
   * disk. Injected at the rename rather than at the write (S4 R5): a write-time
   * throw replaced by the fake's own error never called the real `writeFileSync`,
   * so the byte-equality assertion could not have failed however the publish was
   * implemented. This one fires AFTER the real staged bytes are on disk, and it
   * is the operation whose atomicity the artifact claim rests on.
   */
  failPublishRename: false,
  /**
   * Set by `fsMock` when it injects that failure: whether the staging file the
   * module asked it to rename really existed. Evidence that the injected failure
   * landed after a real write, not inside the fake.
   */
  stagingOnDiskAtRename: false,
  /** true: `newContext` rejects — a failure that still reaches teardown. */
  contextFails: false,
  /** ms `launch()` takes to settle — the setup the login bound has to cover. */
  launchDelayMs: 0,
  /** true: the FIRST `storageState()` rejects with the browser-gone wording. */
  firstReadFailsAsClosed: false,
  /** ms after the browser opens before the user closes the window; 0 = never. */
  closeAfterMs: 0,
  /**
   * true: the browser dies WHILE the page is being created — the disconnect the
   * runner must already be listening for (it is not replayed).
   */
  disconnectOnPageOpen: false,
  /** Every `disconnected` listener the runner registered. */
  onDisconnected: [] as Array<() => void>,
  /** How many times the runner ASKED for the live session, success or not. */
  snapshots: 0,
  /** How many of those asks SUCCEEDED — the only count that proves a cadence. */
  captures: 0,
  /** true once the window has been closed — reads after that must throw. */
  closed: false
};

/** Put every knob back the way a fresh test expects to find it. */
export function resetPw(): void {
  pw.launches = 0;
  pw.launchOptions = [];
  pw.cookies = 1;
  pw.origins = 2;
  pw.stateRaw = '';
  pw.launchFails = false;
  pw.stateFails = false;
  pw.closeFails = false;
  pw.closeHangs = false;
  pw.failPublishRename = false;
  pw.stagingOnDiskAtRename = false;
  pw.contextFails = false;
  pw.launchDelayMs = 0;
  pw.firstReadFailsAsClosed = false;
  pw.closeAfterMs = 0;
  pw.disconnectOnPageOpen = false;
  pw.onDisconnected = [];
  pw.snapshots = 0;
  pw.captures = 0;
  pw.closed = false;
}

/**
 * The publish's RENAME is the one failure a fake Playwright cannot reach — it is
 * a `node:fs` call inside the module under test — so `renameSync` is wrapped
 * here, and ONLY for a staging source. Everything else is the real `node:fs`
 * (spread through), so the write that precedes it really happens and the
 * artifact assertions are still made against a real filesystem.
 *
 * Injecting at the rename rather than at the write is deliberate (S4 R5): the
 * previous write-time injection threw BEFORE calling the real `writeFileSync`,
 * which meant no test could observe what a failed publish leaves on disk — a
 * faithfully reverted, non-atomic publish passed the suite. This injection fires
 * after the staged bytes exist, and records that fact in
 * `pw.stagingOnDiskAtRename`.
 */
export function fsMock(actual: typeof import('node:fs')): typeof import('node:fs') {
  return {
    ...actual,
    renameSync: (
      from: Parameters<typeof actual.renameSync>[0],
      to: Parameters<typeof actual.renameSync>[1]
    ) => {
      if (pw.failPublishRename && typeof from === 'string' && from.endsWith('.staging')) {
        pw.stagingOnDiskAtRename = actual.existsSync(from);
        throw new Error('ENOSPC: no space left on device, rename');
      }
      return actual.renameSync(from, to);
    }
  };
}

export function loaderMock(
  actual: typeof import('../../../../src/services/web/playwright-loader.js')
): typeof import('../../../../src/services/web/playwright-loader.js') {
  // The narrow shape is accepted on purpose, exactly as the module cast below
  // says: `newPage()` returns `{}`, because only these four members are touched.
  const fakeContext = {
    newPage: () => {
      if (pw.disconnectOnPageOpen) {
        // The window is closed while the page is still being created. The event
        // is NOT replayed, so only a listener registered before this point sees
        // it (code review F3).
        pw.closed = true;
        for (const listener of pw.onDisconnected) {
          listener();
        }
      }
      return Promise.resolve({});
    },
    addInitScript: () => Promise.resolve(),
    close: () => Promise.resolve(),
    storageState: () => {
      // Every ASK, successful or not. The cadence claim is about the asks that
      // SUCCEED, which is why `captures` is counted separately: the post-close
      // read below is an ask that FAILS, and counting it as evidence would let a
      // loop that snapshotted once and then waited pass (test review F1).
      pw.snapshots += 1;
      if (pw.stateFails) {
        return Promise.reject(new Error('WEB_STATE_WRITE_FAILED: synthetic'));
      }
      // The close landed, but its `disconnected` event has NOT reached the runner
      // yet — so the first ask fails for a reason the runner's `closed()` check
      // cannot see (S4 R5 / F3). It must not be reported as a read failure.
      if (pw.firstReadFailsAsClosed && pw.snapshots === 1) {
        return Promise.reject(
          new Error('browserContext.storageState: Target page, context or browser has been closed')
        );
      }
      // Faithful to the pinned playwright@1.63.0, verified on this machine: once
      // the browser is gone the non-persistent context can no longer be read, so
      // a post-close read throws rather than returning the session.
      if (pw.closed) {
        return Promise.reject(
          new Error('browserContext.storageState: Target page, context or browser has been closed')
        );
      }
      pw.captures += 1;
      // Called with NO `path` — the real call returns the state object and the
      // runner is the one that writes it, once, on close. There is no second
      // on-disk artifact to write here.
      return Promise.resolve(
        pw.stateRaw !== ''
          ? pw.stateRaw
          : {
              cookies: new Array(pw.cookies).fill({ name: 'sid', value: SECRET_COOKIE_VALUE }),
              origins: new Array(pw.origins).fill({ origin: 'https://example.test' })
            }
      );
    }
  } as unknown as PwContext;
  return {
    ...actual,
    loadPlaywright: () =>
      Promise.resolve({
        chromium: {
          executablePath: () => join('fake', 'chromium'),
          launch: (options?: Record<string, unknown>) => {
            pw.launches += 1;
            pw.launchOptions.push(options ?? {});
            if (pw.launchFails) {
              return Promise.reject(new Error('WEB_LAUNCH_FAILED: synthetic'));
            }
            if (pw.closeAfterMs > 0) {
              setTimeout(() => {
                pw.closed = true;
                for (const listener of pw.onDisconnected) {
                  listener();
                }
              }, pw.closeAfterMs);
            }
            const browser: PwBrowser = {
              newContext: () =>
                pw.contextFails
                  ? Promise.reject(new Error('WEB_CONTEXT_FAILED: synthetic'))
                  : Promise.resolve(fakeContext),
              version: () => '1.63.0',
              // The real `Browser.isConnected()`. A test that starts with
              // `pw.closed = true` models a browser that disconnected before the
              // wait began.
              isConnected: () => !pw.closed,
              on: (event: string, listener: () => void) => {
                if (event === 'disconnected') {
                  pw.onDisconnected.push(listener);
                }
              },
              close: () => {
                if (pw.closeHangs) {
                  return new Promise<void>(() => undefined);
                }
                return pw.closeFails
                  ? Promise.reject(new Error('WEB_CLOSE_FAILED: synthetic'))
                  : Promise.resolve();
              }
            };
            // Setup really costs the login its budget, so one test makes the
            // launch itself take time (S4 R5): with the deadline taken BEFORE
            // the launch, that delay is spent from the wait.
            return pw.launchDelayMs > 0
              ? new Promise((settle) => setTimeout(() => settle(browser), pw.launchDelayMs))
              : Promise.resolve(browser);
          }
        }
      })
    // A fake is deliberately NOT the real module: its page object has only what
    // the login path touches, so `newPage()` returns `{}` rather than a whole
    // `PwPage`. Declaring the return type as the module type is what lets the
    // call sites stay typed; the assertion below is the seam where the fake's
    // narrower shape is accepted on purpose. (Inline in `vi.mock` this was
    // implicit in the factory's own loose type.)
  } as typeof import('../../../../src/services/web/playwright-loader.js');
}

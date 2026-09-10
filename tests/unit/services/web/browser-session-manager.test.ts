// tests/unit/services/web/browser-session-manager.test.ts
//
// The context-per-dispatch layer (Q8 / C1) and the six page ops, driven through
// a hand-written FAKE Playwright module injected via the constructor. No
// browser, no npx, no child process: `BrowserSessionManager` depends only on the
// structural `PwBrowser` / `PwContext` / `PwPage` interfaces declared in
// `playwright-loader.ts`, so the fake is the whole seam.
//
// This file exists because the module had zero tests and zero importers when the
// BLOCKING defect shipped: `contextFor` passed `webDir(...)` as the guard parent
// for a state file that lives under the SIBLING `pw-profiles/` directory, so
// every verb threw `WEB_PATH_ESCAPE` before a browser was touched and `closeAll`
// silently persisted nothing. The first `it` below is that regression — it fails
// against the pre-repair code and passes after it.
//
// Dimensions covered:
//   - behavior:    context dedup, teardown, and the per-verb payload shape
//   - integration: real filesystem writes under a tmp workspace (shot, storageState)
//   - render:      not applicable (returns structures; the CLI layer owns rendering)
//   - a11y:        not applicable (no user-visible text or exit code at this layer)

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/services/web/browser-session-manager.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the six verbs return structures; the CLI layer owns every text surface' },
    { dim: 'a11y', reason: 'no user-visible text or exit code is produced at this layer' },
  ],
);

import { BrowserSessionManager } from '../../../../src/services/web/browser-session-manager.js';
import { MAX_TEXT_BYTES } from '../../../../src/services/web/bounded-output.js';
import type { PwBrowser, PwContext, PwPage } from '../../../../src/services/web/playwright-loader.js';
import { webDir } from '../../../../src/services/web/web-artifact-paths.js';

const SESSION_ID = '2026-09-10-session-528a63';
const SHOT_BYTES = 'PNGDATA';
const ws = withTmpWorkspacePerTest('peaks-web-session-');

interface FakeLocatorRecord {
  readonly selector: string;
  clickCalls: number;
  innerTextCalls: number;
  ariaSnapshotCalls: number;
}

interface FakePageRecord {
  readonly page: PwPage;
  readonly gotoCalls: string[];
  readonly locators: FakeLocatorRecord[];
  readonly screenshotPaths: Array<string | undefined>;
  title: string;
  urlValue: string;
  innerText: string;
  ariaSnapshot: unknown;
  vitals: unknown;
  hasAriaSnapshot: boolean;
}

interface FakeContextRecord {
  readonly options: Record<string, unknown>;
  readonly initScripts: string[];
  readonly storageStateCalls: Array<string | undefined>;
  readonly pages: FakePageRecord[];
  closeCalls: number;
  closeThrows: boolean;
  storageStateThrows: boolean;
  /** A Playwright call that never comes back — the wedged-teardown case. */
  closeHangs: boolean;
}

interface FakeBrowser {
  readonly browser: PwBrowser;
  readonly contexts: FakeContextRecord[];
}

/** A screenshot writes real bytes, so `shot()`'s `statSync` sees a real size. */
function writeShotFile(path: string | undefined): void {
  if (path === undefined) {
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, SHOT_BYTES, 'utf8');
}

function makeFakePage(record: FakePageRecord): PwPage {
  return {
    goto: async (url: string) => {
      record.gotoCalls.push(url);
      record.urlValue = url;
    },
    title: async () => record.title,
    url: () => record.urlValue,
    screenshot: async (options?: { path?: string }): Promise<Buffer> => {
      record.screenshotPaths.push(options?.path);
      writeShotFile(options?.path);
      return Buffer.from(SHOT_BYTES, 'utf8');
    },
    evaluate: async <T,>(): Promise<T> => record.vitals as T,
    locator: (selector: string) => {
      const locatorRecord: FakeLocatorRecord = {
        selector,
        clickCalls: 0,
        innerTextCalls: 0,
        ariaSnapshotCalls: 0,
      };
      record.locators.push(locatorRecord);
      return {
        click: async () => {
          locatorRecord.clickCalls += 1;
        },
        innerText: async () => {
          locatorRecord.innerTextCalls += 1;
          return record.innerText;
        },
        screenshot: async (options?: { path?: string }): Promise<Buffer> => {
          record.screenshotPaths.push(options?.path);
          writeShotFile(options?.path);
          return Buffer.from(SHOT_BYTES, 'utf8');
        },
        ...(record.hasAriaSnapshot
          ? {
              ariaSnapshotJSON: async (): Promise<unknown> => {
                locatorRecord.ariaSnapshotCalls += 1;
                return record.ariaSnapshot;
              },
            }
          : {}),
      };
    },
  };
}

/**
 * A fake browser whose pages start from `pageDefaults`. Only `pageDefaults` may
 * configure a page: the manager creates its own page through `pageFor`, so a
 * page created by the test would be a different object than the one under test.
 */
function makeFakeBrowser(pageDefaults: Partial<FakePageRecord> = {}): FakeBrowser {
  const contexts: FakeContextRecord[] = [];
  const browser: PwBrowser = {
    newContext: async (options: Record<string, unknown> = {}) => {
      const pages: FakePageRecord[] = [];
      const contextRecord: FakeContextRecord = {
        options,
        initScripts: [],
        storageStateCalls: [],
        pages,
        closeCalls: 0,
        closeThrows: false,
        storageStateThrows: false,
        closeHangs: false,
      };
      const context: PwContext = {
        newPage: async () => {
          const record: FakePageRecord = {
            page: undefined as unknown as PwPage,
            gotoCalls: [],
            locators: [],
            screenshotPaths: [],
            title: '',
            urlValue: 'about:blank',
            innerText: '',
            ariaSnapshot: [],
            vitals: null,
            hasAriaSnapshot: true,
            ...pageDefaults,
          };
          record.page = makeFakePage(record);
          pages.push(record);
          return record.page;
        },
        addInitScript: async (script: string) => {
          contextRecord.initScripts.push(script);
        },
        storageState: async (storageOptions?: { path?: string }) => {
          if (contextRecord.storageStateThrows) {
            throw new Error('EACCES: storageState could not be written');
          }
          contextRecord.storageStateCalls.push(storageOptions?.path);
          return {};
        },
        close: async () => {
          contextRecord.closeCalls += 1;
          if (contextRecord.closeHangs) {
            await new Promise<never>(() => undefined);
          }
          if (contextRecord.closeThrows) {
            throw new Error('context already closed');
          }
        },
      };
      contexts.push(contextRecord);
      return context;
    },
    version: () => '1.63.0',
    close: async () => undefined,
  };
  return { browser, contexts };
}

function managerFor(fake: FakeBrowser, root: string): BrowserSessionManager {
  return new BrowserSessionManager(fake.browser, { projectRoot: root, sessionId: SESSION_ID });
}

/** The page the manager created for the given context, after the op has run. */
function pageRecord(fake: FakeBrowser, contextIndex = 0, pageIndex = 0): FakePageRecord {
  const record = fake.contexts[contextIndex]?.pages[pageIndex];
  if (record === undefined) {
    throw new Error('the manager created no page for that context');
  }
  return record;
}

describe('behavior — context per dispatch', () => {
  it('when a dispatch context is created, should accept the storage-state path under its own guard', async () => {
    // given: a session manager over a tmp project root and one dispatch id
    // when:  the dispatch context is created
    // then:  the state path is accepted (it lives under pw-profiles/, a sibling of web/)
    const fake = makeFakeBrowser();
    const manager = managerFor(fake, ws().path);
    await expect(manager.contextFor('dispatch-1')).resolves.toBeDefined();
    expect(fake.contexts).toHaveLength(1);
  });

  it('when a context already exists for a dispatch, should reuse it instead of creating a second one', async () => {
    // given: a manager that already created a context for a dispatch id
    // when:  the same dispatch id is requested again
    // then:  the same context comes back and no second one was created
    const fake = makeFakeBrowser();
    const manager = managerFor(fake, ws().path);
    const first = await manager.contextFor('dispatch-1');
    const second = await manager.contextFor('dispatch-1');
    expect(second).toBe(first);
    expect(fake.contexts).toHaveLength(1);
  });

  it('when two dispatch ids are used, should give each its own context', async () => {
    // given: two distinct dispatch ids in one session
    // when:  both contexts are created
    // then:  they are distinct context objects, one per dispatch id
    const fake = makeFakeBrowser();
    const manager = managerFor(fake, ws().path);
    const first = await manager.contextFor('dispatch-1');
    const second = await manager.contextFor('dispatch-2');
    expect(second).not.toBe(first);
    expect(fake.contexts).toHaveLength(2);
  });

  it('when a dispatch id arrives past the context cap, should refuse it by name', async () => {
    // given: a manager already holding the maximum number of dispatch contexts
    const fake = makeFakeBrowser();
    const manager = managerFor(fake, ws().path);
    const cap = 32;
    for (let index = 0; index < cap; index += 1) {
      await manager.contextFor(`dispatch-${String(index)}`);
    }
    // when:  one more distinct dispatch id asks for a context
    // then:  it is refused with a code, instead of growing the daemon forever
    await expect(manager.contextFor('dispatch-overflow')).rejects.toThrow(/WEB_DISPATCH_LIMIT/);
    expect(fake.contexts).toHaveLength(cap);
  });
});

describe('behavior — the six page ops', () => {
  it('when the page title is oversized, should cap the open payload', async () => {
    // given: a page whose title is far larger than the byte ceiling
    // when:  open runs
    // then:  both url and title are within MAX_TEXT_BYTES
    const fake = makeFakeBrowser({ title: 'x'.repeat(50_000) });
    const manager = managerFor(fake, ws().path);
    const result = await manager.open('dispatch-1', 'https://example.test/');
    expect(Buffer.byteLength(result.title, 'utf8')).toBeLessThanOrEqual(MAX_TEXT_BYTES);
    expect(Buffer.byteLength(result.url, 'utf8')).toBeLessThanOrEqual(MAX_TEXT_BYTES);
  });

  it('when the page title is oversized, should cap the click payload', async () => {
    // given: a page whose title is far larger than the byte ceiling
    // when:  click runs
    // then:  the locator was clicked once and the result is within MAX_TEXT_BYTES
    const fake = makeFakeBrowser({ title: 'y'.repeat(50_000) });
    const manager = managerFor(fake, ws().path);
    const result = await manager.click('dispatch-1', '#submit');
    const record = pageRecord(fake);
    expect(record.locators.some((entry) => entry.selector === '#submit' && entry.clickCalls === 1)).toBe(
      true,
    );
    expect(Buffer.byteLength(result.result, 'utf8')).toBeLessThanOrEqual(MAX_TEXT_BYTES);
  });

  it('when the page overwrites the vitals global with junk, should report no observation window', async () => {
    // given: a page that replaced __peaksWebVitals with a multi-megabyte junk object
    // when:  metrics runs
    // then:  the page's object is not echoed; availability is false instead
    const fake = makeFakeBrowser({ vitals: { junk: 'z'.repeat(5_000_000) } });
    const manager = managerFor(fake, ws().path);
    await manager.open('dispatch-1', 'https://example.test/');
    const result = await manager.metrics('dispatch-1');
    expect(result.available).toBe(false);
    expect(result.values).toBeNull();
  });

  it('when the page adds junk beside real vitals, should keep the numbers and drop the rest', async () => {
    // given: a page with a numeric lcp, a numeric cls, a junk key and a mistyped inp
    // when:  metrics runs on an opened page
    // then:  only the three contract keys survive, junk is gone, inp became null
    const fake = makeFakeBrowser({
      vitals: { lcp: 12.5, cls: 0.02, inp: { hostile: true }, junk: 'z'.repeat(5_000_000) },
    });
    const manager = managerFor(fake, ws().path);
    await manager.open('dispatch-1', 'https://example.test/');
    const result = await manager.metrics('dispatch-1');
    expect(result.available).toBe(true);
    expect(result.values).toEqual({ lcp: 12.5, cls: 0.02, inp: null });
  });

  it('when metrics is asked for a dispatch with no page, should report no observation window', async () => {
    // given: a dispatch that never opened a page
    // when:  metrics runs
    // then:  availability is false with a reason rather than fabricated numbers
    const fake = makeFakeBrowser();
    const manager = managerFor(fake, ws().path);
    const result = await manager.metrics('dispatch-1');
    expect(result.available).toBe(false);
    expect(result.reason).toBe('no-observation-window');
    expect(result.values).toBeNull();
  });

  it('when the aria payload is not a node array, should surface an explicit shape error', async () => {
    // given: an ariaSnapshotJSON payload that is not an array
    // when:  snap runs
    // then:  the malformed payload is an error rather than an empty ok snapshot
    const fake = makeFakeBrowser({ ariaSnapshot: { not: 'an array' } });
    const manager = managerFor(fake, ws().path);
    await expect(manager.snap('dispatch-1')).rejects.toThrow(/WEB_SNAP_SHAPE_UNEXPECTED/);
  });

  it('when the aria payload is an array of non-nodes, should surface an explicit shape error', async () => {
    // given: an ariaSnapshotJSON payload that is an array of non-node values
    // when:  snap runs
    // then:  the dropped nodes are reported as an error, not as an empty page
    const fake = makeFakeBrowser({ ariaSnapshot: [null, 'text', 42] });
    const manager = managerFor(fake, ws().path);
    await expect(manager.snap('dispatch-1')).rejects.toThrow(/WEB_SNAP_SHAPE_UNEXPECTED/);
  });

  it('when the aria payload is a valid tree, should render the pruned snapshot', async () => {
    // given: a two-node aria tree
    // when:  snap runs
    // then:  the rendered snapshot carries both roles
    const fake = makeFakeBrowser({
      ariaSnapshot: [
        { role: 'heading', name: 'Title' },
        { role: 'button', name: 'Go' },
      ],
    });
    const manager = managerFor(fake, ws().path);
    const result = await manager.snap('dispatch-1');
    expect(result.snapshot).toContain('heading "Title"');
    expect(result.snapshot).toContain('button "Go"');
  });

  it('when open is given a non-http url, should refuse before creating a context', async () => {
    // given: a file: url, which would read the local disk
    // when:  open runs
    // then:  the scheme is rejected and no context was ever created
    const fake = makeFakeBrowser();
    const manager = managerFor(fake, ws().path);
    await expect(manager.open('dispatch-1', 'file:///C:/Users/x/.ssh/id_rsa')).rejects.toThrow(
      /WEB_URL_SCHEME_REJECTED/,
    );
    expect(fake.contexts).toHaveLength(0);
  });

  it('when open is given a relative url, should refuse rather than guess a base', async () => {
    // given: a url with no scheme
    // when:  open runs
    // then:  the malformed url is an explicit error
    const fake = makeFakeBrowser();
    const manager = managerFor(fake, ws().path);
    await expect(manager.open('dispatch-1', 'example.test')).rejects.toThrow(/WEB_URL_INVALID/);
  });
});

describe('integration — teardown and screenshots on a real tmp workspace', () => {
  it('when closeAll runs, should close every context exactly once and persist each state', async () => {
    // given: two dispatches with live contexts
    // when:  closeAll runs
    // then:  each context is closed exactly once and its state was written once
    const fake = makeFakeBrowser();
    const manager = managerFor(fake, ws().path);
    await manager.contextFor('dispatch-1');
    await manager.contextFor('dispatch-2');
    const result = await manager.closeAll();
    expect(result.closedContexts).toBe(2);
    expect(fake.contexts.map((entry) => entry.closeCalls)).toEqual([1, 1]);
    expect(result.stateWriteFailures).toHaveLength(0);
    expect(fake.contexts.map((entry) => entry.storageStateCalls.length)).toEqual([1, 1]);
  });

  it('when a storage-state write fails, should report it rather than swallow it', async () => {
    // given: a context whose storageState write raises
    // when:  closeAll runs
    // then:  the failure names the dispatch and the context is still closed
    const fake = makeFakeBrowser();
    const manager = managerFor(fake, ws().path);
    await manager.contextFor('dispatch-1');
    const record = fake.contexts[0];
    if (record === undefined) {
      throw new Error('no fake context');
    }
    record.storageStateThrows = true;
    const result = await manager.closeAll();
    expect(result.stateWriteFailures.map((entry) => entry.dispatchId)).toEqual(['dispatch-1']);
    expect(result.stateWriteFailures[0]?.reason).toContain('storageState could not be written');
    expect(record.closeCalls).toBe(1);
  });

  it('when one context is already closed, should still close the remaining one', async () => {
    // given: a first context whose close() raises
    // when:  closeAll runs
    // then:  the second context is still closed, so teardown reached the end
    const fake = makeFakeBrowser();
    const manager = managerFor(fake, ws().path);
    await manager.contextFor('dispatch-1');
    await manager.contextFor('dispatch-2');
    const first = fake.contexts[0];
    if (first === undefined) {
      throw new Error('no fake context');
    }
    first.closeThrows = true;
    await manager.closeAll();
    expect(fake.contexts.map((entry) => entry.closeCalls)).toEqual([1, 1]);
  });

  it('when one context close never returns, should finish the teardown anyway', async () => {
    // given: a wedged context ahead of a healthy one — a hung Playwright call,
    // which is what makes the caller fall back to SIGTERM (= `TerminateProcess`
    // on Windows) and orphan the browser it was mid-way through closing
    const fake = makeFakeBrowser();
    const manager = managerFor(fake, ws().path);
    await manager.contextFor('dispatch-1');
    await manager.contextFor('dispatch-2');
    const wedged = fake.contexts[0];
    if (wedged === undefined) {
      throw new Error('no fake context');
    }
    wedged.closeHangs = true;
    // when:  closeAll runs
    const result = await manager.closeAll();
    // then:  the wedged step is bounded and abandoned, the next context is
    //        still closed, and it is reported as not closed rather than counted
    expect(result.closedContexts).toBe(1);
    expect(fake.contexts.map((entry) => entry.closeCalls)).toEqual([1, 1]);
  }, 20_000);

  it('when shot runs, should write only to the path it is given, under web/', async () => {
    // given: a page with a live context in a tmp project root
    // when:  shot takes a full-page screenshot
    // then:  the file lands under web/, the root gains no entry, and the path matches
    const fake = makeFakeBrowser();
    const root = ws().path;
    const manager = managerFor(fake, root);
    const result = await manager.shot('dispatch-1');
    const givenPath = pageRecord(fake).screenshotPaths[0];
    expect(givenPath).toBe(result.path);
    expect(result.path).toContain(join(webDir(root, SESSION_ID), 'shot-'));
    expect(result.bytes).toBe(Buffer.byteLength(SHOT_BYTES, 'utf8'));
    expect(readdirSync(root)).toEqual(['.peaks']);
  });
});

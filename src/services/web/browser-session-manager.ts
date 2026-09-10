/**
 * All Playwright operations for `peaks web` (slice S1, file 11).
 *
 * One browser process per session; one browser CONTEXT per dispatch (Q8). The
 * context is what isolates cookies/localStorage between dispatches, which is
 * why the per-dispatch `pw-profiles/<dispatchId>` convention stores a
 * Playwright `storageState.json` and never a Chromium `userDataDir`
 * (orchestrator decision C1 — `launchPersistentContext` would spawn one browser
 * process per dispatch and violate Q8).
 *
 * Every write target is passed through `assertUnder` and every screenshot uses
 * an explicit absolute `path`, so nothing can land in the project root (AC1).
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { getErrorMessage } from 'peaks-loop-shared/result';

import { capText, MAX_SNAP_BYTES, MAX_SNAP_DEPTH, MAX_TEXT_BYTES } from './bounded-output.js';
import type { PwBrowser, PwContext, PwPage } from './playwright-loader.js';
import { pruneAriaSnapshot, renderSnapshot, type AriaNode } from './snapshot-pruner.js';
import {
  assertUnder,
  webContextStatePath,
  webDir,
  webProfilesDir,
  webShotPath
} from './web-artifact-paths.js';

/**
 * Core Web Vitals need observers registered BEFORE the page loads
 * (orchestrator decision C4), so this is installed as a context init script
 * rather than run after navigation.
 */
const VITALS_INIT_SCRIPT = `(() => {
  if (globalThis.__peaksWebVitals) return;
  const vitals = (globalThis.__peaksWebVitals = { lcp: null, cls: 0, inp: null });
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      if (entries.length > 0) vitals.lcp = entries[entries.length - 1].startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) vitals.cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      if (entries.length > 0) {
        vitals.inp = Math.max(vitals.inp ?? 0, entries[entries.length - 1].duration);
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  } catch {
    // Observer types unsupported by this engine: metrics stays unavailable.
  }
})();`;

export interface BrowserSessionManagerOptions {
  readonly projectRoot: string;
  readonly sessionId: string;
}

export interface WebTextResult {
  readonly text: string;
  readonly truncated: boolean;
  readonly droppedBytes: number;
}

export interface WebSnapResult {
  readonly snapshot: string;
  readonly droppedNodes: number;
  readonly depthCapped: boolean;
  readonly nodeCapped: boolean;
  readonly truncated: boolean;
  readonly droppedBytes: number;
}

export interface WebMetricsResult {
  readonly available: boolean;
  readonly reason: string | null;
  readonly values: Readonly<Record<string, unknown>> | null;
}

/**
 * Total budget for one teardown, and the budget for any single step inside it.
 *
 * `stopDaemon` waits `STOP_EXIT_TIMEOUT_MS = 10 s` for the daemon to leave and
 * then falls back to `SIGTERM`, which on Windows is `TerminateProcess`: it kills
 * the daemon mid-teardown and orphans its chromium. An unbounded `closeAll` /
 * `browser.close` therefore converts a SLOW teardown into a LEAKED browser — so
 * every step is bounded, and the whole thing finishes inside the waiter.
 *
 * Retuned after the S3 acceptance run recorded
 * `teardown step failed: WEB_TEARDOWN_TIMEOUT: browser.close did not finish
 * within 1500 ms` on a loaded machine. Measured here: an idle `browser.close()`
 * on the headless shell takes **102 ms**, so the old step budget left only ~15×
 * on a quiet box and ran out when the machine was busy. The step budget is now
 * 2 000 ms.
 *
 * The loop budget stays ABOVE the step budget — that ordering is a separate
 * guarantee, tested by its own case: after ONE wedged step is abandoned, the
 * loop must still reach the remaining contexts. So the constant that moved to
 * pay for the larger step is the waiter, not the loop:
 *
 *     loop 3 000 + 4 x step 2 000 = 11 000 ms  <  STOP_EXIT_TIMEOUT_MS = 15 000 ms
 *
 * (worst case: the loop's last iteration starts just under its deadline and
 * runs two steps, then `browser.close`, then `stopListening`). The waiter polls,
 * so a normal teardown returns as soon as the process exits and pays nothing for
 * the larger ceiling; what it buys is that a slow-but-bounded teardown is no
 * longer SIGTERM'd mid-way, which is what orphans a chromium (AC6). The failure
 * stays visible either way: `reportTeardownFailure` writes every overrun to
 * `daemon.log`, which is how this one was found.
 */
const TEARDOWN_BUDGET_MS = 3_000;
const TEARDOWN_STEP_TIMEOUT_MS = 2_000;

/**
 * The most distinct dispatch contexts one daemon will hold open.
 *
 * A `dispatchId` comes off the wire and there is deliberately no idle-exit
 * (Q7), so an unbounded map would let a token-holder grow the daemon's memory
 * one context at a time for its whole life. Past the cap the op is refused by
 * name rather than silently evicting a context a live dispatch is still using.
 */
const MAX_DISPATCH_CONTEXTS = 32;

/** One dispatch whose storage state could not be persisted at teardown. */
export interface StateWriteFailure {
  readonly dispatchId: string;
  readonly reason: string;
}

/**
 * Resolve with `work`, or reject once the step has taken longer than the step
 * budget. The late settlement of `work` is consumed here, so a step that
 * finishes after its deadline cannot become an unhandled rejection.
 */
export function boundedTeardownStep<T>(work: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((settle, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `WEB_TEARDOWN_TIMEOUT: ${label} did not finish within ${String(TEARDOWN_STEP_TIMEOUT_MS)} ms`
        )
      );
    }, TEARDOWN_STEP_TIMEOUT_MS);
    work.then(
      (value) => {
        clearTimeout(timer);
        settle(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export interface CloseAllResult {
  /** Contexts closed during this call. */
  readonly closedContexts: number;
  /** Never silent: teardown still proceeds, but the caller can report this. */
  readonly stateWriteFailures: readonly StateWriteFailure[];
}

interface DispatchSession {
  readonly context: PwContext;
  page: PwPage | null;
}

export class BrowserSessionManager {
  private readonly browser: PwBrowser;
  private readonly projectRoot: string;
  private readonly sessionId: string;
  private readonly sessions = new Map<string, DispatchSession>();

  constructor(browser: PwBrowser, options: BrowserSessionManagerOptions) {
    this.browser = browser;
    this.projectRoot = options.projectRoot;
    this.sessionId = options.sessionId;
  }

  /** The context for a dispatch, created on first use and reused afterwards. */
  async contextFor(dispatchId: string): Promise<PwContext> {
    const existing = this.sessions.get(dispatchId);
    if (existing !== undefined) {
      return existing.context;
    }
    if (this.sessions.size >= MAX_DISPATCH_CONTEXTS) {
      throw new Error(
        `WEB_DISPATCH_LIMIT: this daemon already holds ${String(MAX_DISPATCH_CONTEXTS)} dispatch contexts; ` +
          'stop the daemon to release them'
      );
    }
    const statePath = webContextStatePath(this.projectRoot, this.sessionId, dispatchId);
    // The state file lives under `pw-profiles/`, a SIBLING of `web/` — guarding
    // it with `webDir` rejects every dispatch.
    assertUnder(statePath, webProfilesDir(this.projectRoot, this.sessionId));
    const context = await this.browser.newContext({
      acceptDownloads: false,
      ...(existsSync(statePath) ? { storageState: statePath } : {})
    });
    await context.addInitScript(VITALS_INIT_SCRIPT);
    this.sessions.set(dispatchId, { context, page: null });
    return context;
  }

  async open(dispatchId: string, url: string): Promise<{ url: string; title: string }> {
    assertNavigableUrl(url);
    const page = await this.pageFor(dispatchId);
    await page.goto(url, { waitUntil: 'load' });
    // `url()` after redirects and `title()` are both page-controlled.
    return {
      url: capText(page.url(), MAX_TEXT_BYTES).text,
      title: capText(await page.title(), MAX_TEXT_BYTES).text
    };
  }

  async text(dispatchId: string, selector?: string): Promise<WebTextResult> {
    const page = await this.pageFor(dispatchId);
    const raw = await page.locator(selector ?? 'body').innerText();
    const capped = capText(raw, MAX_TEXT_BYTES);
    return { text: capped.text, truncated: capped.truncated, droppedBytes: capped.droppedBytes };
  }

  /**
   * Primary path is `locator.ariaSnapshotJSON()` (Playwright 1.63, our exact
   * pin). We do NOT re-derive the tree from the YAML form: parsing YAML by
   * indentation is the fragile option, and under an exact pin the JSON API is
   * always present (tech-doc §4.1/§4.2). A missing API is an explicit error
   * rather than a silent degradation.
   */
  async snap(dispatchId: string, selector?: string): Promise<WebSnapResult> {
    const page = await this.pageFor(dispatchId);
    const locator = page.locator(selector ?? 'body');
    const captureJson = locator.ariaSnapshotJSON?.bind(locator);
    if (captureJson === undefined) {
      throw new Error(
        `WEB_SNAP_UNSUPPORTED: locator.ariaSnapshotJSON is missing (peaks web pins playwright@1.63.0)`
      );
    }
    const raw = await captureJson({ mode: 'default', depth: MAX_SNAP_DEPTH });
    const pruned = pruneAriaSnapshot(asAriaNodes(raw));
    const capped = capText(renderSnapshot(pruned.nodes), MAX_SNAP_BYTES);
    return {
      snapshot: capped.text,
      droppedNodes: pruned.droppedNodes,
      depthCapped: pruned.depthCapped,
      nodeCapped: pruned.nodeCapped,
      truncated: capped.truncated,
      droppedBytes: capped.droppedBytes
    };
  }

  async click(dispatchId: string, selector: string): Promise<{ result: string }> {
    const page = await this.pageFor(dispatchId);
    await page.locator(selector).click();
    // The interpolated title is page-controlled; only the selector is ours.
    return { result: capText(`clicked ${selector} (page: ${await page.title()})`, MAX_TEXT_BYTES).text };
  }

  /**
   * Screenshot to an absolute path under `web/`. Always an explicit `path`:
   * never the Playwright default, and never a Buffer we write ourselves
   * (tech-doc §7.2 rule 3).
   */
  async shot(dispatchId: string, selector?: string): Promise<{ path: string; bytes: number }> {
    const page = await this.pageFor(dispatchId);
    const target = webShotPath(this.projectRoot, this.sessionId, shotTimestamp());
    assertUnder(target, webDir(this.projectRoot, this.sessionId));
    mkdirSync(dirname(target), { recursive: true });
    if (selector === undefined) {
      await page.screenshot({ path: target, type: 'png' });
    } else {
      await page.locator(selector).screenshot({ path: target, type: 'png' });
    }
    return { path: target, bytes: statSync(target).size };
  }

  /**
   * Core Web Vitals for the dispatch's page. Returns `available: false` with a
   * reason — never fabricated zeros — when there is no observation window
   * (orchestrator decision C4), and never echoes the page's object back: only
   * the three contract keys, only finite numbers (R2).
   */
  async metrics(dispatchId: string): Promise<WebMetricsResult> {
    const session = this.sessions.get(dispatchId);
    if (session === undefined || session.page === null) {
      return { available: false, reason: 'no-observation-window', values: null };
    }
    const values = readVitals(
      await session.page.evaluate<unknown>('globalThis.__peaksWebVitals ?? null')
    );
    if (values === null) {
      return { available: false, reason: 'no-observation-window', values: null };
    }
    return { available: true, reason: null, values };
  }

  /**
   * Persist each dispatch's storage state, then close every context exactly
   * once. A state file that cannot be written must not block shutdown — but it
   * must be reported: a silent skip here kills S4's persistence with no signal
   * anywhere (R1).
   */
  async closeAll(): Promise<CloseAllResult> {
    let closedContexts = 0;
    const stateWriteFailures: StateWriteFailure[] = [];
    const deadline = Date.now() + TEARDOWN_BUDGET_MS;
    for (const [dispatchId, session] of this.sessions) {
      if (Date.now() >= deadline) {
        // Out of budget: `browser.close()` below is what reaps the remaining
        // contexts, and it must still get its turn before the caller's
        // SIGTERM. `closedContexts` keeps counting only what really closed.
        break;
      }
      const statePath = webContextStatePath(this.projectRoot, this.sessionId, dispatchId);
      try {
        assertUnder(statePath, webProfilesDir(this.projectRoot, this.sessionId));
        mkdirSync(dirname(statePath), { recursive: true });
        await boundedTeardownStep(
          session.context.storageState({ path: statePath }),
          `storageState for dispatch ${dispatchId}`
        );
      } catch (error) {
        stateWriteFailures.push({ dispatchId, reason: getErrorMessage(error) });
      }
      try {
        await boundedTeardownStep(session.context.close(), `context close for dispatch ${dispatchId}`);
        closedContexts += 1;
      } catch {
        // Already closed, or wedged past its budget: teardown must still reach
        // the remaining dispatches and the final `browser.close()`.
      }
    }
    this.sessions.clear();
    return { closedContexts, stateWriteFailures };
  }

  private async pageFor(dispatchId: string): Promise<PwPage> {
    const session = this.sessions.get(dispatchId);
    if (session === undefined) {
      await this.contextFor(dispatchId);
    }
    const active = this.sessions.get(dispatchId);
    if (active === undefined) {
      throw new Error(`WEB_CONTEXT_MISSING: no browser context for dispatch ${dispatchId}`);
    }
    if (active.page === null) {
      active.page = await active.context.newPage();
    }
    return active.page;
  }
}

/** `YYYYMMDDTHHMMSSmmmZ` — no colons, so the file name is Windows-safe (§7.1). */
function shotTimestamp(now: Date = new Date()): string {
  return now.toISOString().replace(/[-:.]/g, '');
}

/**
 * The aria payload as nodes. A shape mismatch is an explicit error, matching
 * `snap`'s policy for a missing API: an empty-but-`ok` snapshot would be read
 * as "the page is empty" rather than "the response was not a node array".
 * An empty array stays valid — that is a genuinely empty page.
 */
function asAriaNodes(raw: unknown): readonly AriaNode[] {
  if (!Array.isArray(raw)) {
    throw new Error(
      `WEB_SNAP_SHAPE_UNEXPECTED: ariaSnapshotJSON returned ${typeof raw}, not a node array`
    );
  }
  const nodes = raw.filter(
    (node): node is AriaNode =>
      typeof node === 'object' && node !== null && typeof (node as { role?: unknown }).role === 'string'
  );
  if (nodes.length !== raw.length) {
    throw new Error(
      `WEB_SNAP_SHAPE_UNEXPECTED: ariaSnapshotJSON returned ${raw.length - nodes.length} node(s) without a string role`
    );
  }
  return nodes;
}

/** The only vitals keys `metrics` reports (orchestrator decision C4's contract). */
const VITALS_KEYS = ['lcp', 'cls', 'inp'] as const;

/**
 * The page's vitals, read as DATA we bounded ourselves. `addInitScript`
 * installs the object, but a page may replace it afterwards, so nothing is
 * copied through: only C4's three keys, and only finite numbers. A payload
 * without a single numeric metric is not an observation window at all.
 */
function readVitals(raw: unknown): Record<string, number | null> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const values: Record<string, number | null> = {};
  let observed = false;
  for (const key of VITALS_KEYS) {
    const value = source[key];
    const numeric = typeof value === 'number' && Number.isFinite(value);
    values[key] = numeric ? value : null;
    observed = observed || numeric;
  }
  return observed ? values : null;
}

/** The only schemes `open` will navigate to. */
const ALLOWED_URL_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:']);

/**
 * `page.goto` would follow `file:` (a local-disk read) and any loopback or
 * cloud-metadata host, so the scheme is allowlisted at the argument — before a
 * context exists. Host policy belongs to S3's disable gate, not here.
 */
function assertNavigableUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`WEB_URL_INVALID: ${raw} is not an absolute URL`);
  }
  if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
    throw new Error(`WEB_URL_SCHEME_REJECTED: ${parsed.protocol} is not http: or https:`);
  }
}

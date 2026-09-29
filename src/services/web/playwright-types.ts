/**
 * The structural slice of the Playwright API this feature actually calls
 * (slice S1, file 9).
 *
 * Split out of `playwright-loader.ts` to keep the loader under the
 * 300-raw-line file cap — types only, no resolution or admission behaviour
 * lives here. The loader re-exports every name below, so importers keep
 * using `playwright-loader.js` unchanged. Typed locally because the package
 * is not a dependency and therefore has no importable type declarations.
 */
export interface PwLocator {
  ariaSnapshotJSON?(options?: {
    boxes?: boolean;
    depth?: number;
    mode?: 'ai' | 'default';
    timeout?: number;
  }): Promise<unknown>;
  click(): Promise<void>;
  innerText(): Promise<string>;
  screenshot(options?: { path?: string; type?: 'png' | 'jpeg' }): Promise<Buffer>;
}

export interface PwPage {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  locator(selector: string): PwLocator;
  screenshot(options?: { path?: string; type?: 'png' | 'jpeg' }): Promise<Buffer>;
  evaluate<T>(expression: string): Promise<T>;
}

export interface PwContext {
  newPage(): Promise<PwPage>;
  addInitScript(script: string): Promise<void>;
  storageState(options?: { path?: string }): Promise<unknown>;
  close(): Promise<void>;
}

export interface PwBrowser {
  newContext(options?: Record<string, unknown>): Promise<PwContext>;
  version(): string;
  /**
   * `disconnected` is the only signal that the user CLOSED the headed window
   * (S4 repair), which is what completes a login: once the browser is gone a
   * non-persistent context cannot be read, so the wait has to end here.
   *
   * OPTIONAL: the doubles that exercise the other verbs have no disconnect to
   * report, and demanding the method made three of them type-broken. A browser
   * that cannot report the event is treated as never disconnecting (S4 repair,
   * code review F1).
   */
  on?(event: 'disconnected', listener: () => void): void;
  /**
   * Whether the browser is still connected. Real Playwright exposes it; the
   * login checks it ONCE before the wait starts, so a browser that is already
   * gone fails fast instead of running out the full ten-minute bound — the
   * `disconnected` event is not replayed for it (S4 repair, code review F3).
   */
  isConnected?(): boolean;
  close(): Promise<void>;
}

export interface PlaywrightModule {
  chromium: {
    launch(options?: Record<string, unknown>): Promise<PwBrowser>;
    executablePath(): string;
  };
}

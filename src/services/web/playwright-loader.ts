/**
 * Playwright resolution shim (slice S1, file 9; S3 hardened the scan).
 *
 * `playwright` is deliberately NOT a dependency (PRD non-goal): it is fetched
 * by `npx --package playwright@<pin>`. That has one sharp edge, verified on
 * disk: inside `npx --package … -- node …` npm exec puts only
 * `<tmp>/node_modules/.bin` on PATH, so `require('playwright')` does NOT
 * resolve. This module implements the shim that DOES resolve, and returns the
 * absolute module path so `install` / `status` can reuse it.
 *
 * **Resolution is a code-loading trust boundary** — whatever this returns is
 * `import()`ed by `loadPlaywright()`. S3's first cut scanned three places and
 * checked the pin in only one of them, which made a planted package on `PATH`
 * arbitrary code execution reachable from `peaks web status` alone. The rule
 * now is:
 *
 *   1. There are exactly TWO roots, both chosen by this module and neither
 *      taken from a repo-influenced env var: the peaks install's own
 *      `node_modules`, and the per-user npm exec cache. `PATH` is **not**
 *      consulted at all, and `npm_config_cache`/`NPM_CONFIG_CACHE` is **not**
 *      honoured — those were the injection routes (a repo-shipped `.npmrc`
 *      reaches the second one under `npm run`).
 *   2. Every tier runs the SAME admission test, `verifyPinnedPackage`: the
 *      candidate must `realpath` to a regular file that is really inside the
 *      `node_modules` root we asked to resolve from (no symlink escape, no
 *      `..` walk-out into a planted `~/node_modules`), its directory must be
 *      named `playwright`, and BOTH its own `package.json` and its
 *      `playwright-core` sibling must declare the exact pin. A tier that is
 *      more permissive than another is a hole; there is no such tier.
 */
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { npmExecCacheRoots } from '../../shared/npm-cache.js';
import { isInsidePath } from '../../shared/path-utils.js';

/**
 * Exact pin, no caret (tech-doc §3.2). AC2 is a BYTE-COUNT contract and the
 * aria engine moves with the version, so upgrading is a deliberate,
 * re-measured change — never a floating range.
 */
export const PLAYWRIGHT_VERSION_PIN = '1.63.0';

/**
 * The structural slice of the Playwright API this feature actually calls.
 * Typed locally because the package is not a dependency and therefore has no
 * importable type declarations.
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

/**
 * The last successful resolution.
 *
 * The scan is cheap but not free, and `probeBrowserInstalled` used to run it
 * twice per call (`playwrightVersion()` then `loadPlaywright()`) — up to 5.6 ms
 * of readdirs per probe on a read-only verb (R10). Only a SUCCESS is cached: a
 * failure must be re-attempted, because the whole point of `peaks web install`
 * is that the next resolution succeeds.
 */
let resolvedModulePath: string | null = null;

/**
 * Absolute path of the `playwright` main entry.
 *
 * 1. the peaks install's own `node_modules` — the case where someone really did
 *    `npm install playwright`;
 * 2. the per-user npm exec cache, where acquisition put it (see the module
 *    docstring) and where it stays afterwards, with no npx and no shell.
 */
export function resolvePlaywrightModule(): string {
  if (resolvedModulePath !== null) {
    return resolvedModulePath;
  }
  const fromOwnModules = nodeModulesRootOf(dirname(fileURLToPath(import.meta.url)));
  if (fromOwnModules !== null) {
    const resolved = tryResolveFrom(fromOwnModules);
    if (resolved !== null) {
      resolvedModulePath = resolved;
      return resolved;
    }
  }
  const cached = resolveFromNpxCache();
  if (cached !== null) {
    resolvedModulePath = cached;
    return cached;
  }
  throw new Error(
    `PLAYWRIGHT_NOT_RESOLVABLE: playwright@${PLAYWRIGHT_VERSION_PIN} is not resolvable from this process ` +
      `(neither the peaks module path nor the npm exec cache holds a verified copy)`
  );
}

/**
 * The pinned package inside npm's exec cache, or `null`.
 *
 * The cache is a MULTI-VERSION store — this machine holds `1.63.0` and a
 * `1.63.0-alpha-*` beside it — so a candidate only counts when its own
 * `package.json` (and its `playwright-core` sibling) names the pin. Resolving
 * the alpha would silently move AC2's byte contract, which is the one thing the
 * exact pin exists to prevent.
 */
function resolveFromNpxCache(): string | null {
  // The roots themselves live in `shared/npm-cache.ts` — the exec cache has
  // exactly one definition, shared with the OCR probe, so the two cannot
  // disagree about what "already installed" means.
  for (const cacheRoot of npmExecCacheRoots()) {
    for (const entry of safeReaddir(cacheRoot)) {
      const resolved = tryResolveFrom(join(cacheRoot, entry, 'node_modules'));
      if (resolved !== null) {
        return resolved;
      }
    }
  }
  return null;
}

/**
 * Resolve `playwright` as if from `moduleRoot`, and admit it only when it
 * passes `verifyPinnedPackage` against that same root. The anchor is what
 * stops Node's own upward walk from leaving the tree we chose.
 */
function tryResolveFrom(moduleRoot: string): string | null {
  const anchor = realpathOrNull(moduleRoot);
  if (anchor === null) {
    return null;
  }
  let resolved: string;
  try {
    resolved = createRequire(join(moduleRoot, 'index.js')).resolve('playwright');
  } catch {
    // Nothing called `playwright` under this root — the normal case for most
    // of them.
    return null;
  }
  return verifyPinnedPackage(resolved, anchor);
}

/**
 * The one admission test every tier runs, and the whole of this module's
 * defence. Returns the real path to import, or `null` to reject.
 *
 * - `realpath` first: a symlinked `node_modules/playwright` resolves to its
 *   target, so containment is decided on the file that would actually be
 *   executed, not on the link.
 * - containment against the anchor: Node happily walks UP out of an `_npx`
 *   entry into `~/.npm/node_modules` or `~/node_modules`, so a planted package
 *   one level above the cache entry would otherwise be accepted.
 * - regular file: a directory or a device is not a module.
 * - the pin, from TWO files: the `playwright` manifest is metadata the payload
 *   supplies about itself, so it is cross-checked against its independent
 *   `playwright-core` sibling — an attacker planting one package must now keep
 *   two manifests consistent with the pin.
 */
function verifyPinnedPackage(resolved: string, anchor: string): string | null {
  const real = realpathOrNull(resolved);
  if (real === null || !isInsidePath(real, anchor)) {
    return null;
  }
  try {
    if (!statSync(real).isFile()) {
      return null;
    }
  } catch {
    return null;
  }
  const packageDir = dirname(real);
  if (basename(packageDir) !== 'playwright') {
    return null;
  }
  if (packageJsonVersion(packageDir) !== PLAYWRIGHT_VERSION_PIN) {
    return null;
  }
  const coreDir = join(dirname(packageDir), 'playwright-core');
  return packageJsonVersion(coreDir) === PLAYWRIGHT_VERSION_PIN ? real : null;
}

/** The nearest ancestor of `from` named `node_modules`, or `null`. */
function nodeModulesRootOf(from: string): string | null {
  let dir = from;
  for (;;) {
    if (basename(dir) === 'node_modules') {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    // No cache at this location is the normal case on a fresh machine.
    return [];
  }
}

function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** The version named by the `package.json` at `packageDir`, or `null`. */
function packageJsonVersion(packageDir: string): string | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(packageDir, 'package.json'), 'utf8')
    ) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

/** Import the resolved Playwright module. Throws `PLAYWRIGHT_NOT_RESOLVABLE` if it is absent. */
export async function loadPlaywright(): Promise<PlaywrightModule> {
  const resolved = resolvePlaywrightModule();
  let loaded: { chromium?: unknown; default?: { chromium?: unknown } };
  try {
    loaded = (await import(pathToFileURL(resolved).href)) as typeof loaded;
  } catch (error) {
    // A verified path that will not load (the cache entry was evicted between
    // the check and the import) is a resolution failure, not a raw
    // `ERR_MODULE_NOT_FOUND`: the latter collapses to `WEB_OP_FAILED` and puts
    // an absolute cache path in the envelope (security review S8).
    throw new Error(
      `PLAYWRIGHT_NOT_RESOLVABLE: playwright@${PLAYWRIGHT_VERSION_PIN} could not be loaded: ` +
        `${error instanceof Error ? error.message : String(error)}`
    );
  }
  const playwright = (loaded.chromium !== undefined ? loaded : loaded.default) as
    | PlaywrightModule
    | undefined;
  if (playwright === undefined || playwright.chromium === undefined) {
    throw new Error(`PLAYWRIGHT_SHAPE_UNEXPECTED: ${resolved} does not export a chromium module`);
  }
  return playwright;
}

/** Installed Playwright package version, or `null` when it cannot be resolved. */
export async function playwrightVersion(): Promise<string | null> {
  try {
    return packageJsonVersion(dirname(resolvePlaywrightModule()));
  } catch {
    return null;
  }
}

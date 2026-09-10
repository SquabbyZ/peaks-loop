/**
 * Playwright resolution shim (slice S1, file 9).
 *
 * `playwright` is deliberately NOT a dependency (PRD non-goal): it is fetched
 * by `npx --package playwright@<pin>`. That has one sharp edge, verified on
 * disk: inside `npx --package … -- node …` npm exec puts only
 * `<tmp>/node_modules/.bin` on PATH, so `require('playwright')` does NOT
 * resolve. This module implements the PATH-scan shim that DOES resolve, and
 * returns the absolute module path so `install` / `status` can reuse it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
  close(): Promise<void>;
}

export interface PlaywrightModule {
  chromium: {
    launch(options?: Record<string, unknown>): Promise<PwBrowser>;
    executablePath(): string;
  };
}

/**
 * Absolute path of the `playwright` main entry.
 *
 * 1. normal resolution — works in dev / tests when playwright sits on the
 *    module path;
 * 2. the npx case: scan PATH for `<something>/node_modules/.bin`, anchor a
 *    `require` at that directory and resolve from there (Node then walks up
 *    into the sibling `node_modules`, which is where npx put the package).
 */
export function resolvePlaywrightModule(): string {
  try {
    return createRequire(import.meta.url).resolve('playwright');
  } catch {
    // Expected under `npx --package playwright@<pin>` — fall through to the scan.
  }
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    if (entry.length === 0 || !entry.endsWith(join('node_modules', '.bin'))) {
      continue;
    }
    try {
      return createRequire(join(entry, 'index.js')).resolve('playwright');
    } catch {
      // Not this PATH entry; keep scanning.
    }
  }
  throw new Error(
    `PLAYWRIGHT_NOT_RESOLVABLE: playwright@${PLAYWRIGHT_VERSION_PIN} is not resolvable from this process ` +
      `(module path and PATH were both scanned)`
  );
}

/** Import the resolved Playwright module. Throws `PLAYWRIGHT_NOT_RESOLVABLE` if it is absent. */
export async function loadPlaywright(): Promise<PlaywrightModule> {
  const resolved = resolvePlaywrightModule();
  const loaded = (await import(pathToFileURL(resolved).href)) as {
    chromium?: unknown;
    default?: { chromium?: unknown };
  };
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
    const resolved = resolvePlaywrightModule();
    const packagePath = join(dirname(resolve(resolved)), 'package.json');
    if (!existsSync(packagePath)) {
      return null;
    }
    const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

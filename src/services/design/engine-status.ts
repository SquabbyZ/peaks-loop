/**
 * Render-engine availability for `peaks design check`.
 *
 * `designlang` is a hard dependency, but the engine is only usable when its bin
 * entry resolves AND a browser exists. A missing binary or browser must produce
 * `blocked`, never a pass — so this module reports every failing reason as a
 * code instead of throwing. `detectBrowser` probes the filesystem only: it never
 * runs `designlang doctor` (which crashes on Node 24 teardown) and never
 * downloads a browser.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

export type EngineUnavailableCode =
  'DESIGN_ENGINE_UNAVAILABLE' | 'DESIGN_ENGINE_VERSION_UNSUPPORTED' | 'DESIGN_BROWSER_UNAVAILABLE';

/** Where designlang found a browser, if it found one at all. */
export type BrowserKind = 'bundled' | 'system-chrome' | null;

export type EngineAvailability = {
  available: boolean;
  version: string | null;
  entryPath: string | null;
  browserReady: boolean;
  browserKind: BrowserKind;
  codes: EngineUnavailableCode[];
};

export type EngineEvaluationInput = {
  entryPath: string | null;
  version: string | null;
  browserKind: BrowserKind;
  /**
   * Testing seam only: production never supplies this. The adapter constant
   * below is the authoritative gate; `engine.json`'s value is informational.
   */
  supportedMajor?: number;
};

/** Designlang major THIS adapter was written against; never taken from engine.json. */
export const ADAPTER_SUPPORTED_MAJOR = 13;

/** The `designlang` bin names to probe when Chrome is not at a known path. */
const PATH_CHROME_NAMES = ['google-chrome', 'chromium', 'chromium-browser'] as const;

function majorOf(version: string | null): number | null {
  if (version === null) return null;
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isNaN(major) ? null : major;
}

/** Pure: every failing condition becomes its own code, in plan order. */
export function evaluateEngine(input: EngineEvaluationInput): EngineAvailability {
  const supportedMajor = input.supportedMajor ?? ADAPTER_SUPPORTED_MAJOR;
  const codes: EngineUnavailableCode[] = [];
  if (input.entryPath === null) codes.push('DESIGN_ENGINE_UNAVAILABLE');
  if (majorOf(input.version) !== supportedMajor) {
    codes.push('DESIGN_ENGINE_VERSION_UNSUPPORTED');
  }
  if (input.browserKind === null) codes.push('DESIGN_BROWSER_UNAVAILABLE');
  return {
    available: codes.length === 0,
    version: input.version,
    entryPath: input.entryPath,
    browserReady: input.browserKind !== null,
    browserKind: input.browserKind,
    codes
  };
}

/** The platform's Playwright browser cache, in probe order. */
function playwrightCacheDirs(): string[] {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    return localAppData === undefined ? [] : [join(localAppData, 'ms-playwright')];
  }
  if (process.platform === 'darwin') {
    return [join(homedir(), 'Library', 'Caches', 'ms-playwright')];
  }
  return [join(homedir(), '.cache', 'ms-playwright')];
}

function hasBundledChromium(): boolean {
  return playwrightCacheDirs().some((dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true }).some(
        (entry) => entry.isDirectory() && entry.name.startsWith('chromium-')
      );
    } catch {
      return false;
    }
  });
}

/** Well-known Chrome install locations for the current platform. */
function knownChromePaths(): string[] {
  if (process.platform === 'win32') {
    return [
      join(
        process.env.PROGRAMFILES ?? 'C:\\Program Files',
        'Google',
        'Chrome',
        'Application',
        'chrome.exe'
      ),
      join(
        process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)',
        'Google',
        'Chrome',
        'Application',
        'chrome.exe'
      ),
      join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ].filter((path) => path !== '');
  }
  if (process.platform === 'darwin') {
    return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium'];
}

function findOnPath(names: readonly string[]): string | null {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter((dir) => dir !== '');
  const suffixes = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  for (const name of names) {
    for (const dir of dirs) {
      for (const suffix of suffixes) {
        const candidate = join(dir, `${name}${suffix}`);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

function hasSystemChrome(): boolean {
  if (knownChromePaths().some((path) => existsSync(path))) return true;
  return findOnPath(PATH_CHROME_NAMES) !== null;
}

/**
 * Bundled Chromium under the Playwright cache wins, then a system Chrome at a
 * known path or on PATH. Filesystem probes only — no `designlang doctor`.
 */
export function detectBrowser(): BrowserKind {
  if (hasBundledChromium()) return 'bundled';
  if (hasSystemChrome()) return 'system-chrome';
  return null;
}

/** `bin` may be a bare string or a `{ name: path }` map. */
function binPathOf(bin: unknown): string | null {
  if (typeof bin === 'string') return bin;
  if (bin === null || typeof bin !== 'object') return null;
  const entries = bin as Record<string, unknown>;
  const named = entries.designlang;
  if (typeof named === 'string') return named;
  for (const value of Object.values(entries)) {
    if (typeof value === 'string') return value;
  }
  return null;
}

function resolveEngineEntry(): { entryPath: string | null; version: string | null } {
  try {
    const require = createRequire(import.meta.url);
    const packageJsonPath = require.resolve('designlang/package.json');
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      version?: unknown;
      bin?: unknown;
    };
    const version = typeof pkg.version === 'string' ? pkg.version : null;
    const bin = binPathOf(pkg.bin);
    if (bin === null) return { entryPath: null, version };
    const entryPath = resolve(dirname(packageJsonPath), bin);
    return { entryPath: existsSync(entryPath) ? entryPath : null, version };
  } catch {
    return { entryPath: null, version: null };
  }
}

/** Resolve the installed designlang and a browser; never throws. */
export function resolveEngine(options: { supportedMajor?: number } = {}): EngineAvailability {
  const { entryPath, version } = resolveEngineEntry();
  return evaluateEngine({
    entryPath,
    version,
    browserKind: detectBrowser(),
    ...(options.supportedMajor === undefined ? {} : { supportedMajor: options.supportedMajor })
  });
}

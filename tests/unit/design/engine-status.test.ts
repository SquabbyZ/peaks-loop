import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type * as EngineStatusModuleTypes from '../../../src/services/design/engine-status.js';

declareDimensions('tests/unit/design/engine-status.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

/**
 * The SUT is imported per test after `vi.resetModules()` so its module-level
 * constants (the adapter major, the PATH names) initialise INSIDE a test body.
 * Under Stryker's per-test coverage a module-scope initialiser runs before any
 * test, so a mutant in it would read as unexecuted.
 */
type EngineStatusModule = typeof EngineStatusModuleTypes;

async function loadEngineStatus(): Promise<EngineStatusModule> {
  vi.resetModules();
  return import('../../../src/services/design/engine-status.js');
}

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  createRequire: vi.fn(),
  requireResolve: vi.fn(),
  homedir: vi.fn()
}));

vi.mock('node:fs', () => ({
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
  readdirSync: mocks.readdirSync
}));
vi.mock('node:module', () => ({ createRequire: mocks.createRequire }));
vi.mock('node:os', () => ({ homedir: mocks.homedir }));

const REAL_PLATFORM = process.platform;
const ENV_KEYS = ['LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PATH'] as const;
const savedEnv = new Map<string, string | undefined>();

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function chromePath(...parts: string[]): string {
  return join('C:\\Program Files', ...parts);
}

beforeEach(() => {
  if (savedEnv.size === 0) {
    for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  }
  mocks.existsSync.mockReturnValue(false);
  mocks.readdirSync.mockReturnValue([]);
  mocks.readFileSync.mockImplementation(() => {
    throw new Error('unexpected readFileSync');
  });
  mocks.createRequire.mockReturnValue({ resolve: mocks.requireResolve });
  mocks.requireResolve.mockImplementation(() => {
    throw new Error('designlang is not installed');
  });
  mocks.homedir.mockReturnValue('/home/tester');
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: REAL_PLATFORM, configurable: true });
  for (const key of ENV_KEYS) setEnv(key, savedEnv.get(key));
  vi.clearAllMocks();
});

describe('Scenario: behavior — the engine availability gate', () => {
  it('when the package and entry resolve and a browser exists, should publish the full record', async () => {
    // given: a resolved entry, the adapter major, and a system chrome
    // when: the gate evaluates
    // then: it is available with every record field populated
    const { evaluateEngine } = await loadEngineStatus();
    const result = evaluateEngine({
      entryPath: '/x/design-extract.js',
      version: '13.4.1',
      browserKind: 'system-chrome'
    });
    expect(result).toEqual({
      available: true,
      version: '13.4.1',
      entryPath: '/x/design-extract.js',
      browserReady: true,
      browserKind: 'system-chrome',
      codes: []
    });
  });

  it('when no major is supplied, should gate on the adapter constant rather than engine.json', async () => {
    // given: the adapter major and a designlang from the NEXT major
    // when: the gate evaluates without an explicit override
    // then: a 13.x is accepted and a 14.x is blocked by the adapter constant
    const { evaluateEngine, ADAPTER_SUPPORTED_MAJOR } = await loadEngineStatus();
    expect(ADAPTER_SUPPORTED_MAJOR).toBe(13);
    const current = evaluateEngine({
      entryPath: '/x/design-extract.js',
      version: '13.9.2',
      browserKind: 'bundled'
    });
    expect(current.available).toBe(true);
    expect(current.codes).toEqual([]);
    const future = evaluateEngine({
      entryPath: '/x/design-extract.js',
      version: '14.0.0',
      browserKind: 'bundled'
    });
    expect(future.available).toBe(false);
    expect(future.codes).toContain('DESIGN_ENGINE_VERSION_UNSUPPORTED');
  });

  it('when every condition fails, should report one code per cause in plan order', async () => {
    // given: no entry, a future major, and no browser
    // when: the gate evaluates
    // then: each failure is its own code in the documented order
    const { evaluateEngine } = await loadEngineStatus();
    const result = evaluateEngine({ entryPath: null, version: '14.0.0', browserKind: null });
    expect(result).toEqual({
      available: false,
      version: '14.0.0',
      entryPath: null,
      browserReady: false,
      browserKind: null,
      codes: [
        'DESIGN_ENGINE_UNAVAILABLE',
        'DESIGN_ENGINE_VERSION_UNSUPPORTED',
        'DESIGN_BROWSER_UNAVAILABLE'
      ]
    });
  });

  it('when the version is unparseable, should refuse it without throwing', async () => {
    // given: a version string with no numeric major
    // when: the gate evaluates
    // then: the version gate refuses it and nothing else fails
    const { evaluateEngine } = await loadEngineStatus();
    const result = evaluateEngine({
      entryPath: '/x/design-extract.js',
      version: 'canary',
      browserKind: 'bundled'
    });
    expect(result.available).toBe(false);
    expect(result.codes).toEqual(['DESIGN_ENGINE_VERSION_UNSUPPORTED']);
    expect(result.browserReady).toBe(true);
  });

  it('when a caller pins another major, should judge against the pin', async () => {
    // given: a 13.x install and a caller-pinned major no install carries
    // when: the gate evaluates
    // then: the pin is the gate, which documents the testing seam
    const { evaluateEngine } = await loadEngineStatus();
    const result = evaluateEngine({
      entryPath: '/x/design-extract.js',
      version: '13.4.1',
      browserKind: 'bundled',
      supportedMajor: 99
    });
    expect(result.codes).toEqual(['DESIGN_ENGINE_VERSION_UNSUPPORTED']);
  });
});

describe('Scenario: integration — the filesystem browser probes', () => {
  it('when the Playwright cache holds a chromium directory, should prefer the bundled browser', async () => {
    // given: a win32 host with LOCALAPPDATA and one chromium- dir in the cache
    // when: the browser is detected
    // then: the bundled browser wins and the cache path is the platform one
    setPlatform('win32');
    setEnv('LOCALAPPDATA', 'C:\\Users\\me\\AppData\\Local');
    mocks.readdirSync.mockReturnValue([{ name: 'chromium-1148', isDirectory: () => true }]);
    const { detectBrowser } = await loadEngineStatus();
    expect(detectBrowser()).toBe('bundled');
    expect(mocks.readdirSync).toHaveBeenCalledWith(
      join('C:\\Users\\me\\AppData\\Local', 'ms-playwright'),
      { withFileTypes: true }
    );
  });

  it('when the chromium name is a file or another dir, should not call it bundled', async () => {
    // given: a chromium-named FILE and a directory with another name
    // when: each cache listing is probed
    // then: neither is a bundled browser
    setPlatform('win32');
    setEnv('LOCALAPPDATA', 'C:\\Users\\me\\AppData\\Local');
    const { detectBrowser } = await loadEngineStatus();
    for (const entries of [
      [{ name: 'chromium-1148', isDirectory: () => false }],
      [{ name: 'firefox-1234', isDirectory: () => true }]
    ]) {
      mocks.readdirSync.mockReturnValue(entries);
      expect(detectBrowser()).toBeNull();
    }
  });

  it('when the cache directory is unreadable, should fall through to a system browser', async () => {
    // given: readdirSync throwing on the Playwright cache
    // when: the browser is detected
    // then: the failure is caught and no bundled browser is reported
    setPlatform('linux');
    mocks.readdirSync.mockImplementation(() => {
      throw new Error('EACCES');
    });
    const { detectBrowser } = await loadEngineStatus();
    expect(detectBrowser()).toBeNull();
  });

  it('when win32 has no LOCALAPPDATA, should probe only the two Program Files fallbacks', async () => {
    // given: win32 with LOCALAPPDATA, PROGRAMFILES and the x86 var all unset
    // when: the known Chrome paths are probed
    // then: the two Program Files fallbacks and the documented relative candidate are used
    setPlatform('win32');
    for (const key of ['LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PATH'] as const) {
      setEnv(key, undefined);
    }
    const { detectBrowser } = await loadEngineStatus();
    expect(detectBrowser()).toBeNull();
    expect(mocks.existsSync.mock.calls.map(([path]) => path)).toEqual([
      chromePath('Google', 'Chrome', 'Application', 'chrome.exe'),
      join('C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join('', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ]);
  });

  it('when win32 sets the env vars, should use each value in its candidate', async () => {
    // given: win32 with every Chrome location redirected
    // when: the known paths are probed
    // then: each candidate is built from the variable, in order
    setPlatform('win32');
    setEnv('PROGRAMFILES', 'D:\\PF');
    setEnv('PROGRAMFILES(X86)', 'D:\\PF86');
    setEnv('LOCALAPPDATA', 'D:\\LAD');
    setEnv('PATH', '');
    const { detectBrowser } = await loadEngineStatus();
    expect(detectBrowser()).toBeNull();
    expect(mocks.existsSync.mock.calls.map(([path]) => path)).toEqual([
      join('D:\\PF', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join('D:\\PF86', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join('D:\\LAD', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ]);
  });

  it('when win32 finds a chrome.exe on PATH, should report system chrome', async () => {
    // given: no known-path Chrome and a PATH entry holding google-chrome.exe
    // when: the browser is detected
    // then: the .exe suffix probe finds it
    setPlatform('win32');
    setEnv('PATH', 'C:\\tools');
    for (const key of ['LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)'] as const) {
      setEnv(key, undefined);
    }
    mocks.existsSync.mockImplementation(
      (path: string) => path === join('C:\\tools', 'google-chrome.bat')
    );
    const { detectBrowser } = await loadEngineStatus();
    expect(detectBrowser()).toBe('system-chrome');
    const probed = mocks.existsSync.mock.calls.map(([path]) => path);
    expect(probed).toContain(join('C:\\tools', 'google-chrome'));
    expect(probed).toContain(join('C:\\tools', 'google-chrome.exe'));
    expect(probed).toContain(join('C:\\tools', 'google-chrome.cmd'));
    expect(probed).toContain(join('C:\\tools', 'google-chrome.bat'));
    expect(probed).not.toContain(join('C:\\tools', 'chromium'));
  });

  it('when darwin probes, should use the Library cache and the app-bundle Chrome', async () => {
    // given: a darwin host with a home directory
    // when: the browser is detected
    // then: the mac cache dir and the app bundle are the only candidates
    setPlatform('darwin');
    mocks.homedir.mockReturnValue('/Users/me');
    setEnv('PATH', '');
    const { detectBrowser } = await loadEngineStatus();
    expect(detectBrowser()).toBeNull();
    expect(mocks.readdirSync).toHaveBeenCalledWith(
      join('/Users/me', 'Library', 'Caches', 'ms-playwright'),
      { withFileTypes: true }
    );
    expect(mocks.existsSync.mock.calls.map(([path]) => path)).toEqual([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ]);
  });

  it('when linux probes, should use the ~/.cache dir and the three binary paths', async () => {
    // given: a linux host with a home directory
    // when: the browser is detected
    // then: the linux cache dir and all three documented binaries are probed
    setPlatform('linux');
    mocks.homedir.mockReturnValue('/home/tester');
    setEnv('PATH', '');
    const { detectBrowser } = await loadEngineStatus();
    expect(detectBrowser()).toBeNull();
    expect(mocks.readdirSync).toHaveBeenCalledWith(
      join('/home/tester', '.cache', 'ms-playwright'),
      {
        withFileTypes: true
      }
    );
    expect(mocks.existsSync.mock.calls.map(([path]) => path)).toEqual([
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/snap/bin/chromium'
    ]);
  });

  it('when PATH has empty segments, should skip them instead of probing an empty dir', async () => {
    // given: a linux PATH of separator-only entries
    // when: the browser is detected
    // then: no candidate is built from an empty directory
    setPlatform('linux');
    setEnv('PATH', '::');
    const { detectBrowser } = await loadEngineStatus();
    expect(detectBrowser()).toBeNull();
    expect(mocks.existsSync.mock.calls.map(([path]) => path)).toEqual([
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/snap/bin/chromium'
    ]);
  });
});

describe('Scenario: render — resolving the installed designlang package', () => {
  const PKG_PATH = '/repo/node_modules/designlang/package.json';

  function packageResolvesTo(body: unknown): void {
    mocks.requireResolve.mockReturnValue(PKG_PATH);
    mocks.readFileSync.mockReturnValue(JSON.stringify(body));
  }

  it('when bin is a string and the entry exists, should resolve the full availability', async () => {
    // given: a 13.x package whose bin is a bare string
    // when: the engine is resolved
    // then: the entry path is resolved beside package.json and the gate passes
    setPlatform('linux');
    setEnv('PATH', '');
    packageResolvesTo({ version: '13.4.1', bin: './bin/design-extract.js' });
    const entry = resolve(dirname(PKG_PATH), './bin/design-extract.js');
    const chrome = '/usr/bin/google-chrome';
    mocks.existsSync.mockImplementation((path: string) => path === entry || path === chrome);
    const { resolveEngine } = await loadEngineStatus();
    const result = resolveEngine();
    expect(result).toEqual({
      available: true,
      version: '13.4.1',
      entryPath: entry,
      browserReady: true,
      browserKind: 'system-chrome',
      codes: []
    });
  });

  it('when bin is a map, should prefer the designlang key then any string value', async () => {
    // given: bin maps with and without the designlang key
    // when: each is resolved
    // then: the named entry wins and the first string is the fallback
    setPlatform('linux');
    setEnv('PATH', '');
    mocks.existsSync.mockReturnValue(true);
    const { resolveEngine } = await loadEngineStatus();
    const preferred = resolve(dirname(PKG_PATH), './named.js');
    packageResolvesTo({
      version: '13.4.1',
      bin: { other: './other.js', designlang: './named.js' }
    });
    expect(resolveEngine().entryPath).toBe(preferred);
    const fallback = resolve(dirname(PKG_PATH), './other.js');
    packageResolvesTo({ version: '13.4.1', bin: { other: './other.js', note: 7 } });
    expect(resolveEngine().entryPath).toBe(fallback);
  });

  it('when no bin value is usable, should report a null entry but keep the version', async () => {
    // given: bin values that are null, numbers, and maps with no string
    // when: each is resolved
    // then: the entry is null and the version still names the install
    setPlatform('linux');
    setEnv('PATH', '');
    const { resolveEngine } = await loadEngineStatus();
    for (const bin of [null, 7, { note: 7 }]) {
      packageResolvesTo({ version: '13.4.1', bin });
      const result = resolveEngine();
      expect(result.entryPath, String(bin)).toBeNull();
      expect(result.version).toBe('13.4.1');
      expect(result.codes).toContain('DESIGN_ENGINE_UNAVAILABLE');
    }
  });

  it('when the entry path does not exist, should null the entry and keep the version', async () => {
    // given: a package whose bin points at a missing file
    // when: the engine is resolved
    // then: the entry is null while the version survives
    setPlatform('linux');
    setEnv('PATH', '');
    packageResolvesTo({ version: '13.4.1', bin: './bin/missing.js' });
    const { resolveEngine } = await loadEngineStatus();
    expect(resolveEngine().entryPath).toBeNull();
    expect(resolveEngine().version).toBe('13.4.1');
  });

  it('when the package version is not a string, should report a null version', async () => {
    // given: package.json whose version is a number
    // when: the engine is resolved
    // then: the version is null and the version gate refuses it
    setPlatform('linux');
    setEnv('PATH', '');
    mocks.existsSync.mockReturnValue(true);
    packageResolvesTo({ version: 13, bin: './bin/design-extract.js' });
    const { resolveEngine } = await loadEngineStatus();
    const result = resolveEngine();
    expect(result.version).toBeNull();
    expect(result.codes).toContain('DESIGN_ENGINE_VERSION_UNSUPPORTED');
  });

  it('when the package cannot be resolved or read, should degrade to nulls', async () => {
    // given: require.resolve throwing, an unreadable file, and invalid JSON
    // when: each resolution is attempted
    // then: every failure is a value with no entry and no version
    setPlatform('linux');
    setEnv('PATH', '');
    const { resolveEngine } = await loadEngineStatus();
    mocks.requireResolve.mockImplementation(() => {
      throw new Error('MODULE_NOT_FOUND');
    });
    expect(resolveEngine()).toEqual({
      available: false,
      version: null,
      entryPath: null,
      browserReady: false,
      browserKind: null,
      codes: [
        'DESIGN_ENGINE_UNAVAILABLE',
        'DESIGN_ENGINE_VERSION_UNSUPPORTED',
        'DESIGN_BROWSER_UNAVAILABLE'
      ]
    });
    mocks.requireResolve.mockReturnValue(PKG_PATH);
    mocks.readFileSync.mockImplementation(() => {
      throw new Error('EACCES');
    });
    expect(resolveEngine().version).toBeNull();
    mocks.readFileSync.mockReturnValue('{ oops');
    expect(resolveEngine().entryPath).toBeNull();
  });

  it('when a caller pins the recorded major, should expose the testing seam', async () => {
    // given: the installed 13.x package and a pinned 99
    // when: the engine is resolved with the pin
    // then: the pin is honoured, proving production must not pass engine.json through
    setPlatform('linux');
    setEnv('PATH', '');
    mocks.existsSync.mockReturnValue(true);
    packageResolvesTo({ version: '13.4.1', bin: './bin/design-extract.js' });
    const { resolveEngine } = await loadEngineStatus();
    expect(resolveEngine({ supportedMajor: 99 }).codes).toContain(
      'DESIGN_ENGINE_VERSION_UNSUPPORTED'
    );
    expect(resolveEngine({ supportedMajor: 13 }).available).toBe(true);
  });
});

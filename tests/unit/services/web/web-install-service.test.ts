// tests/unit/services/web/web-install-service.test.ts
//
// AC5 + R2 + R6 at the unit level: the gate's truth table, the EXACT argv of
// the one-time download, a probe that answers about the browser `launch()`
// actually starts, an install lock that is exclusive and reclaims the stale,
// and an installer that never throws and always releases its lock.
//
// The argv assertions matter more than they look: the download is ~700 MB, so
// "verify it by running it" is exactly what this file exists to avoid (tech-doc
// §3.3 / R2). `spawnSync` is therefore replaced at the module boundary — what is
// under test is the command and the lock discipline, not npm's behaviour.
//
// Every probe test plants its own npm exec cache and points the per-user roots
// at the tmp workspace, so the answer does not depend on what this machine has
// installed. That is what replaced the old tautology
// (`expect(typeof probe.installed).toBe('boolean')`), which passed on every
// machine including one where the feature was broken (R13).
//
// Dimensions covered:
//   - behavior:    the gate, the argv, the lock states, the outcome shape
//   - integration: real lock files and a real npm cache tree on disk
//   - a11y:        the size warning a human reads before the block
//   - render:      not applicable (the CLI layer prints the envelope)

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/services/web/web-install-service.test.ts',
  ['behavior', 'integration', 'a11y'],
  [{ dim: 'render', reason: 'the envelope that carries this outcome is printed by the CLI layer' }],
);

import { webInstallLockPath } from '../../../../src/services/web/web-artifact-paths.js';
import {
  acquireInstallLock,
  INSTALL_SIZE_WARNING,
  installChromium,
  installCommandLine,
  isWebDisabled,
  releaseInstallLock,
  type BrowserProbe
} from '../../../../src/services/web/web-install-service.js';
import { PLAYWRIGHT_VERSION_PIN } from '../../../../src/services/web/playwright-loader.js';

/** `node:child_process`, replaced so no test can ever start a real download. */
const spawnRecorder = vi.hoisted(() => ({
  calls: [] as Array<{ command: string; args: readonly string[]; options: Record<string, unknown> }>,
  result: { status: 0 } as { status: number | null; error?: Error },
  /** `throwOnSpawn` keeps the exception path covered; real `spawnSync` returns `{error}`. */
  throwOnSpawn: false
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawnSync: (command: string, args: readonly string[], options: Record<string, unknown>) => {
      spawnRecorder.calls.push({ command, args, options });
      if (spawnRecorder.throwOnSpawn) {
        throw new Error('spawn npx ENOENT');
      }
      return spawnRecorder.result;
    }
  };
});

const SESSION_ID = '2026-09-10-session-528a63';
const ws = withTmpWorkspacePerTest('peaks-web-install-');

/**
 * The per-user roots the module derives its lock path and its npm cache scan
 * from. Pointing them at the tmp workspace is what makes these tests hermetic:
 * `~/.peaks/web/install.lock` and the real `_npx` cache never take part.
 */
const HOME_KEYS = ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA'] as const;
const savedHome = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of HOME_KEYS) {
    savedHome.set(key, process.env[key]);
    process.env[key] = ws().path;
  }
  // The loader scans `<home>/.npm/_npx` and, on win32, `<LOCALAPPDATA>/npm-cache/_npx`;
  // both now resolve under the tmp workspace.
  mkdirSync(join(ws().path, 'npm-cache', '_npx'), { recursive: true });
  // The loader memoizes a successful resolution (R10) and each test plants its
  // own cache, so a probe test must not inherit the previous one's answer.
  vi.resetModules();
});

/** The probe through a fresh module instance — see the `resetModules` note above. */
async function freshProbe(): Promise<BrowserProbe> {
  const mod = await import('../../../../src/services/web/web-install-service.js');
  return mod.probeBrowserInstalled();
}

afterEach(() => {
  for (const key of HOME_KEYS) {
    const previous = savedHome.get(key);
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
  savedHome.clear();
  spawnRecorder.calls = [];
  spawnRecorder.result = { status: 0 };
  spawnRecorder.throwOnSpawn = false;
  process.exitCode = undefined;
});

/** Plant a lock body as if another process had written it. */
function plantLock(body: unknown): void {
  mkdirSync(dirname(lockPath()), { recursive: true });
  writeFileSync(lockPath(), JSON.stringify(body), 'utf8');
}

const lockPath = (): string => webInstallLockPath();

/**
 * Plant a complete npm exec cache entry holding a `playwright` package that
 * declares `version`, whose `chromium.executablePath()` answers `chromiumPath`.
 * `playwright-core` beside it declares `coreVersion`, so the cross-check the
 * loader performs can be exercised in both directions.
 */
function plantCachedPlaywright(options: {
  version?: string;
  coreVersion?: string;
  chromiumPath: string;
}): string {
  const modules = join(ws().path, 'npm-cache', '_npx', 'deadbeef', 'node_modules');
  mkdirSync(join(modules, 'playwright'), { recursive: true });
  mkdirSync(join(modules, 'playwright-core'), { recursive: true });
  writeFileSync(
    join(modules, 'playwright', 'package.json'),
    JSON.stringify({ name: 'playwright', version: options.version ?? PLAYWRIGHT_VERSION_PIN })
  );
  writeFileSync(
    join(modules, 'playwright', 'index.js'),
    `module.exports = { chromium: { executablePath: () => ${JSON.stringify(options.chromiumPath)} } };\n`
  );
  writeFileSync(
    join(modules, 'playwright-core', 'package.json'),
    JSON.stringify({ name: 'playwright-core', version: options.coreVersion ?? PLAYWRIGHT_VERSION_PIN })
  );
  return join(modules, 'playwright', 'index.js');
}

/** The registry root the planted package points at, laid out like Playwright's. */
function plantBrowserCache(): { chromiumPath: string; shellPath: string } {
  const root = join(ws().path, 'ms-playwright');
  const chromiumPath = join(root, 'chromium-1243', 'chrome-win64', 'chrome.exe');
  const shellPath = join(
    root,
    'chromium_headless_shell-1243',
    'chrome-headless-shell-win64',
    'chrome-headless-shell.exe'
  );
  mkdirSync(dirname(chromiumPath), { recursive: true });
  writeFileSync(chromiumPath, 'stub');
  mkdirSync(dirname(shellPath), { recursive: true });
  writeFileSync(shellPath, 'stub');
  return { chromiumPath, shellPath };
}

describe('behavior — isWebDisabled', () => {
  it("when the flag is exactly '1', should be disabled", () => {
    // given: the documented opt-out
    // when:  the gate reads it
    // then:  it is on
    expect(isWebDisabled({ PEAKS_WEB_DISABLED: '1' })).toBe(true);
  });

  it('when the flag is anything else, should not be disabled', () => {
    // given: the near-misses a caller could plausibly set
    // when:  the gate reads each one
    // then:  none of them switches the browser path off
    for (const value of ['0', 'true', '', '1 ', '01', 'yes', 'TRUE']) {
      expect(isWebDisabled({ PEAKS_WEB_DISABLED: value })).toBe(false);
    }
    expect(isWebDisabled({})).toBe(false);
  });
});

describe('behavior — the install argv', () => {
  it('when install runs, should be exactly the documented npx command line', () => {
    // given: the pin from tech-doc §3.2
    // when:  the command line is built
    // then:  it is `npx --yes --package playwright@<pin> -- playwright install chromium`
    expect(installCommandLine()).toEqual([
      '--yes',
      '--package',
      `playwright@${PLAYWRIGHT_VERSION_PIN}`,
      '--',
      'playwright',
      'install',
      'chromium'
    ]);
  });

  it('when --force is asked for, should put it before the browser name', () => {
    // given: R6's recovery path
    // when:  the command line is built with force
    // then:  `--force` precedes `chromium`, and nothing else moves
    expect(installCommandLine({ force: true })).toEqual([
      '--yes',
      '--package',
      `playwright@${PLAYWRIGHT_VERSION_PIN}`,
      '--',
      'playwright',
      'install',
      '--force',
      'chromium'
    ]);
  });
});

describe('integration — the cache probe', () => {
  it('when the headless shell is present, should report the shell launch() starts', async () => {
    // given: a pinned package in the cache, with the browser launch() resolves
    const cache = plantBrowserCache();
    plantCachedPlaywright({ chromiumPath: cache.chromiumPath });
    // when:  the probe runs
    const probe = await freshProbe();
    // then:  it names the HEADLESS SHELL, not the full chromium whose path
    //        `executablePath()` hands out (R6), and it still never spawns
    expect(probe.version).toBe(PLAYWRIGHT_VERSION_PIN);
    expect(probe.executablePath).toBe(cache.shellPath);
    expect(probe.installed).toBe(true);
    expect(spawnRecorder.calls).toEqual([]);
  });

  it('when only the full chromium is present, should report the browser as missing', async () => {
    // given: exactly the state an interrupted install leaves — chromium landed,
    //        the shell did not
    const cache = plantBrowserCache();
    rmSync(dirname(cache.shellPath), { recursive: true, force: true });
    plantCachedPlaywright({ chromiumPath: cache.chromiumPath });
    // when:  the probe runs
    const probe = await freshProbe();
    // then:  it says NOT installed, which is what `peaks web install` acts on —
    //        the old probe answered `true` here (the full chromium was there),
    //        every browser op failed, and every new session repeated the download
    expect(probe.installed).toBe(false);
    expect(probe.executablePath).toBeNull();
  });
});

describe('integration — the install lock', () => {
  it('when the lock is free, should take it and leave an owned body on disk', () => {
    // given: an unused lock location
    // when:  the lock is acquired
    // then:  it is held, and the body names this process
    expect(acquireInstallLock()).toBe(true);
    expect(JSON.parse(readFileSync(lockPath(), 'utf8'))).toMatchObject({ pid: process.pid });
  });

  it('when a live process holds the lock, should refuse it', () => {
    // given: a lock held by a pid that is alive (this one) and fresh
    plantLock({ pid: process.pid, startedAt: new Date().toISOString() });
    // when:  a second acquisition is attempted
    // then:  it is refused, so 700 MB is not downloaded twice
    expect(acquireInstallLock()).toBe(false);
  });

  it('when the lock body is unreadable or its owner is dead, should reclaim it', () => {
    // given: a stale lock (a pid that cannot exist), then a malformed one
    plantLock({ pid: 2_147_483_646, startedAt: new Date().toISOString() });
    // when:  the lock is acquired
    // then:  the dead owner's lock is reclaimed
    expect(acquireInstallLock()).toBe(true);
    releaseInstallLock();
    plantLock('not json');
    expect(acquireInstallLock()).toBe(true);
  });

  it('when the lock belongs to another process, should leave it alone on release', () => {
    // given: a lock another live process owns
    plantLock({ pid: process.pid + 1, startedAt: new Date().toISOString() });
    // when:  this process releases "its" lock
    // then:  the other process's lock survives
    releaseInstallLock();
    expect(existsSync(lockPath())).toBe(true);
  });

  it('when the lock body cannot be read, should not delete it on release', () => {
    // given: a half-written body — what a racer's `wx` create looks like mid-flight
    plantLock('{"pid":');
    // when:  this process releases a lock it cannot prove is its own
    // then:  the file survives, because unlinking it would hand the lock away
    releaseInstallLock();
    expect(existsSync(lockPath())).toBe(true);
  });

  it('when the lock was never taken, should release without throwing', () => {
    // given: no lock file
    // when:  release runs anyway
    // then:  it is a no-op
    expect(() => {
      releaseInstallLock();
    }).not.toThrow();
  });
});

describe('behavior — installChromium', () => {
  it('when the installer succeeds, should report the download, warn about its size, and release the lock', async () => {
    // given: a spawn that exits 0
    // when:  the install runs
    // then:  the outcome is ok, the size warning is present and the lock is gone
    const written: string[] = [];
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        written.push(String(chunk));
        return true;
      });
    try {
      const outcome = await installChromium();
      expect(outcome.ok).toBe(true);
      expect(outcome.code).toBe('');
      expect(outcome.warnings).toEqual([INSTALL_SIZE_WARNING]);
      expect(existsSync(lockPath())).toBe(false);
    } finally {
      stderr.mockRestore();
    }
    // The size is named BEFORE the block: this is the only chance to say it.
    expect(written.join('')).toContain(INSTALL_SIZE_WARNING);
    expect(spawnRecorder.calls.length).toBe(1);
    const call = spawnRecorder.calls[0];
    // On Windows the resolver runs npm's own `npx-cli.js` through `node` (no
    // shell), so the argv is the command line above with the script in front.
    expect(call?.args.slice(-installCommandLine().length)).toEqual(installCommandLine());
    expect((call?.args.length ?? 0) >= installCommandLine().length).toBe(true);
    expect(call?.options['windowsHide']).toBe(true);
  });

  it('when the spawn throws, should return an outcome and still release the lock', async () => {
    // given: a spawn that throws (the exception path R6 calls out)
    spawnRecorder.throwOnSpawn = true;
    // when:  the install runs
    // then:  it never throws, reports WEB_INSTALL_FAILED, and frees the lock
    const outcome = await installChromium();
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('WEB_INSTALL_FAILED');
    expect(outcome.message).toContain('ENOENT');
    expect(existsSync(lockPath())).toBe(false);
  });

  it('when spawnSync reports a timeout, should report WEB_INSTALL_TIMEOUT rather than a status', async () => {
    // given: what `spawnSync` really does on its `timeout` — it RETURNS
    //        `{status: null, error: <ETIMEDOUT>}`, it does not throw (R14)
    spawnRecorder.result = {
      status: null,
      error: Object.assign(new Error('spawnSync node ETIMEDOUT'), { code: 'ETIMEDOUT' })
    };
    // when:  the install runs
    // then:  the timeout branch is taken, and the reason survives in the code
    const outcome = await installChromium();
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('WEB_INSTALL_TIMEOUT');
    expect(outcome.message).toContain('ETIMEDOUT');
    expect(existsSync(lockPath())).toBe(false);
  });

  it('when the installer exits non-zero, should report the status and the force recovery', async () => {
    // given: a spawn that fails the way a broken download does
    spawnRecorder.result = { status: 1 };
    // when:  the install runs
    // then:  the outcome names the code and points at `--force`
    const outcome = await installChromium();
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('WEB_INSTALL_FAILED');
    expect(outcome.message).toContain('status 1');
    expect(outcome.message).toContain('--force');
  });

  it('when another install holds the lock, should refuse without spawning', async () => {
    // given: a lock held by a live process
    plantLock({ pid: process.pid, startedAt: new Date().toISOString() });
    // when:  the install runs
    // then:  it reports busy and does not download
    const outcome = await installChromium();
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('WEB_INSTALL_BUSY');
    expect(spawnRecorder.calls).toEqual([]);
  });
});

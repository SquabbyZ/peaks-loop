// tests/unit/services/web/playwright-loader.test.ts
//
// The loader is a CODE-LOADING TRUST BOUNDARY: whatever `resolvePlaywrightModule()`
// returns is `import()`ed, and `peaks web status` reaches it unconditionally.
// The three-lens review reproduced arbitrary code execution through it twice —
// a planted `playwright@9.9.9-alpha` on PATH, and a forged `npm_config_cache`
// tree declaring the pin — so this file exists to hold the fix down with the
// reproductions themselves, not with a description of them.
//
// Each test plants its own trees under the tmp workspace and points the per-user
// roots (HOME / USERPROFILE / LOCALAPPDATA / APPDATA) and PATH at them, so what
// is asserted is the loader's admission rule and nothing about this machine.
// `vi.resetModules()` + a fresh `import()` gives each test an un-memoized loader.
//
// Dimensions covered:
//   - behavior:    what the admission rule accepts and refuses, and why
//   - integration: real `node_modules` trees, real symlinks, real `require.resolve`
//   - a11y:        not applicable (no user-facing surface)
//   - render:      not applicable (returns a path, prints nothing)

import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/services/web/playwright-loader.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'a11y', reason: 'the loader has no user-facing surface; its failures are envelopes elsewhere' },
    { dim: 'render', reason: 'it returns an absolute path and prints nothing' }
  ],
);

import { isInsidePath } from '../../../../src/shared/path-utils.js';

const PIN = '1.63.0';
const SESSION_ID = '2026-09-10-session-528a63';
const ws = withTmpWorkspacePerTest('peaks-web-loader-');

const ENV_KEYS = ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PATH', 'npm_config_cache'] as const;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
  }
  // Both cache-root spellings the loader can derive, under the tmp workspace.
  for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA'] as const) {
    process.env[key] = ws().path;
  }
  delete process.env['npm_config_cache'];
  mkdirSync(join(ws().path, 'npm-cache', '_npx'), { recursive: true });
  mkdirSync(join(ws().path, '.npm', '_npx'), { recursive: true });
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const previous = savedEnv.get(key);
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
  savedEnv.clear();
});

/** A fresh loader, un-memoized. */
async function loader(): Promise<typeof import('../../../../src/services/web/playwright-loader.js')> {
  return import('../../../../src/services/web/playwright-loader.js');
}

/** Write a `playwright` + `playwright-core` pair that both declare `version`. */
function plantPackage(
  modulesRoot: string,
  options: { version?: string; coreVersion?: string; marker?: string } = {},
): string {
  const version = options.version ?? PIN;
  mkdirSync(join(modulesRoot, 'playwright'), { recursive: true });
  mkdirSync(join(modulesRoot, 'playwright-core'), { recursive: true });
  writeFileSync(
    join(modulesRoot, 'playwright', 'package.json'),
    JSON.stringify({ name: 'playwright', version })
  );
  writeFileSync(
    join(modulesRoot, 'playwright', 'index.js'),
    `module.exports = { chromium: {}, marker: ${JSON.stringify(options.marker ?? 'clean')} };\n`
  );
  writeFileSync(
    join(modulesRoot, 'playwright-core', 'package.json'),
    JSON.stringify({ name: 'playwright-core', version: options.coreVersion ?? version })
  );
  return join(modulesRoot, 'playwright', 'index.js');
}

/** The npm exec cache entry the loader will scan, for a given `_npx` root. */
const cacheEntryModules = (root: string): string => join(root, 'deadbeef', 'node_modules');

const cacheRoots = (): string[] => [
  join(ws().path, 'npm-cache', '_npx'),
  join(ws().path, '.npm', '_npx')
];

describe('behavior — the admission rule', () => {
  it('when a consistent pinned package sits in the exec cache, should resolve it', async () => {
    // given: the arrangement acquisition actually produces
    plantPackage(cacheEntryModules(cacheRoots()[0]!));
    // when:  the loader resolves
    const resolved = (await loader()).resolvePlaywrightModule();
    // then:  it is that package — the positive control for every refusal below,
    //        and a resolution that is `realpath`ed and inside the scanned entry
    expect(resolved.replace(/\\/g, '/')).toMatch(/deadbeef\/node_modules\/playwright\/index\.js$/);
    expect(isInsidePath(resolved, realpathSync(ws().path))).toBe(true);
  });

  it('when PATH offers a package declaring another version, should not resolve it', async () => {
    // given: the security review's reproduction — a planted
    //        `<dir>/node_modules/playwright@9.9.9-alpha` one step ahead on PATH
    const evil = join(ws().path, 'evil');
    mkdirSync(join(evil, 'node_modules', '.bin'), { recursive: true });
    plantPackage(join(evil, 'node_modules'), { version: '9.9.9-alpha', marker: 'ATTACKER CODE RAN' });
    process.env['PATH'] = `${join(evil, 'node_modules', '.bin')}${delimiter}${savedEnv.get('PATH') ?? ''}`;
    // when:  the loader resolves with an otherwise empty cache
    // then:  PATH is not a root at all, so there is nothing to resolve
    const mod = await loader();
    expect(() => mod.resolvePlaywrightModule()).toThrow(/PLAYWRIGHT_NOT_RESOLVABLE/);
  });

  it('when npm_config_cache points at a forged tree declaring the pin, should not resolve it', async () => {
    // given: the security review's second reproduction — a fully consistent
    //        forged cache (its package.json says the pin) selected by env
    const forged = join(ws().path, 'forged-cache');
    plantPackage(cacheEntryModules(forged), { marker: 'FORGED CACHE RAN' });
    process.env['npm_config_cache'] = forged;
    // when:  the loader resolves
    // then:  the env-chosen root is not consulted, so the payload is not loaded
    const mod = await loader();
    expect(() => mod.resolvePlaywrightModule()).toThrow(/PLAYWRIGHT_NOT_RESOLVABLE/);
  });

  it('when the cached package declares a prerelease of the pin, should not resolve it', async () => {
    // given: the multi-version cache this machine really has, with the alpha first
    plantPackage(cacheEntryModules(cacheRoots()[0]!), { version: `${PIN}-alpha-1234` });
    // when:  the loader resolves
    // then:  an honest version mismatch is still rejected, on this tier too
    const mod = await loader();
    expect(() => mod.resolvePlaywrightModule()).toThrow(/PLAYWRIGHT_NOT_RESOLVABLE/);
  });

  it('when playwright-core contradicts the playwright manifest, should not resolve it', async () => {
    // given: a single forged manifest — the cheap half of a planted package
    plantPackage(cacheEntryModules(cacheRoots()[0]!), { version: PIN, coreVersion: '0.0.1' });
    // when:  the loader resolves
    // then:  the second, independent manifest must agree before anything loads
    const mod = await loader();
    expect(() => mod.resolvePlaywrightModule()).toThrow(/PLAYWRIGHT_NOT_RESOLVABLE/);
  });

  it('when a package is planted one level above the cache entry, should not resolve it', async () => {
    // given: `<cacheRoot>/node_modules/playwright`, reachable only by letting
    //        `require.resolve` walk UP out of the entry being scanned
    const root = cacheRoots()[0]!;
    plantPackage(join(root, 'node_modules'));
    // when:  the loader resolves
    // then:  the answer must be inside the anchor it scanned, so it is refused
    const mod = await loader();
    expect(() => mod.resolvePlaywrightModule()).toThrow(/PLAYWRIGHT_NOT_RESOLVABLE/);
  });

  it('when the cached package is a link to a tree outside the cache, should not resolve it', async () => {
    // given: `node_modules/playwright` inside the entry is a link to a
    //        consistent package that lives OUTSIDE the scanned root — the escape
    //        `require.resolve` alone cannot see, because it reports the link
    const outside = join(ws().path, 'outside');
    plantPackage(join(outside, 'node_modules'));
    const entryModules = cacheEntryModules(cacheRoots()[0]!);
    mkdirSync(entryModules, { recursive: true });
    try {
      symlinkSync(
        join(outside, 'node_modules', 'playwright'),
        join(entryModules, 'playwright'),
        'junction'
      );
    } catch {
      // Windows without the privilege: the containment rule under test is the
      // same one the walk-up case above exercises, so skip rather than pretend.
      return;
    }
    // when:  the loader resolves
    // then:  realpath puts the payload outside the scanned root and it is refused
    const mod = await loader();
    expect(() => mod.resolvePlaywrightModule()).toThrow(/PLAYWRIGHT_NOT_RESOLVABLE/);
    rmSync(join(entryModules, 'playwright'), { recursive: true, force: true });
  });
});

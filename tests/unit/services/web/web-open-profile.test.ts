// tests/unit/services/web/web-open-profile.test.ts
//
// `peaks web open --profile` — the CONSUMING half of S4's login profile
// (design §2; UD-5's follow-up). `peaks web login --profile` wrote
// `~/.peaks/web-profiles/<name>/storageState.json` and nothing read it; this is
// the verb that loads it into the dispatch's browser context.
//
// Driven through `routeOp` — the daemon's own entry point — with a fake
// Playwright module that RECORDS the options the context was built with, so what
// is asserted is the handoff the daemon really makes: the profile's
// `storageState.json` (the marker cookie inside it included) is what reaches
// `newContext`, and no profile means the per-dispatch state exactly as before.
// No browser is launched: what a real chromium does with that storage state is
// not something this file can claim, and it does not.
//
// HOME/USERPROFILE are redirected at the tmp workspace, so the profile tree these
// tests read is the tmp one and the developer's own `~/.peaks/web-profiles/` is
// never touched.
//
// Dimensions covered:
//   - behavior:    which state a context is built from, reuse, and the refusals
//   - integration: the real profile file under the redirected HOME, and its
//                  bytes (and directory) left untouched by a read
//   - a11y:        the failure codes and messages a caller receives
//   - render:      OMITTED — the daemon answers with structures; every text
//                  surface belongs to the CLI layer

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withEnv } from '../../_setup/io.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/services/web/web-open-profile.test.ts',
  ['behavior', 'integration', 'a11y'],
  [{ dim: 'render', reason: 'the daemon answers with structures; the CLI layer owns every text surface' }],
);

import { BrowserSessionManager } from '../../../../src/services/web/browser-session-manager.js';
import type { PwBrowser, PwContext, PwPage } from '../../../../src/services/web/playwright-loader.js';
import { routeOp } from '../../../../src/services/web/web-daemon-service.js';
import { webContextStatePath } from '../../../../src/services/web/web-artifact-paths.js';
import { loginStorageStatePath, webProfileDir } from '../../../../src/services/web/web-login-profile.js';

const SESSION_ID = '2026-09-10-session-528a63';
const URL_UNDER_TEST = 'https://example.test/';
/** The cookie that proves WHICH storage state the context was built from. */
const MARKER = 'from-the-work-profile';

const ws = withTmpWorkspacePerTest('peaks-web-open-profile-');

beforeEach(() => {
  const root = ws().path;
  withEnv('HOME', root);
  withEnv('USERPROFILE', root);
});

afterEach(() => {
  process.exitCode = 0;
});

/**
 * Write the profile `login` would have written: a storage state whose only
 * cookie carries the marker.
 */
function seedProfile(name: string, marker: string = MARKER): string {
  const path = loginStorageStatePath(name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      cookies: [
        {
          name: 'peaks-profile-marker',
          value: marker,
          domain: '127.0.0.1',
          path: '/',
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    }),
    'utf8',
  );
  return path;
}

/** The marker cookie's value in the file a context was built from. */
function markerIn(statePath: unknown): string | null {
  if (typeof statePath !== 'string') {
    return null;
  }
  const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as {
    cookies: Array<{ name: string; value: string }>;
  };
  return parsed.cookies.find((cookie) => cookie.name === 'peaks-profile-marker')?.value ?? null;
}

interface Recording {
  /** Every `newContext` options object, in order. */
  readonly contextOptions: Array<Record<string, unknown>>;
  /** Every teardown `storageState({ path })` target, in order. */
  readonly savedTo: Array<string | undefined>;
  readonly manager: BrowserSessionManager;
}

/** A fake browser that records what each context was built from. */
function recordingManager(root: string): Recording {
  const contextOptions: Array<Record<string, unknown>> = [];
  const savedTo: Array<string | undefined> = [];
  const browser: PwBrowser = {
    newContext: async (options: Record<string, unknown> = {}) => {
      contextOptions.push(options);
      const page = {
        goto: async () => undefined,
        title: async () => 'Fake Title',
        url: () => URL_UNDER_TEST,
        screenshot: async () => Buffer.from(''),
        evaluate: async <T,>() => null as T,
        locator: () => ({
          click: async () => undefined,
          innerText: async () => '',
          ariaSnapshotJSON: async () => [],
          screenshot: async () => Buffer.from(''),
        }),
      } as PwPage;
      return {
        newPage: async () => page,
        addInitScript: async () => undefined,
        storageState: async (options?: { path?: string }) => {
          savedTo.push(options?.path);
        },
        close: async () => undefined,
      } as PwContext;
    },
    version: () => 'fake-1.63.0',
    close: async () => undefined,
  };
  return {
    contextOptions,
    savedTo,
    manager: new BrowserSessionManager(browser, { projectRoot: root, sessionId: SESSION_ID }),
  };
}

describe('behavior — which state a context is built from', () => {
  it('when open names a profile, should build the context from that profile state', async () => {
    // given: a seeded profile and a recorded browser
    const profilePath = seedProfile('work');
    const { contextOptions, manager } = recordingManager(ws().path);
    // when: open is routed with the profile
    const response = await routeOp('open', { url: URL_UNDER_TEST, profile: 'work' }, async () => manager);
    // then: the context was built from the profile's storage state, and the
    //       marker cookie is in the bytes that state carries
    expect(response.ok).toBe(true);
    expect(contextOptions).toHaveLength(1);
    expect(contextOptions[0]?.['storageState']).toBe(profilePath);
    expect(markerIn(contextOptions[0]?.['storageState'])).toBe(MARKER);
  });

  it('when open names no profile and no dispatch state exists, should build a clean context', async () => {
    // given: no profile and no per-dispatch state on disk
    const { contextOptions, manager } = recordingManager(ws().path);
    // when: open is routed without a profile
    const response = await routeOp('open', { url: URL_UNDER_TEST }, async () => manager);
    // then: no storage state is passed at all — exactly what this verb did before
    expect(response.ok).toBe(true);
    expect(contextOptions).toHaveLength(1);
    expect(Object.hasOwn(contextOptions[0] ?? {}, 'storageState')).toBe(false);
  });

  it('when open names no profile but a dispatch state exists, should still use the dispatch state', async () => {
    // given: a per-dispatch storage state (the pre-existing convention)
    const dispatchState = webContextStatePath(ws().path, SESSION_ID, 'current');
    mkdirSync(dirname(dispatchState), { recursive: true });
    writeFileSync(dispatchState, JSON.stringify({ cookies: [], origins: [] }), 'utf8');
    const { contextOptions, manager } = recordingManager(ws().path);
    // when: open is routed without a profile
    const response = await routeOp('open', { url: URL_UNDER_TEST }, async () => manager);
    // then: the dispatch state is untouched behaviour
    expect(response.ok).toBe(true);
    expect(contextOptions[0]?.['storageState']).toBe(dispatchState);
  });

  it('when a later op names no profile, should reuse the profiled context', async () => {
    // given: a context already opened from a profile
    seedProfile('work');
    const { contextOptions, manager } = recordingManager(ws().path);
    await routeOp('open', { url: URL_UNDER_TEST, profile: 'work' }, async () => manager);
    // when: a profile-free op (text) runs on the same dispatch
    const response = await routeOp('text', {}, async () => manager);
    // then: the same context is reused — the profile is a property of the
    //       context, not of the verb that created it
    expect(response.ok).toBe(true);
    expect(contextOptions).toHaveLength(1);
  });

  it('when open names a different profile on a live dispatch, should refuse rather than reuse it', async () => {
    // given: a dispatch already opened from profile "work"
    seedProfile('work');
    seedProfile('other');
    const { contextOptions, manager } = recordingManager(ws().path);
    await routeOp('open', { url: URL_UNDER_TEST, profile: 'work' }, async () => manager);
    // when: the same dispatch is asked for a different profile
    const response = await routeOp('open', { url: URL_UNDER_TEST, profile: 'other' }, async () => manager);
    // then: it is refused by name instead of serving profile "other" with a
    //       browser logged in as "work"
    expect(response.ok).toBe(false);
    expect(response.code).toBe('WEB_PROFILE_CONFLICT');
    expect(contextOptions).toHaveLength(1);
  });
});

describe('a11y — the refusals a caller receives', () => {
  it('when the named profile does not exist, should fail by name instead of browsing unauthenticated', async () => {
    // given: no profile named "work"
    const { contextOptions, manager } = recordingManager(ws().path);
    // when: open is routed with it
    const response = await routeOp('open', { url: URL_UNDER_TEST, profile: 'work' }, async () => manager);
    // then: a named failure, no browser context, and no profile directory invented
    expect(response.ok).toBe(false);
    expect(response.code).toBe('WEB_PROFILE_NOT_FOUND');
    expect(response.message).toContain('work');
    expect(contextOptions).toHaveLength(0);
    expect(existsSync(webProfileDir('work'))).toBe(false);
  });

  it('when a traversing name arrives on the wire, should reject it at the daemon', async () => {
    // given: a payload that never went through the CLI's own check
    const { contextOptions, manager } = recordingManager(ws().path);
    // when: open is routed with a traversing name
    const response = await routeOp('open', { url: URL_UNDER_TEST, profile: '../escape' }, async () => manager);
    // then: the daemon's own guard rejects it, and no context was created
    expect(response.ok).toBe(false);
    expect(response.code).toBe('WEB_PROFILE_NAME_INVALID');
    expect(contextOptions).toHaveLength(0);
  });

  it('when a name with a separator arrives on the wire, should reject it at the daemon', async () => {
    // given: a payload with a path separator in the name
    const { contextOptions, manager } = recordingManager(ws().path);
    // when: open is routed with it
    const response = await routeOp('open', { url: URL_UNDER_TEST, profile: 'a/b' }, async () => manager);
    // then: it is refused by the same resolver, before any path is built
    expect(response.ok).toBe(false);
    expect(response.code).toBe('WEB_PROFILE_NAME_INVALID');
    expect(contextOptions).toHaveLength(0);
  });

  it('when a Windows device name arrives on the wire, should reject it at the daemon', async () => {
    // given: `.con`, which the charset test alone would let through
    const { manager } = recordingManager(ws().path);
    // when: open is routed with it
    const response = await routeOp('open', { url: URL_UNDER_TEST, profile: '.CON' }, async () => manager);
    // then: the resolver's device-name refusal is the one that answers
    expect(response.ok).toBe(false);
    expect(response.code).toBe('WEB_PROFILE_NAME_INVALID');
  });
});

describe('integration — the profile is READ-ONLY', () => {
  it('when open loads a profile, should leave the profile file and directory untouched', async () => {
    // given: a seeded profile whose bytes are recorded
    const profilePath = seedProfile('work');
    const before = readFileSync(profilePath, 'utf8');
    const { manager } = recordingManager(ws().path);
    // when: open is routed with it
    await routeOp('open', { url: URL_UNDER_TEST, profile: 'work' }, async () => manager);
    // then: the bytes are identical and the directory gained nothing — no
    //       refresh, no write-back, no staging residue (write-back is an
    //       undecided design question, so this slice does not do it)
    expect(readFileSync(profilePath, 'utf8')).toBe(before);
    expect(readdirSync(webProfileDir('work'))).toEqual(['storageState.json']);
  });

  it('when a profile is loaded, should not write the dispatch state into the profile tree', async () => {
    // given: a profile and a manager with a live context
    seedProfile('work');
    const { contextOptions, savedTo, manager } = recordingManager(ws().path);
    await routeOp('open', { url: URL_UNDER_TEST, profile: 'work' }, async () => manager);
    const profileState = String(contextOptions[0]?.['storageState'] ?? '');
    // when: teardown persists the dispatch state
    await manager.closeAll();
    // then: it was persisted to pw-profiles/<dispatchId>, never into the
    //       user-level tree the context was loaded from
    expect(profileState).toBe(join(ws().path, '.peaks', 'web-profiles', 'work', 'storageState.json'));
    expect(savedTo).toEqual([webContextStatePath(ws().path, SESSION_ID, 'current')]);
    expect(readdirSync(webProfileDir('work'))).toEqual(['storageState.json']);
  });
});

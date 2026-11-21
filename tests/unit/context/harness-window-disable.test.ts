// tests/unit/context/harness-window-disable.test.ts
//
// The `--disable` arms of the harness window, split out of
// `harness-window-config.test.ts` when that file crossed the 500-line tests cap.
//
// The property under test: "do not manage this key here" is expressible at any
// moment — including before peaks-loop has ever written the key — and the verb
// that records it neither removes nor claims the window value. The H1 home guard
// (E4) is pinned here too: `--project .` from a fresh terminal resolves to
// $HOME, so an opt-out written there would be a peaks-loop row in the user's
// personal settings, left by the command they ran to say "leave me alone".
//
// Dimensions covered:
//   - behavior:    disable / already-opted-out / the E4 refusals / the controls
//   - integration: real fs — a real settings file, and the next probe's outcome
//
// Dimensions omitted:
//   - render:      the module returns a result record; the CLI renders the sentence
//   - a11y:        no user-visible text is emitted here; the CLI renders these results

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  HARNESS_WINDOW_SYNC_OPTOUT_KEY,
  HARNESS_WINDOW_SYNC_OPTOUT_VALUE,
  disableHarnessWindowSync,
  reenableHarnessWindowSync,
  syncHarnessWindow,
  type HarnessWindowLocation
} from '~/src/services/context/harness-window-config';

declareDimensions(
  'tests/unit/context/harness-window-disable.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the module returns a result record; the CLI renders the sentence' },
    { dim: 'a11y', reason: 'no user-visible text is emitted here; the CLI renders these results' }
  ]
);

const KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';

/** A settings file shaped like the real one: a third-party env key + hooks. */
function existingSettings(): Record<string, unknown> {
  return {
    env: { GATEGUARD_EXEMPT_GLOBS: '.peaks/**' },
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'peaks gate enforce' }] }]
    }
  };
}

describe('harness-window-config — disable (the opt-out verb)', () => {
  let root = '';
  let location: HarnessWindowLocation = { settingsPath: '', envVar: KEY };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-harness-window-disable-'));
    location = { settingsPath: join(root, '.claude', 'settings.local.json'), envVar: KEY };
  });

  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  function writeSettings(value: unknown): void {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(location.settingsPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }

  function envBlock(): Record<string, unknown> {
    const parsed = JSON.parse(readFileSync(location.settingsPath, 'utf8')) as {
      env?: Record<string, unknown>;
    };
    return parsed['env'] ?? {};
  }

  it('when the project has never been written to, should record the opt-out and let a later sync write NOTHING', () => {
    // given: a FRESH project — no window key and no provenance marker, the exact
    //        state in which `resetHarnessWindow` is a no-op, so before `disable`
    //        existed "stop managing this key" was only expressible AFTER a probe
    //        had written it (the wrong order round)
    // when: the user says "do not manage this key here"
    // then: the opt-out is on disk and the window key is untouched —
    //       "stop managing" is not "remove"
    writeSettings(existingSettings());
    const before = readFileSync(location.settingsPath, 'utf8');
    const result = disableHarnessWindowSync({ location });
    expect(result).toMatchObject({ action: 'disabled', settingsPath: location.settingsPath });
    expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBe(HARNESS_WINDOW_SYNC_OPTOUT_VALUE);
    expect(envBlock()[KEY]).toBeUndefined();
    expect(envBlock()['GATEGUARD_EXEMPT_GLOBS']).toBe('.peaks/**');
    expect(before).not.toBe(readFileSync(location.settingsPath, 'utf8'));
    // and: the probe that would have written the key now does not
    const sync = syncHarnessWindow({ location, tokens: 1_000_000, env: {} });
    expect(sync.action).toBe('skipped');
    expect(sync.reason).toBe('opted-out');
    expect(envBlock()[KEY]).toBeUndefined();
    // and: re-enabling restores management (the way back exists)
    expect(reenableHarnessWindowSync({ location }).action).toBe('reenabled');
    expect(syncHarnessWindow({ location, tokens: 1_000_000, env: {} }).action).toBe('written');
    expect(envBlock()[KEY]).toBe('1000000');
  });

  it('when the sync is working, should be the control: the SAME probe writes the key', () => {
    // given: the identical fresh project, WITHOUT the opt-out — without this
    //        control a probe that failed for any unrelated reason would look
    //        exactly like the opt-out working
    // when: the probe runs
    // then: it writes, so "nothing was written" above is the opt-out's doing
    writeSettings(existingSettings());
    const sync = syncHarnessWindow({ location, tokens: 1_000_000, env: {} });
    expect(sync.action).toBe('written');
    expect(envBlock()[KEY]).toBe('1000000');
  });

  it('when a value is already in force, should leave it exactly as it was', () => {
    // given: a window the user pinned by hand (no provenance marker)
    // when: the opt-out is recorded
    // then: only the opt-out row was added — the pinned number survives, so
    //       peaks-loop never claims (or overwrites) a value it did not write
    writeSettings({ env: { [KEY]: '150000' } });
    const before = readFileSync(location.settingsPath, 'utf8');
    const result = disableHarnessWindowSync({ location });
    expect(result.action).toBe('disabled');
    expect(envBlock()[KEY]).toBe('150000');
    expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBe(HARNESS_WINDOW_SYNC_OPTOUT_VALUE);
    expect(readFileSync(location.settingsPath, 'utf8').length).toBeGreaterThan(before.length);
  });

  it('when the opt-out is already recorded, should report it and rewrite nothing', () => {
    // given: a file that already carries the opt-out row
    // when: the command runs a second time
    // then: idempotent, and it says so rather than pretending to have acted
    writeSettings({ env: { [HARNESS_WINDOW_SYNC_OPTOUT_KEY]: HARNESS_WINDOW_SYNC_OPTOUT_VALUE } });
    const before = readFileSync(location.settingsPath, 'utf8');
    const result = disableHarnessWindowSync({ location });
    expect(result.action).toBe('already-opted-out');
    expect(readFileSync(location.settingsPath, 'utf8')).toBe(before);
  });

  it('when the settings file cannot be parsed, should report that instead of clobbering it', () => {
    // given: a file peaks-loop cannot safely edit
    // when: the opt-out is requested
    // then: nothing is written — the honest answer is "could not record it"
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(location.settingsPath, '{ not json\n', 'utf8');
    const result = disableHarnessWindowSync({ location });
    expect(result.action).toBe('unreadable-settings');
    expect(readFileSync(location.settingsPath, 'utf8')).toBe('{ not json\n');
  });

  // E4 (rid 2026-09-13-defects-e). The H1 guard above covers the WINDOW write;
  // `--disable` opened a second door onto the same hazard, because `--project .`
  // from a fresh terminal resolves the root to `$HOME`. The two keys differ in
  // WHAT they change, not in WHERE they land, and at `$HOME` the opt-out has no
  // meaning to lose: the window write is already refused there.
  it('when the project root IS the home directory, should refuse and write NO file (E4)', () => {
    // given: the fresh-terminal case — cwd is $HOME and --project defaulted to it
    // when: the opt-out is requested for that root
    // then: refused, and the file is byte-identical — not even the opt-out row
    writeSettings(existingSettings());
    const before = readFileSync(location.settingsPath, 'utf8');
    const result = disableHarnessWindowSync({ location: { ...location, projectRoot: homedir() } });
    expect(result.action).toBe('refused-unsafe-project-root');
    expect(readFileSync(location.settingsPath, 'utf8')).toBe(before);
    expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBeUndefined();
  });

  it('when no file exists at the refused root, should create nothing at all (E4)', () => {
    // given: a home-rooted location whose settings file does not exist —
    //        "refused" must mean refused BEFORE any mkdir
    // when: the opt-out is requested
    // then: neither the file nor its directory was created
    const result = disableHarnessWindowSync({ location: { ...location, projectRoot: homedir() } });
    expect(result.action).toBe('refused-unsafe-project-root');
    expect(existsSync(location.settingsPath)).toBe(false);
    expect(existsSync(join(root, '.claude'))).toBe(false);
  });

  it('when the project root is a SUBDIRECTORY of home, should still record the opt-out (E4 control)', () => {
    // given: ~/my-project — the ordinary project root, which is NOT home itself
    // when: the opt-out is requested there
    // then: recorded — the guard is exact-home, exactly like H1's
    writeSettings(existingSettings());
    const result = disableHarnessWindowSync({
      location: { ...location, projectRoot: join(homedir(), 'my-project') }
    });
    expect(result.action).toBe('disabled');
    expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBe(HARNESS_WINDOW_SYNC_OPTOUT_VALUE);
  });

  it('when the location carries no project root, should make no claim either way (E4 opt-in)', () => {
    // given: a caller that built its own location, so the optional field is
    //        genuinely absent rather than home-shaped
    // when: the opt-out runs without a root
    // then: no guard fires — absent is not the same claim as "is home"
    writeSettings(existingSettings());
    expect(disableHarnessWindowSync({ location }).action).toBe('disabled');
  });
});

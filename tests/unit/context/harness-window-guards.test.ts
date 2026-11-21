// tests/unit/context/harness-window-guards.test.ts
//
// The two WHERE/WHAT guards of the harness window sync, split out of
// `harness-window-config.test.ts` when that file crossed the 500-line tests cap.
//
// E1 — the harness accepts a token count only inside 100000..1000000; outside it
// the value is ignored or capped, so peaks-loop would divide its ratio by a
// number the harness is not using. Refusal, not clamping.
// H1 — never write into the user's home directory: `--project .` from a fresh
// terminal resolves the root to $HOME, whose settings file is shared by every
// project the user owns.
//
// Dimensions covered:
//   - behavior:    each refusal, its reason, and the byte-identical file
//   - integration: real fs — the result the notice is rendered from
//
// Dimensions omitted:
//   - render:      the sentence wording is pinned in harness-window-sync-notice.test.ts
//   - a11y:        the CLI renders these results; asserted in the CLI tests

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  HARNESS_WINDOW_WRITTEN_KEY,
  describeHarnessWindowSync,
  harnessWindowSyncWarning,
  syncHarnessWindow,
  type HarnessWindowLocation
} from '~/src/services/context/harness-window-config';

declareDimensions(
  'tests/unit/context/harness-window-guards.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'sentence wording is pinned in harness-window-sync-notice.test.ts' },
    { dim: 'a11y', reason: 'the CLI renders these results; asserted in the CLI tests' }
  ]
);

const KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';

/** A settings file shaped like the real one: a third-party env key + hooks. */
function existingSettings(): Record<string, unknown> {
  return { env: { GATEGUARD_EXEMPT_GLOBS: '.peaks/**' } };
}

describe('harness-window-config — the band and home guards', () => {
  let root = '';
  let location: HarnessWindowLocation = { settingsPath: '', envVar: KEY };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-harness-window-guards-'));
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
    writeFileSync(
      location.settingsPath,
      `${JSON.stringify(value, null, 2)}
`,
      'utf8'
    );
  }

  function envBlock(): Record<string, unknown> {
    const parsed = JSON.parse(readFileSync(location.settingsPath, 'utf8')) as {
      env?: Record<string, unknown>;
    };
    return parsed['env'] ?? {};
  }

  describe('(behavior) E1 — the harness window band is 100000..1000000', () => {
    it('when the value is BELOW the harness minimum, should refuse it and report both numbers', () => {
      // given: an empty slot (so nothing but the range can be the reason)
      // when: the value is BELOW the harness minimum
      // then: refuse it and report both numbers
      writeSettings(existingSettings());
      const before = readFileSync(location.settingsPath, 'utf8');
      // when: a probe resolves a window the harness would ignore
      const result = syncHarnessWindow({ location, tokens: 50_000, env: {} });
      // then: nothing is written, and the refusal carries the value it refused
      expect(result).toMatchObject({
        action: 'skipped',
        reason: 'out-of-harness-range',
        requestedTokens: 50_000,
        previousTokens: null
      });
      expect(readFileSync(location.settingsPath, 'utf8')).toBe(before);
      expect(envBlock()[KEY]).toBeUndefined();
      expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBeUndefined();
      // and: the notice names the number, the band, and the consequence — the
      //      whole remedy for a state peaks-loop refuses to write its way out of
      const notice = describeHarnessWindowSync(result);
      expect(notice).toContain('50000');
      expect(notice).toContain('100000');
      expect(notice).toContain('1000000');
      expect(notice).not.toContain('CONFLICT');
      // and: the machine channel says it too, so a JSON consumer reading a ratio
      //      cannot miss that its denominator is not the harness's window
      expect(harnessWindowSyncWarning(result)).toContain('50000');
      expect(harnessWindowSyncWarning(result)).toContain('1000000');
    });

    it('when the value is ABOVE the harness maximum, should refuse it as well', () => {
      // given: the other end of the band — the `Math.min(native, override)` cap (the harness reduces any value above the model's own window, and no model's window exceeds 1000000)
      // when: the value is ABOVE the harness maximum
      // then: refuse it as well
      writeSettings(existingSettings());
      const before = readFileSync(location.settingsPath, 'utf8');
      // when: a probe resolves 2M
      const result = syncHarnessWindow({ location, tokens: 2_000_000, env: {} });
      // then: refused — writing it would plant a key the harness will not honour
      expect(result).toMatchObject({
        action: 'skipped',
        reason: 'out-of-harness-range',
        requestedTokens: 2_000_000
      });
      expect(readFileSync(location.settingsPath, 'utf8')).toBe(before);
      expect(describeHarnessWindowSync(result)).toContain('2000000');
    });

    it('when the value sits ON either band edge, should write it (control)', () => {
      // given: the two values the harness DOES accept. Without this case the refusals above would be indistinguishable from a guard that rejected every number.
      // when: the value sits ON either band edge
      // then: write it (control)
      writeSettings(existingSettings());
      // when: the minimum is synced
      expect(syncHarnessWindow({ location, tokens: 100_000, env: {} })).toMatchObject({
        action: 'written',
        tokens: 100_000
      });
      expect(envBlock()[KEY]).toBe('100000');
      // and: the maximum is synced over it
      expect(syncHarnessWindow({ location, tokens: 1_000_000, env: {} })).toMatchObject({
        action: 'written',
        tokens: 1_000_000
      });
      expect(envBlock()[KEY]).toBe('1000000');
    });

    it('when an out-of-band value is ALREADY in the file, should refuse to write and say the file is out of band', () => {
      // given: a hand-planted 2M (or a row written by a release that predates the band check) — the file, not the request, is out of range here
      // when: an out-of-band value is ALREADY in the file
      // then: refuse to write and say the file is out of band
      writeSettings({ env: { [KEY]: '2000000' } });
      const before = readFileSync(location.settingsPath, 'utf8');
      // when: a probe resolves an in-band window
      const result = syncHarnessWindow({ location, tokens: 200_000, env: {} });
      // then: refused, and the notice names the out-of-band value on disk —
      //       the reason token alone would leave the reader with no number
      expect(result.action).toBe('skipped');
      expect(describeHarnessWindowSync(result)).toContain('2000000');
      expect(readFileSync(location.settingsPath, 'utf8')).toBe(before);
    });
  });

  describe("(behavior) H1 — never write into the user's home directory", () => {
    it('when the project root IS the home directory, should skip and write nothing', () => {
      // given: a HOME-shaped target
      // when: the project root IS the home directory
      // then: skip and write nothing
      writeSettings(existingSettings());
      const before = readFileSync(location.settingsPath, 'utf8');
      // when: the sync runs with the home directory as the project root
      const result = syncHarnessWindow({
        location: { ...location, projectRoot: homedir() },
        tokens: 1_000_000,
        env: {}
      });
      // then: refused with a reason, and the file is untouched
      expect(result).toMatchObject({ action: 'skipped', reason: 'unsafe-project-root' });
      expect(readFileSync(location.settingsPath, 'utf8')).toBe(before);
      // and: the refusal is actionable, not an opaque reason token — the
      // harness reports an override silently, so peaks-loop must not
      expect(describeHarnessWindowSync(result)).toContain('home settings');
      expect(describeHarnessWindowSync(result)).toContain(location.settingsPath);
    });

    it('when the project root is a SUBDIRECTORY of home, should still write (an ordinary project)', () => {
      // given: ~/my-project — home is only its parent
      // when: the project root is a SUBDIRECTORY of home
      // then: still write (an ordinary project)
      writeSettings(existingSettings());
      // when: the sync runs
      const result = syncHarnessWindow({
        location: { ...location, projectRoot: join(homedir(), 'my-project') },
        tokens: 1_000_000,
        env: {}
      });
      // then: written — the guard is exact-home, not "inside home"
      expect(result.action).toBe('written');
    });

    it('when the location carries no project root, should make no claim either way', () => {
      // given: a caller that built its own location (tests, future writers)
      // when: the location carries no project root
      // then: make no claim either way
      writeSettings(existingSettings());
      // when: the sync runs without a root
      const result = syncHarnessWindow({ location, tokens: 1_000_000, env: {} });
      // then: no guard fires — the optional field is opt-in
      expect(result.action).toBe('written');
    });
  });
});

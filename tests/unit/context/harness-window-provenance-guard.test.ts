// tests/unit/context/harness-window-provenance-guard.test.ts
//
// B1 / A5 — the provenance guard, split out of `harness-window-config.test.ts`
// when that file crossed the 500-line tests cap.
//
// THE DEFECT THIS PINS. Round 2 decided whether to write by comparing the FILE
// against the resolved window, and the resolved window is read env-first. So
// provenance gated the 1M *bump* but never the *write*: a human hand-edited the
// key from the 200000 peaks-loop wrote to 150000, a stale process env still said
// 200000, and the next probe reverted the edit AND re-armed the marker — which
// then authorised the very rescue that raised the human's key to 1000000. No
// human was needed for the second half: another session's stale env downgraded a
// 1M file the same way (A5).
//
// Dimensions covered:
//   - behavior:    the provenance truth table, with controls
//   - integration: real fs — byte-identical files where nothing may be written
//
// Dimensions omitted:
//   - render:      the sentence wording is pinned in harness-window-sync-notice.test.ts
//   - a11y:        the CLI renders these results; asserted in the CLI tests

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  HARNESS_WINDOW_WRITTEN_KEY,
  readHarnessWindow,
  syncHarnessWindow,
  type HarnessWindowLocation
} from '~/src/services/context/harness-window-config';

declareDimensions(
  'tests/unit/context/harness-window-provenance-guard.test.ts',
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

describe('harness-window-config — a value peaks-loop did not write is never touched', () => {
  let root = '';
  let location: HarnessWindowLocation = { settingsPath: '', envVar: KEY };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-harness-provenance-'));
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

  describe('(behavior) B1 / A5 — a value peaks-loop did not write is never touched', () => {
    it('when a human hand-edits the window after a sync, should leave it AND its stale marker alone (B1)', () => {
      // given: peaks-loop wrote 200000, then the human re-pinned the key to 150000 while the running session's env still says 200000
      // when: a human hand-edits the window after a sync
      // then: leave it AND its stale marker alone (B1)
      writeSettings({ env: { [KEY]: '150000', [HARNESS_WINDOW_WRITTEN_KEY]: '200000' } });
      const before = readFileSync(location.settingsPath, 'utf8');
      const frozenEnv = { [KEY]: '200000' } as NodeJS.ProcessEnv;
      // when: the next probe syncs — with the FILE's value (what the ratio now
      //       divides by) and, hostile case, with the stale env's value
      const withFileValue = syncHarnessWindow({ location, tokens: 150_000, env: frozenEnv });
      const withStaleEnvValue = syncHarnessWindow({ location, tokens: 200_000, env: frozenEnv });
      // then: neither call writes. The human's 150000 survives, and the stale
      //       marker is NOT re-armed — re-arming it is what turned the next 1M
      //       rescue loose on a value the human owned.
      expect(withFileValue.action).toBe('unchanged');
      expect(withStaleEnvValue.action).toBe('skipped');
      expect(withStaleEnvValue.reason).toBe('not-peaks-owned');
      expect(readFileSync(location.settingsPath, 'utf8')).toBe(before);
      expect(envBlock()[KEY]).toBe('150000');
      expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBe('200000');
      expect(readHarnessWindow({ location, env: frozenEnv }).peakWritten).toBe(false);
    });

    it('when a stale env is in play, should not downgrade a peaks-written file (A5)', () => {
      // given: a 1M window peaks-loop rescued, and another session's stale env of 200000 still sitting in this process
      // when: a stale env is in play
      // then: not downgrade a peaks-written file (A5)
      writeSettings({ env: { [KEY]: '1000000', [HARNESS_WINDOW_WRITTEN_KEY]: '1000000' } });
      const frozenEnv = { [KEY]: '200000' } as NodeJS.ProcessEnv;
      // when: the value the RATIO PIPELINE hands the writer is used — the
      //       file's, not the frozen env's (`resolveHarnessRatioWindow`; that
      //       is where A5 is actually closed, because a bare number cannot be
      //       told apart from a deliberate lowering once it reaches here)
      const handed = readHarnessWindow({ location, env: frozenEnv }).fileTokens;
      expect(handed).toBe(1_000_000);
      const result = syncHarnessWindow({ location, tokens: handed, env: frozenEnv });
      // then: nothing is written and the file keeps 1M
      expect(result.action).toBe('unchanged');
      expect(envBlock()[KEY]).toBe('1000000');
    });

    it('when peaks-loop is the writer, should still allow a deliberate LOWERING of its own value', () => {
      // given: peaks-loop's own 1M window
      // when: peaks-loop is the writer
      // then: still allow a deliberate LOWERING of its own value
      writeSettings({ env: { [KEY]: '1000000', [HARNESS_WINDOW_WRITTEN_KEY]: '1000000' } });
      // when: an explicit pin resolves lower (config / PEAKS_CONTEXT_WINDOW_TOKENS)
      const result = syncHarnessWindow({ location, tokens: 500_000, env: {} });
      // then: written — refusing here would silently ignore the user's pin,
      //       which is the failure mode this layer's ORDER was chosen to avoid.
      //       This is the boundary of the B1 guard: it protects values we did
      //       NOT write, not values we did.
      expect(result).toMatchObject({
        action: 'written',
        tokens: 500_000,
        previousTokens: 1_000_000
      });
      expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBe('500000');
    });

    it('when the file carries a hand-set value with no marker at all, should never claim it (A1)', () => {
      // given: a pin planted by the user, never written by peaks-loop
      // when: the file carries a hand-set value with no marker at all
      // then: never claim it (A1)
      writeSettings({ env: { [KEY]: '400000' } });
      // when: a sync wants a different number
      const result = syncHarnessWindow({ location, tokens: 500_000, env: {} });
      // then: refused, and no marker appeared to claim ownership
      expect(result).toMatchObject({
        action: 'skipped',
        reason: 'not-peaks-owned',
        previousTokens: 400_000
      });
      expect(envBlock()).toEqual({ [KEY]: '400000' });
    });

    it('when the value was hand-changed under a matching-length marker, should still refuse (A2)', () => {
      // given: marker 200000, value re-typed by hand to 300000
      // when: the value was hand-changed under a matching-length marker
      // then: still refuse (A2)
      writeSettings({ env: { [KEY]: '300000', [HARNESS_WINDOW_WRITTEN_KEY]: '200000' } });
      // when: a sync runs
      const result = syncHarnessWindow({
        location,
        tokens: 300_000,
        env: { [KEY]: '200000' }
      });
      // then: unchanged, and the marker stays at the value peaks-loop actually wrote
      expect(result.action).toBe('unchanged');
      expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBe('200000');
    });

    it('when peaks-loop is still the writer, should keep updating its own value (the 1M rescue path)', () => {
      // given: peaks-loop's own 200000, stale env and all
      // when: peaks-loop is still the writer
      // then: keep updating its own value (the 1M rescue path)
      writeSettings({ env: { [KEY]: '200000', [HARNESS_WINDOW_WRITTEN_KEY]: '200000' } });
      const frozenEnv = { [KEY]: '200000' } as NodeJS.ProcessEnv;
      // when: the rescue raises the window
      const result = syncHarnessWindow({ location, tokens: 1_000_000, env: frozenEnv });
      // then: written, and the marker moves WITH the value (never split)
      expect(result).toMatchObject({
        action: 'written',
        tokens: 1_000_000,
        previousTokens: 200_000
      });
      expect(envBlock()[KEY]).toBe('1000000');
      expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBe('1000000');
    });

    it('when the file carries an unparseable value, should refuse to clobber the typo', () => {
      // given: a hand-edited `500k` (the harness documents plain token counts)
      // when: the file carries an unparseable value
      // then: refuse to clobber the typo
      writeSettings({ env: { [KEY]: '500k' } });
      // when: a sync runs
      const result = syncHarnessWindow({ location, tokens: 200_000, env: {} });
      // then: the typo is a value peaks-loop did not write, so it is reported
      //       rather than silently replaced
      expect(result).toMatchObject({ action: 'skipped', reason: 'not-peaks-owned' });
      expect(envBlock()[KEY]).toBe('500k');
    });

    it('when the file has no such key, should still materialize one (nothing to overwrite)', () => {
      // given: the key only in the process env (an outer settings layer)
      // when: the file has no such key
      // then: still materialize one (nothing to overwrite)
      writeSettings(existingSettings());
      // when: the sync runs
      const result = syncHarnessWindow({
        location,
        tokens: 1_000_000,
        env: { [KEY]: '1000000' }
      });
      // then: written — an empty slot is not a human's value
      expect(result.action).toBe('written');
      expect(envBlock()[KEY]).toBe('1000000');
    });
  });
  describe('(behavior) provenance — peaks-written vs human-set', () => {
    it('when the sync writes the window, should mark it as peaks-written in the same write', () => {
      // given: an untouched settings file
      // when: the sync writes the window
      // then: mark it as peaks-written in the same write
      writeSettings(existingSettings());
      // when: the sync materializes a window
      syncHarnessWindow({ location, tokens: 200_000, env: {} });
      // then: the marker records exactly what peaks-loop wrote...
      expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBe('200000');
      expect(readHarnessWindow({ location, env: {} }).peakWritten).toBe(true);
    });

    it('when the user hand-edits the window after a sync, should report it as NOT peaks-written', () => {
      // given: a window peaks-loop wrote, then changed by hand
      // when: the user hand-edits the window after a sync
      // then: report it as NOT peaks-written
      writeSettings({ env: { [KEY]: '200000', [HARNESS_WINDOW_WRITTEN_KEY]: '200000' } });
      expect(readHarnessWindow({ location, env: {} }).peakWritten).toBe(true);
      // when: the user takes the key over
      writeSettings({ env: { [KEY]: '300000', [HARNESS_WINDOW_WRITTEN_KEY]: '200000' } });
      // then: the marker no longer matches, so the rescue must stand down
      expect(readHarnessWindow({ location, env: {} }).peakWritten).toBe(false);
    });

    it('when a value is set with no marker at all, should report it as NOT peaks-written', () => {
      // given: a hand-authored env block (the shape the user plants themselves)
      // when: a value is set with no marker at all
      // then: report it as NOT peaks-written
      writeSettings({ env: { [KEY]: '1000000' } });
      // then: never claim ownership of a value this code did not write
      expect(readHarnessWindow({ location, env: {} }).peakWritten).toBe(false);
    });

    it('when peaks-loop refreshes the file mid-session, should stay peaks-written on the NEXT probe (no flip back)', () => {
      // given: a running session that froze the process env at the OLD value, and a file peaks-loop has just refreshed to a raised window
      // when: peaks-loop refreshes the file mid-session
      // then: stay peaks-written on the NEXT probe (no flip back)
      writeSettings({ env: { [KEY]: '200000', [HARNESS_WINDOW_WRITTEN_KEY]: '200000' } });
      const frozenEnv = { [KEY]: '200000' } as NodeJS.ProcessEnv;
      expect(readHarnessWindow({ location, env: frozenEnv }).peakWritten).toBe(true);
      syncHarnessWindow({ location, tokens: 1_000_000, env: frozenEnv });
      // when: the SAME session probes again — the env still says 200000
      const after = readHarnessWindow({ location, env: frozenEnv });
      // then: provenance is decided by the FILE against the marker, so the key
      //       is still recognised as peaks-loop's own. Judging it by the stale
      //       in-force copy would flip this to false, switch the late 1M rescue
      //       off, and re-pin the ratio at 1.0 on the very next probe — the
      //       self-lock restored through the back door.
      expect(after.tokens).toBe(200_000);
      expect(after.peakWritten).toBe(true);
    });

    it('when the window is unchanged but the process env carries it, should still report unchanged (file-based idempotence)', () => {
      // given: the file holds a peaks-written window and a RUNNING session still has the previous value in its process env
      // when: the window is unchanged but the process env carries it
      // then: still report unchanged (file-based idempotence)
      writeSettings(existingSettings());
      syncHarnessWindow({ location, tokens: 1_000_000, env: {} });
      const afterFirst = readFileSync(location.settingsPath, 'utf8');
      // when: a later probe of the SAME session syncs the same value
      const result = syncHarnessWindow({
        location,
        tokens: 1_000_000,
        env: { [KEY]: '200000' }
      });
      // then: no rewrite — idempotence is a property of the file, not of the
      //       process env, or every probe of a running session would rewrite a
      //       byte-identical file
      expect(result.action).toBe('unchanged');
      expect(readFileSync(location.settingsPath, 'utf8')).toBe(afterFirst);
    });
  });
});

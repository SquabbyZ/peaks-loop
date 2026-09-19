// tests/unit/context/harness-window-config.test.ts
//
// 4-dimension unit test for
// src/services/context/harness-window-config.ts (slice
// 2026-09-13-auto-compact-trigger-ownership, T1 + T2).
//
// The property under test is the slice's whole point: the window peaks-loop
// divides its context ratio by must BE the window it configures for the
// harness. These tests pin the write (T2), the idempotence, the rollback, and
// the "do not disturb anything else in that file" contract — this repo's own
// `.claude/settings.local.json` carries a third-party `env` key and three
// live `PreToolUse` hooks, and a sync that dropped one of them would break the
// session it was trying to help.
//
// Dimensions covered:
//   - render:      HarnessWindowSyncResult / ReadResult shapes + action enums
//   - behavior:    read precedence, sync written/unchanged/skipped, opt-out,
//                  rollback, re-enable, malformed input tolerance
//   - integration: real fs — read-modify-write of a settings file, byte-level
//                  idempotence, preservation of sibling env + hooks entries
//   - a11y:        not applicable — no user-visible text is emitted here; the
//                  CLI renders these results (asserted in the CLI tests)
//
// Run with: pnpm vitest run tests/unit/context/harness-window-config.test.ts

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  HARNESS_WINDOW_SYNC_OPTOUT_KEY,
  HARNESS_WINDOW_SYNC_OPTOUT_VALUE,
  HARNESS_WINDOW_WRITTEN_KEY,
  describeHarnessWindowSync,
  disableHarnessWindowSync,
  harnessWindowSyncWarning,
  parseHarnessWindowTokens,
  readHarnessWindow,
  reenableHarnessWindowSync,
  resetHarnessWindow,
  syncHarnessWindow,
  type HarnessWindowLocation
} from '~/src/services/context/harness-window-config';

declareDimensions(
  'tests/unit/context/harness-window-config.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason: 'pure file/JSON transform; the CLI renders these results, not this module'
    }
  ]
);

const KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';

/** A settings file shaped like the real one: a third-party env key + hooks. */
function existingSettings(): Record<string, unknown> {
  return {
    env: { GATEGUARD_EXEMPT_GLOBS: '.peaks/**' },
    hooks: {
      PreToolUse: [
        {
          matcher: 'Write|Edit|MultiEdit',
          hooks: [{ type: 'command', command: 'node "write-gate.js"', shell: 'powershell' }]
        },
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'peaks code gate-step-08', shell: 'powershell' }]
        },
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'peaks gate enforce', shell: 'powershell' }]
        }
      ]
    }
  };
}

describe('harness-window-config', () => {
  let root = '';
  let location: HarnessWindowLocation = { settingsPath: '', envVar: KEY };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-harness-window-'));
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

  function readSettings(): Record<string, unknown> {
    return JSON.parse(readFileSync(location.settingsPath, 'utf8')) as Record<string, unknown>;
  }

  function envBlock(): Record<string, unknown> {
    return (readSettings()['env'] ?? {}) as Record<string, unknown>;
  }

  describe('(behavior) parse + read precedence', () => {
    it('when a candidate window is parsed, should accept only positive integers (number or numeric string)', () => {
      // given: the shapes an env block or a process env can carry
      // when: parseHarnessWindowTokens runs
      // then: only positive finite integers pass — the harness rejects a `500k` suffix
      expect(parseHarnessWindowTokens(1_000_000)).toBe(1_000_000);
      expect(parseHarnessWindowTokens('1000000')).toBe(1_000_000);
      expect(parseHarnessWindowTokens(' 850000 ')).toBe(850_000);
      for (const bad of [
        '500k',
        '0',
        '-1',
        '1.5',
        'abc',
        '',
        '  ',
        null,
        undefined,
        {},
        [],
        true
      ]) {
        expect(parseHarnessWindowTokens(bad)).toBeNull();
      }
    });

    it('when both sides carry a value, should let the PROCESS ENV win (it is what the running session captured)', () => {
      // given: the file says 200000 and the running session's env says 1000000
      writeSettings({ env: { [KEY]: '200000' } });
      // when: the window is read
      const out = readHarnessWindow({ location, env: { [KEY]: '1000000' } as NodeJS.ProcessEnv });
      // then: the process env (this session) wins, and the file is reported as the source only when env is silent
      expect(out).toEqual({
        tokens: 1_000_000,
        raw: '1000000',
        source: 'process-env',
        optedOut: false,
        peakWritten: false,
        // ...while the FILE's own value is reported separately: it is the one
        // the ratio divides by (see resolveHarnessRatioWindow), because the env
        // copy is a snapshot the harness froze at session start.
        fileTokens: 200_000,
        fileRaw: '200000'
      });
    });

    it('when only the file carries a value, should report it as settings-file and tolerate an unparseable one without throwing', () => {
      // given: a settings file with a plain token count
      writeSettings({ env: { [KEY]: '850000' } });
      // when: the window is read with an empty process env
      const out = readHarnessWindow({ location, env: {} });
      // then: the file wins, source is settings-file
      expect(out).toEqual({
        tokens: 850_000,
        raw: '850000',
        source: 'settings-file',
        optedOut: false,
        peakWritten: false,
        fileTokens: 850_000,
        fileRaw: '850000'
      });

      // given: a garbage value on disk (hand-edited)
      writeSettings({ env: { [KEY]: 'not-a-number' } });
      // when: the window is read
      const bad = readHarnessWindow({ location, env: {} });
      // then: tokens is null (ignored) — a bad value must not throw or win
      expect(bad.tokens).toBeNull();
      expect(bad.source).toBe('settings-file');
    });

    it('when neither side carries the key, should report a null window rather than a default', () => {
      // given: a settings file with other env keys only
      writeSettings({ env: { GATEGUARD_EXEMPT_GLOBS: '.peaks/**' } });
      // when: the window is read
      const out = readHarnessWindow({ location, env: {} });
      // then: peaks-loop never invents a number it did not set
      expect(out).toEqual({
        tokens: null,
        raw: undefined,
        source: null,
        optedOut: false,
        peakWritten: false,
        fileTokens: null,
        fileRaw: undefined
      });
    });
  });

  // Slice 2026-09-13-auto-compact-trigger-ownership, round 2 — provenance.
  // The window key is a shared artifact: peaks-loop writes it, the user may
  // edit it. The marker is what lets the late 1M rescue correct peaks-loop's
  // own output (breaking the self-lock) without ever overruling a human's
  // hand-set value, which the rescue would otherwise rewrite permanently.
  describe('(behavior) provenance — peaks-written vs human-set', () => {
    it('when the sync writes the window, should mark it as peaks-written in the same write', () => {
      // given: an untouched settings file
      writeSettings(existingSettings());
      // when: the sync materializes a window
      syncHarnessWindow({ location, tokens: 200_000, env: {} });
      // then: the marker records exactly what peaks-loop wrote...
      expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBe('200000');
      expect(readHarnessWindow({ location, env: {} }).peakWritten).toBe(true);
    });

    it('when the user hand-edits the window after a sync, should report it as NOT peaks-written', () => {
      // given: a window peaks-loop wrote, then changed by hand
      writeSettings({ env: { [KEY]: '200000', [HARNESS_WINDOW_WRITTEN_KEY]: '200000' } });
      expect(readHarnessWindow({ location, env: {} }).peakWritten).toBe(true);
      // when: the user takes the key over
      writeSettings({ env: { [KEY]: '300000', [HARNESS_WINDOW_WRITTEN_KEY]: '200000' } });
      // then: the marker no longer matches, so the rescue must stand down
      expect(readHarnessWindow({ location, env: {} }).peakWritten).toBe(false);
    });

    it('when a value is set with no marker at all, should report it as NOT peaks-written', () => {
      // given: a hand-authored env block (the shape the user plants themselves)
      writeSettings({ env: { [KEY]: '1000000' } });
      // then: never claim ownership of a value this code did not write
      expect(readHarnessWindow({ location, env: {} }).peakWritten).toBe(false);
    });

    it('when peaks-loop refreshes the file mid-session, should stay peaks-written on the NEXT probe (no flip back)', () => {
      // given: a running session that froze the process env at the OLD value,
      //        and a file peaks-loop has just refreshed to a raised window
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
      // given: the file holds a peaks-written window and a RUNNING session
      //        still has the previous value in its process env
      writeSettings(existingSettings());
      syncHarnessWindow({ location, tokens: 1_000_000, env: {} });
      const afterFirst = readFileSync(location.settingsPath, 'utf8');
      // when: a later probe of the SAME session syncs the same value
      const result = syncHarnessWindow({
        location,
        tokens: 1_000_000,
        env: { [KEY]: '200000' } as NodeJS.ProcessEnv
      });
      // then: no rewrite — idempotence is a property of the file, not of the
      //       process env, or every probe of a running session would rewrite a
      //       byte-identical file
      expect(result.action).toBe('unchanged');
      expect(readFileSync(location.settingsPath, 'utf8')).toBe(afterFirst);
    });
  });

  // Slice 2026-09-13-auto-compact-trigger-ownership, round 3 — B1 / A5.
  //
  // Round 2 decided whether to write by comparing the FILE against the
  // resolved window, and the resolved window was read env-first. So provenance
  // gated the 1M *bump* but never the *write*: a human hand-edited the key from
  // the 200000 peaks-loop wrote to 150000, a stale process env still said
  // 200000, and the next probe reverted the edit AND re-armed the marker — the
  // marker then authorising the rescue that raised the human's key to 1000000.
  // No human was needed for the second half: another session's stale env
  // downgraded a 1M file the same way (A5). These cases are the guard.
  describe('(behavior) B1 / A5 — a value peaks-loop did not write is never touched', () => {
    it('when a human hand-edits the window after a sync, should leave it AND its stale marker alone (B1)', () => {
      // given: peaks-loop wrote 200000, then the human re-pinned the key to
      //        150000 while the running session's env still says 200000
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
      // given: a 1M window peaks-loop rescued, and another session's stale env
      //        of 200000 still sitting in this process
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
      writeSettings({ env: { [KEY]: '300000', [HARNESS_WINDOW_WRITTEN_KEY]: '200000' } });
      // when: a sync runs
      const result = syncHarnessWindow({
        location,
        tokens: 300_000,
        env: { [KEY]: '200000' } as NodeJS.ProcessEnv
      });
      // then: unchanged, and the marker stays at the value peaks-loop actually wrote
      expect(result.action).toBe('unchanged');
      expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBe('200000');
    });

    it('when peaks-loop is still the writer, should keep updating its own value (the 1M rescue path)', () => {
      // given: peaks-loop's own 200000, stale env and all
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
      writeSettings(existingSettings());
      // when: the sync runs
      const result = syncHarnessWindow({
        location,
        tokens: 1_000_000,
        env: { [KEY]: '1000000' } as NodeJS.ProcessEnv
      });
      // then: written — an empty slot is not a human's value
      expect(result.action).toBe('written');
      expect(envBlock()[KEY]).toBe('1000000');
    });
  });

  // E1 (rid 2026-09-13-defects-e). The harness does not accept an arbitrary
  // positive integer: `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (and the
  // `autoCompactWindow` setting it shadows) is documented as a token count from
  // 100000 to 1000000, and a value outside that band is not the window the
  // harness compacts on — below the minimum it is ignored outright, above the
  // maximum it is capped at the model's own context size. peaks-loop used to
  // write ANY positive integer and believe it, so the ratio it reported divided
  // by a number the harness was not using: the same two-resolutions drift the
  // slice above exists to delete, arriving through the value's RANGE instead of
  // its source.
  //
  // Refusal, not clamping: a clamp would write a DIFFERENT number from the one
  // the probe just divided by, restoring the drift inside the single write that
  // is supposed to remove it. A refusal at least leaves the disagreement
  // reportable — and reported, see the notice assertions.
  describe('(behavior) E1 — the harness window band is 100000..1000000', () => {
    it('when the value is BELOW the harness minimum, should refuse it and report both numbers', () => {
      // given: an empty slot (so nothing but the range can be the reason)
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
      // given: the other end of the band — the `Math.min(native, override)` cap
      //        (the harness reduces any value above the model's own window, and
      //        no model's window exceeds 1000000)
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
      // given: the two values the harness DOES accept. Without this case the
      //        refusals above would be indistinguishable from a guard that
      //        rejected every number.
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
      // given: a hand-planted 2M (or a row written by a release that predates
      //        the band check) — the file, not the request, is out of range here
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

  // Slice 2026-09-13-auto-compact-trigger-ownership, round 3 — H1.
  //
  // `resolveCanonicalProjectRoot($HOME)` returns $HOME, and a fresh terminal
  // starts there, so `--project .` put the write in the user's PERSONAL
  // `~/.claude/settings.local.json` — shared by every project they own. The
  // writer refuses that root; the shared resolver is deliberately untouched.
  describe("(behavior) H1 — never write into the user's home directory", () => {
    it('when the project root IS the home directory, should skip and write nothing', () => {
      // given: a HOME-shaped target
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
      writeSettings(existingSettings());
      // when: the sync runs without a root
      const result = syncHarnessWindow({ location, tokens: 1_000_000, env: {} });
      // then: no guard fires — the optional field is opt-in
      expect(result.action).toBe('written');
    });
  });

  // Slice 2026-09-13-auto-compact-trigger-ownership, round 4 — the three
  // residuals. Two of them are the same failure: output that says something
  // the code does not do. `Harness window not managed (not-peaks-owned).` was
  // TRUE and told the reader nothing — never which two numbers had come apart,
  // never that a hand-typed `500k` could never be read at all, and never that
  // "already in force" could mean "and peaks-loop will never manage it again".
  describe('(render) T4 — a refused write must name the two numbers it left apart', () => {
    it('when the probe divided by a different window than the file pins, should name BOTH numbers and the file', () => {
      // given: a human-pinned 150000 in the file (the read's `not-peaks-owned`
      //        case) and a probe that resolved 500000 (PEAKS_CONTEXT_WINDOW_TOKENS)
      writeSettings({ env: { [KEY]: '150000' } });
      // when: the sync refuses to overwrite the human's value
      const result = syncHarnessWindow({ location, tokens: 500_000, env: {} });
      expect(result).toMatchObject({
        action: 'skipped',
        reason: 'not-peaks-owned',
        previousTokens: 150_000,
        requestedTokens: 500_000,
        peakWritten: false
      });
      // then: the human-readable notice names both numbers and the file, so a
      //       reader can say which two things disagree — the whole point of
      //       the notice, and what the old reason-token output failed at
      const notice = describeHarnessWindowSync(result);
      expect(notice).toContain('500000');
      expect(notice).toContain('150000');
      expect(notice).toContain(location.settingsPath);
      expect(notice).toContain('CONFLICT');
      expect(notice).toContain('does not describe when it fires');
      // and: it offers the three ways out, because peaks-loop will not take any
      //      of them by writing over a value it did not write
      expect(notice).toContain('PEAKS_CONTEXT_WINDOW_TOKENS');
      expect(notice).toContain('context.windowTokens');
      expect(notice).toContain('peaks compact harness-window --reset');
      // and: the machine channel carries the same disagreement, so a JSON
      //      consumer cannot read a ratio without seeing it is un-anchored
      const warning = harnessWindowSyncWarning(result);
      expect(warning).toContain('500000');
      expect(warning).toContain('150000');
      expect(warning).toContain(location.settingsPath);
    });

    it('when there is no disagreement to report, should emit NO warning (the quiet case stays quiet)', () => {
      // given: a window in force that peaks-loop wrote, and the same value asked for
      writeSettings(existingSettings());
      syncHarnessWindow({ location, tokens: 200_000, env: {} });
      // when: the probe re-syncs the identical number
      const unchanged = syncHarnessWindow({ location, tokens: 200_000, env: {} });
      // then: nothing to warn about — a probe that writes nothing and disagrees
      //       with nothing must not become noise on every tool call
      expect(unchanged.action).toBe('unchanged');
      expect(harnessWindowSyncWarning(unchanged)).toBeNull();
      // and: an absent knob is not a warning either
      expect(harnessWindowSyncWarning(null)).toBeNull();
    });

    it('when the file value is not a token count at all, should name the RAW value and say why it cannot be aligned', () => {
      // given: a hand-typed `500k` — `previousTokens` is null for this, exactly
      //        as it is for an ABSENT key, so only the raw value distinguishes
      //        "a slot we may fill" from "a value we must not touch"
      writeSettings({ env: { [KEY]: '500k' } });
      const result = syncHarnessWindow({ location, tokens: 500_000, env: {} });
      expect(result).toMatchObject({
        action: 'skipped',
        reason: 'not-peaks-owned',
        previousTokens: null,
        previousRawValue: '500k',
        requestedTokens: 500_000
      });
      // then: the notice quotes the typo, says peaks-loop fell back to its own
      //       resolution (so the two sides ARE apart), says it will not
      //       overwrite, and gives both ways out — silent here would leave the
      //       disk claiming `500k` on every probe with nobody the wiser
      const notice = describeHarnessWindowSync(result);
      expect(notice).toContain('"500k"');
      expect(notice).toContain('not a plain token count');
      expect(notice).toContain('cannot align');
      expect(notice).toContain('peaks compact harness-window --reset');
      // and: there is no numeric CONFLICT clause — there is no number to be
      //      inconsistent WITH, which is precisely why this case needed its own
      expect(notice).not.toContain('CONFLICT');
      expect(harnessWindowSyncWarning(result)).toContain('"500k"');
    });

    it('when a legacy value is in force with no marker, should say it is not peaks-loop-managed and how to hand it back', () => {
      // given: 200000 with no `PEAKS_HARNESS_WINDOW_WRITTEN` marker — the shape
      //        every project installed by a pre-round-2 release is left in,
      //        and this repository's own file
      writeSettings({ env: { [KEY]: '200000' } });
      // when: the probe asks for exactly that number
      const result = syncHarnessWindow({ location, tokens: 200_000, env: {} });
      // then: `unchanged` — but "already in force" alone would hide the fact
      //       the user most needs: peaks-loop computes against this value and
      //       will never raise it, so it is frozen for the life of the project
      expect(result.action).toBe('unchanged');
      expect(result.peakWritten).toBe(false);
      const notice = describeHarnessWindowSync(result);
      expect(notice).toContain('NOT peaks-loop');
      expect(notice).toContain('will never raise it');
      // and: the way back to management is named, in order, and it is a real
      //       path (`--reset` removes the key, `--reenable` clears the opt-out
      //       so the next probe fills it) — not a dead end
      expect(notice).toContain('peaks compact harness-window --reset');
      expect(notice).toContain('peaks compact harness-window --reenable');
      // and: no warning rides this one — the two sides AGREE here; what is
      //       newly revealed is ownership, not a disagreement
      expect(harnessWindowSyncWarning(result)).toBeNull();
    });

    it('when peaks-loop is the writer, should keep the plain "already in force" sentence', () => {
      // given: peaks-loop's own window
      writeSettings(existingSettings());
      syncHarnessWindow({ location, tokens: 200_000, env: {} });
      // when: the same number is asked for again
      const result = syncHarnessWindow({ location, tokens: 200_000, env: {} });
      // then: the short sentence stands — the ownership caveat is false here
      expect(result.peakWritten).toBe(true);
      expect(describeHarnessWindowSync(result)).toBe(
        `Harness window ${KEY} already in force; peaks-loop computes this ratio against it.`
      );
    });

    it('when a write lands, should report the file as peaks-written (the marker the write armed)', () => {
      // given: an empty slot
      writeSettings(existingSettings());
      // when: the sync fills it
      const result = syncHarnessWindow({ location, tokens: 200_000, env: {} });
      // then: `peakWritten` describes the state AFTER the call — the write is
      //       what armed the marker, so the pre-write read could only say false
      expect(result.action).toBe('written');
      expect(result.peakWritten).toBe(true);
    });
  });

  // Slice 2026-09-13-auto-compact-trigger-ownership, round 4 — residual 3(iii).
  //
  // `--reset` in the user's HOME was writing `PEAKS_HARNESS_WINDOW_SYNC: "off"`
  // into a personal settings file that held no peaks content at all: litter in
  // the user's own file, left by the command they ran to REMOVE something.
  describe('(behavior) reset — a rollback with nothing to roll back writes nothing', () => {
    it('when the file holds no peaks rows, should report absent and leave the bytes alone', () => {
      // given: a personal settings file from another tool (permissions + env),
      //        with no window key and no provenance marker
      writeSettings({
        permissions: { allow: ['Bash(git status)'] },
        env: { SOME_USER_KEY: 'keep-me' }
      });
      const before = readFileSync(location.settingsPath, 'utf8');
      // when: the user runs the rollback
      const result = resetHarnessWindow({ location, env: {} });
      // then: nothing to remove ⇒ nothing written. The old form only
      //       short-circuited when the opt-out was ALREADY recorded, so this
      //       case wrote a peaks-loop row into a file peaks-loop had never
      //       touched — which in `$HOME` is the user's own personal settings
      expect(result).toMatchObject({ action: 'absent', previousTokens: null });
      expect(readFileSync(location.settingsPath, 'utf8')).toBe(before);
      expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBeUndefined();
      expect(envBlock()['SOME_USER_KEY']).toBe('keep-me');
    });

    it('when the key is gone but the provenance marker survives, should still clean the marker up', () => {
      // given: a hand-deleted window left a marker claiming ownership of
      //        whatever the user writes into the key next
      writeSettings({ env: { [HARNESS_WINDOW_WRITTEN_KEY]: '200000' } });
      // when: the rollback runs
      const result = resetHarnessWindow({ location, env: {} });
      // then: this IS something of peaks-loop's to remove — the no-op guard is
      //       `nothing left behind`, not `no window number`
      expect(result.action).toBe('removed');
      expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBeUndefined();
      expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBe(HARNESS_WINDOW_SYNC_OPTOUT_VALUE);
    });
  });

  describe('(behavior) disable — "do not manage this key" is expressible before the first write', () => {
    it('when the project has never been written to, should record the opt-out and let a later sync write NOTHING', () => {
      // given: a FRESH project — no window key, and no provenance marker,
      //        i.e. exactly the state in which `resetHarnessWindow` is a no-op
      //        (it reports `absent` and writes nothing, by design). Before
      //        `disable` existed that no-op left the user with no command at
      //        all for "stop managing this key": the intention was only
      //        expressible AFTER a probe had written the key, i.e. the wrong
      //        order round.
      writeSettings(existingSettings());
      const before = readFileSync(location.settingsPath, 'utf8');
      // when: the user says "do not manage this key here"
      const result = disableHarnessWindowSync({ location });
      // then: the opt-out is on disk — and it did NOT touch the window key,
      //       because "stop managing" is not "remove"
      expect(result).toMatchObject({ action: 'disabled', settingsPath: location.settingsPath });
      expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBe(HARNESS_WINDOW_SYNC_OPTOUT_VALUE);
      expect(envBlock()[KEY]).toBeUndefined();
      expect(envBlock()['GATEGUARD_EXEMPT_GLOBS']).toBe('.peaks/**');
      expect(before).not.toBe(readFileSync(location.settingsPath, 'utf8'));
      // and: THE POINT — the probe that would have written the key now does not
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
      // given: the identical fresh project, without the opt-out. This is the
      //        control for the case above: without it, a probe that failed for
      //        some unrelated reason would look like the opt-out working.
      writeSettings(existingSettings());
      // when: the probe runs
      const sync = syncHarnessWindow({ location, tokens: 1_000_000, env: {} });
      // then: it writes — so the "nothing was written" above is the opt-out's
      //       doing, not a probe that never writes
      expect(sync.action).toBe('written');
      expect(envBlock()[KEY]).toBe('1000000');
    });

    it('when a value is already in force, should leave it exactly as it was', () => {
      // given: a window the user pinned by hand (no provenance marker)
      writeSettings({ env: { [KEY]: '150000' } });
      const before = readFileSync(location.settingsPath, 'utf8');
      // when: the opt-out is recorded
      const result = disableHarnessWindowSync({ location });
      // then: only the opt-out row was added — the pinned number survives, so
      //       peaks-loop never claims (or overwrites) a value it did not write
      expect(result.action).toBe('disabled');
      expect(envBlock()[KEY]).toBe('150000');
      expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBe(HARNESS_WINDOW_SYNC_OPTOUT_VALUE);
      expect(readFileSync(location.settingsPath, 'utf8').length).toBeGreaterThan(before.length);
    });

    it('when the opt-out is already recorded, should report it and rewrite nothing', () => {
      writeSettings({
        env: { [HARNESS_WINDOW_SYNC_OPTOUT_KEY]: HARNESS_WINDOW_SYNC_OPTOUT_VALUE }
      });
      const before = readFileSync(location.settingsPath, 'utf8');
      // when: the command runs a second time
      const result = disableHarnessWindowSync({ location });
      // then: idempotent, and it says so rather than pretending to have acted
      expect(result.action).toBe('already-opted-out');
      expect(readFileSync(location.settingsPath, 'utf8')).toBe(before);
    });

    it('when the settings file cannot be parsed, should report that instead of clobbering it', () => {
      // given: a file peaks-loop cannot safely edit
      mkdirSync(join(root, '.claude'), { recursive: true });
      writeFileSync(location.settingsPath, '{ not json\n', 'utf8');
      // when: the opt-out is requested
      const result = disableHarnessWindowSync({ location });
      // then: nothing is written — the honest answer is "could not record it"
      expect(result.action).toBe('unreadable-settings');
      expect(readFileSync(location.settingsPath, 'utf8')).toBe('{ not json\n');
    });

    // E4 (rid 2026-09-13-defects-e). The H1 guard above covers the WINDOW write.
    // `--disable` opened a second door onto the same hazard: `--project .` from a
    // fresh terminal resolves the root to `$HOME`, so an explicit opt-out verb
    // wrote `PEAKS_HARNESS_WINDOW_SYNC: "off"` into the user's own
    // `~/.claude/settings.local.json` — a file outside every repo peaks-loop has
    // business editing, left there by the command the user ran to say "leave me
    // alone". The two keys differ in WHAT they change (the window key changes
    // harness behaviour; the opt-out key only changes peaks-loop's), but not in
    // WHERE they land, and at `$HOME` the opt-out has no meaning to lose: the
    // window write is already refused there, so the opt-out can only turn that
    // visible refusal into a quieter one. Refusing costs the user nothing and
    // keeps the row out of their personal settings.
    it('when the project root IS the home directory, should refuse and write NO file (E4)', () => {
      // given: the fresh-terminal case — cwd is $HOME and --project defaulted to it
      writeSettings(existingSettings());
      const before = readFileSync(location.settingsPath, 'utf8');
      // when: the opt-out is requested for that root
      const result = disableHarnessWindowSync({
        location: { ...location, projectRoot: homedir() }
      });
      // then: refused, and the file is byte-identical — not even the opt-out row
      expect(result.action).toBe('refused-unsafe-project-root');
      expect(readFileSync(location.settingsPath, 'utf8')).toBe(before);
      expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBeUndefined();
    });

    it('when no file exists at the refused root, should create nothing at all (E4)', () => {
      // given: a home-rooted location whose settings file does not exist —
      //        `disableHarnessWindowSync` mkdirs the parent before writing, so
      //        "refused" must mean refused BEFORE any of that
      // when: the opt-out is requested
      const result = disableHarnessWindowSync({
        location: { ...location, projectRoot: homedir() }
      });
      // then: refused, and neither the file nor its directory was created
      expect(result.action).toBe('refused-unsafe-project-root');
      expect(existsSync(location.settingsPath)).toBe(false);
      expect(existsSync(join(root, '.claude'))).toBe(false);
    });

    it('when the project root is a SUBDIRECTORY of home, should still record the opt-out (E4 control)', () => {
      // given: ~/my-project — the ordinary project root, which is NOT home itself
      writeSettings(existingSettings());
      // when: the opt-out is requested there
      const result = disableHarnessWindowSync({
        location: { ...location, projectRoot: join(homedir(), 'my-project') }
      });
      // then: recorded — the guard is exact-home, exactly like H1's
      expect(result.action).toBe('disabled');
      expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBe(HARNESS_WINDOW_SYNC_OPTOUT_VALUE);
    });

    it('when the location carries no project root, should make no claim either way (E4 opt-in)', () => {
      // given: a caller that built its own location (root unit tests), where the
      //        optional field is genuinely absent rather than home-shaped
      writeSettings(existingSettings());
      // when: the opt-out runs without a root
      const result = disableHarnessWindowSync({ location });
      // then: no guard fires — absent is not the same claim as "is home"
      expect(result.action).toBe('disabled');
    });
  });

  describe('(integration) sync — write, idempotence, preservation', () => {
    it('when the window is not yet set, should write it and report what changed', () => {
      // given: an existing settings file with a third-party env key + 3 hooks
      writeSettings(existingSettings());
      // when: the sync materializes a 1M window
      const result = syncHarnessWindow({ location, tokens: 1_000_000, env: {} });
      // then: the write is reported with the previous value (null = was unset)
      expect(result).toMatchObject({
        action: 'written',
        key: KEY,
        tokens: 1_000_000,
        previousTokens: null,
        settingsPath: location.settingsPath
      });
      expect(envBlock()[KEY]).toBe('1000000');
    });

    it('when a settings file is rewritten, should preserve the third-party env key and all three PreToolUse hooks', () => {
      // given: the file this repo actually ships (one external env key, 3 hooks)
      const before = existingSettings();
      writeSettings(before);
      // when: the sync writes the window
      syncHarnessWindow({ location, tokens: 850_000, env: {} });
      // then: every pre-existing row survives byte-for-byte (the two peaks
      //       rows — the window and its provenance marker — are the only adds)
      const after = readSettings();
      expect(after['env']).toEqual({
        GATEGUARD_EXEMPT_GLOBS: '.peaks/**',
        [KEY]: '850000',
        [HARNESS_WINDOW_WRITTEN_KEY]: '850000'
      });
      expect(after['hooks']).toEqual(before['hooks']);
    });

    it('when the same window is synced twice, should write once (the second call is a no-op)', () => {
      // given: a synced window
      writeSettings(existingSettings());
      syncHarnessWindow({ location, tokens: 1_000_000, env: {} });
      const first = readFileSync(location.settingsPath, 'utf8');
      // when: the sync runs again with the same value
      const second = syncHarnessWindow({ location, tokens: 1_000_000, env: {} });
      // then: no second write happened — the file is byte-identical
      expect(second.action).toBe('unchanged');
      expect(second.previousTokens).toBe(1_000_000);
      expect(readFileSync(location.settingsPath, 'utf8')).toBe(first);
      expect(Object.keys(envBlock()).filter((k) => k === KEY)).toHaveLength(1);
    });

    it('when the process env already carries the value but the FILE does not, should still write the file', () => {
      // given: the key only in the process env (a shell export), no file
      writeSettings(existingSettings());
      // when: the sync runs
      const result = syncHarnessWindow({
        location,
        tokens: 1_000_000,
        env: { [KEY]: '1000000' } as NodeJS.ProcessEnv
      });
      // then: the file is written even though the read already saw the value —
      //       otherwise the value would vanish at the next session
      expect(result.action).toBe('written');
      expect(envBlock()[KEY]).toBe('1000000');
    });

    it('when no window was resolved, should skip and write nothing (no invented number)', () => {
      // given: an existing file
      writeSettings(existingSettings());
      const before = readFileSync(location.settingsPath, 'utf8');
      // when: a percent-only probe syncs (no token window in hand)
      const result = syncHarnessWindow({ location, tokens: null, env: {} });
      // then: skipped, with the reason recorded, and the file untouched
      expect(result.action).toBe('skipped');
      expect(result.reason).toBe('no-window-resolved');
      expect(readFileSync(location.settingsPath, 'utf8')).toBe(before);
    });

    it('when the settings file is not a JSON object, should skip rather than clobber it', () => {
      // given: a malformed settings file
      mkdirSync(join(root, '.claude'), { recursive: true });
      writeFileSync(location.settingsPath, '{ not json', 'utf8');
      // when: the sync runs
      const result = syncHarnessWindow({ location, tokens: 1_000_000, env: {} });
      // then: skipped, and the file is left exactly as found
      expect(result.action).toBe('skipped');
      expect(result.reason).toBe('unreadable-settings');
      expect(readFileSync(location.settingsPath, 'utf8')).toBe('{ not json');
    });

    it('when no settings file exists yet, should create the directory and the file', () => {
      // given: a project with no .claude/ directory at all
      // when: the sync runs
      const result = syncHarnessWindow({ location, tokens: 200_000, env: {} });
      // then: the file is created with the key and its provenance marker
      expect(result.action).toBe('written');
      expect(readSettings()['env']).toEqual({
        [KEY]: '200000',
        [HARNESS_WINDOW_WRITTEN_KEY]: '200000'
      });
    });
  });

  describe('(behavior) rollback — reset, opt-out, re-enable', () => {
    it('when reset runs, should remove the key AND record the opt-out in the same write', () => {
      // given: a synced window alongside the third-party env key
      writeSettings(existingSettings());
      syncHarnessWindow({ location, tokens: 1_000_000, env: {} });
      // when: the rollback runs
      const result = resetHarnessWindow({ location, env: {} });
      // then: the key AND its provenance marker are gone, the opt-out is
      //       present, the other keys survive — a marker left behind would
      //       claim ownership of whatever the user writes into the key next
      expect(result).toMatchObject({ action: 'removed', previousTokens: 1_000_000 });
      expect(envBlock()[KEY]).toBeUndefined();
      expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBeUndefined();
      expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBe(HARNESS_WINDOW_SYNC_OPTOUT_VALUE);
      expect(envBlock()['GATEGUARD_EXEMPT_GLOBS']).toBe('.peaks/**');
    });

    it('when reset has run, should make the next sync a no-op (the rollback is durable, not undone by the next probe)', () => {
      // given: a rolled-back project
      writeSettings(existingSettings());
      syncHarnessWindow({ location, tokens: 1_000_000, env: {} });
      resetHarnessWindow({ location, env: {} });
      // when: a later probe tries to sync the same window
      const result = syncHarnessWindow({ location, tokens: 1_000_000, env: {} });
      // then: skipped with `opted-out` — peaks-loop does not resurrect it
      expect(result.action).toBe('skipped');
      expect(result.reason).toBe('opted-out');
      expect(envBlock()[KEY]).toBeUndefined();
      expect(readHarnessWindow({ location, env: {} }).optedOut).toBe(true);
    });

    it('when reset runs twice, should report absent the second time and not rewrite the file', () => {
      // given: a project peaks-loop HAS written to — the removal has to be real
      //        for the second call to be testing idempotence, and round 4 made
      //        an untouched file a no-op (see the suite above), so seeding the
      //        window is what keeps this case about the second call
      writeSettings(existingSettings());
      syncHarnessWindow({ location, tokens: 1_000_000, env: {} });
      const first = resetHarnessWindow({ location, env: {} });
      expect(first.action).toBe('removed');
      const after = readFileSync(location.settingsPath, 'utf8');
      // when: the rollback runs again
      const second = resetHarnessWindow({ location, env: {} });
      // then: idempotent
      expect(second.action).toBe('absent');
      expect(readFileSync(location.settingsPath, 'utf8')).toBe(after);
    });

    it('when re-enable runs, should clear the opt-out and let the next sync write again', () => {
      // given: a rolled-back project
      writeSettings(existingSettings());
      syncHarnessWindow({ location, tokens: 1_000_000, env: {} });
      resetHarnessWindow({ location, env: {} });
      // when: the user re-enables management
      const reenabled = reenableHarnessWindowSync({ location });
      // then: the flag is gone and the next sync writes
      expect(reenabled.action).toBe('reenabled');
      expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBeUndefined();
      expect(syncHarnessWindow({ location, tokens: 1_000_000, env: {} }).action).toBe('written');
      // and: re-enabling again is a no-op
      expect(reenableHarnessWindowSync({ location }).action).toBe('absent');
    });
  });
});

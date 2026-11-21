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

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  HARNESS_WINDOW_SYNC_OPTOUT_KEY,
  HARNESS_WINDOW_SYNC_OPTOUT_VALUE,
  HARNESS_WINDOW_WRITTEN_KEY,
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
      // when: both sides carry a value
      // then: let the PROCESS ENV win (it is what the running session captured)
      writeSettings({ env: { [KEY]: '200000' } });
      // when: the window is read
      const out = readHarnessWindow({ location, env: { [KEY]: '1000000' } });
      // then: the process env (this session) wins, and the file is reported as the source only when env is silent
      expect(out).toEqual({
        tokens: 1_000_000,
        source: 'process-env',
        optedOut: false,
        peakWritten: false,
        // ...while the FILE's own value is reported separately: it is the one
        // the ratio divides by (see resolveHarnessRatioWindow), because the env
        // copy is a snapshot the harness froze at session start. Both sides are
        // bounded NOTES, never the raw text (MED-2).
        fileTokens: 200_000,
        rawNote: 'the number 1000000',
        fileRawNote: 'the number 200000'
      });
    });

    it('when only the file carries a value, should report it as settings-file and tolerate an unparseable one without throwing', () => {
      // given: a settings file with a plain token count
      // when: only the file carries a value
      // then: report it as settings-file and tolerate an unparseable one without throwing
      writeSettings({ env: { [KEY]: '850000' } });
      // when: the window is read with an empty process env
      const out = readHarnessWindow({ location, env: {} });
      // then: the file wins, source is settings-file
      expect(out).toEqual({
        tokens: 850_000,
        source: 'settings-file',
        optedOut: false,
        peakWritten: false,
        fileTokens: 850_000,
        rawNote: 'the number 850000',
        fileRawNote: 'the number 850000'
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
      // when: neither side carries the key
      // then: report a null window rather than a default
      writeSettings({ env: { GATEGUARD_EXEMPT_GLOBS: '.peaks/**' } });
      // when: the window is read
      const out = readHarnessWindow({ location, env: {} });
      // then: peaks-loop never invents a number it did not set
      expect(out).toEqual({
        tokens: null,
        source: null,
        optedOut: false,
        peakWritten: false,
        fileTokens: null
      });
    });
  });

  // Slice 2026-09-13-auto-compact-trigger-ownership, round 2 — provenance.
  // The window key is a shared artifact: peaks-loop writes it, the user may
  // edit it. The marker is what lets the late 1M rescue correct peaks-loop's
  // own output (breaking the self-lock) without ever overruling a human's
  // hand-set value, which the rescue would otherwise rewrite permanently.

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

  // Slice 2026-09-13-auto-compact-trigger-ownership, round 3 — H1.
  //
  // `resolveCanonicalProjectRoot($HOME)` returns $HOME, and a fresh terminal
  // starts there, so `--project .` put the write in the user's PERSONAL
  // `~/.claude/settings.local.json` — shared by every project they own. The
  // writer refuses that root; the shared resolver is deliberately untouched.

  // Slice 2026-09-13-auto-compact-trigger-ownership, round 4 — the three
  // residuals. Two of them are the same failure: output that says something
  // the code does not do. `Harness window not managed (not-peaks-owned).` was
  // TRUE and told the reader nothing — never which two numbers had come apart,
  // never that a hand-typed `500k` could never be read at all, and never that
  // "already in force" could mean "and peaks-loop will never manage it again".

  // Slice 2026-09-13-auto-compact-trigger-ownership, round 4 — residual 3(iii).
  //
  // `--reset` in the user's HOME was writing `PEAKS_HARNESS_WINDOW_SYNC: "off"`
  // into a personal settings file that held no peaks content at all: litter in
  // the user's own file, left by the command they ran to REMOVE something.
  describe('(behavior) reset — a rollback with nothing to roll back writes nothing', () => {
    it('when the file holds no peaks rows, should report absent and leave the bytes alone', () => {
      // given: a personal settings file from another tool (permissions + env), with no window key and no provenance marker
      // when: the file holds no peaks rows
      // then: report absent and leave the bytes alone
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
      // given: a hand-deleted window left a marker claiming ownership of whatever the user writes into the key next
      // when: the key is gone but the provenance marker survives
      // then: still clean the marker up
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

  describe('(integration) sync — write, idempotence, preservation', () => {
    it('when the window is not yet set, should write it and report what changed', () => {
      // given: an existing settings file with a third-party env key + 3 hooks
      // when: the window is not yet set
      // then: write it and report what changed
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
      // when: a settings file is rewritten
      // then: preserve the third-party env key and all three PreToolUse hooks
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
      // when: the same window is synced twice
      // then: write once (the second call is a no-op)
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
      // when: the process env already carries the value but the FILE does not
      // then: still write the file
      writeSettings(existingSettings());
      // when: the sync runs
      const result = syncHarnessWindow({
        location,
        tokens: 1_000_000,
        env: { [KEY]: '1000000' }
      });
      // then: the file is written even though the read already saw the value —
      //       otherwise the value would vanish at the next session
      expect(result.action).toBe('written');
      expect(envBlock()[KEY]).toBe('1000000');
    });

    it('when no window was resolved, should skip and write nothing (no invented number)', () => {
      // given: an existing file
      // when: no window was resolved
      // then: skip and write nothing (no invented number)
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
      // when: the settings file is not a JSON object
      // then: skip rather than clobber it
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
      // given: a project with no .claude/ directory at all when: the sync runs
      // when: no settings file exists yet
      // then: create the directory and the file
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
      // when: reset runs
      // then: remove the key AND record the opt-out in the same write
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
      // when: reset has run
      // then: make the next sync a no-op (the rollback is durable, not undone by the next probe)
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
      // given: a project peaks-loop HAS written to — the removal has to be real for the second call to be testing idempotence, and round 4 made an untouched file a no-op (see the suite above), so seeding the window is what keeps this case about the second call
      // when: reset runs twice
      // then: report absent the second time and not rewrite the file
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
      // when: re-enable runs
      // then: clear the opt-out and let the next sync write again
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

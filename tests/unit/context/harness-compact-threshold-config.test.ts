// tests/unit/context/harness-compact-threshold-config.test.ts
//
// 4-dimension unit test for the harness auto-compact THRESHOLD pair:
//   - src/services/context/harness-compact-threshold-config.ts  (write half)
//   - src/services/context/harness-compact-threshold-ensure.ts   (reconcile)
//   - src/services/context/harness-compact-threshold-verdict.ts  (read half)
//
// The property under test is what makes "install peaks-loop → early compaction
// works in that project" true: a fresh downstream project's OWN
// `.claude/settings.local.json` ends up carrying BOTH the window and the
// percent, a human's pin in either key is never overwritten, and the running
// session's disagreement with the file is REPORTED (the harness reads its env
// once, at process start, so a mid-session write cannot take effect).
//
// Dimensions covered:
//   - render:      result shapes + action enums + the sentences
//   - behavior:    defaults, idempotence, provenance, band, opt-out, verdict
//   - integration: real fs read-modify-write, sibling keys preserved
//   - a11y:        the sentences (the only user-visible surface here)
//
// Run with: pnpm vitest run tests/unit/context/harness-compact-threshold-config.test.ts

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  DEFAULT_HARNESS_COMPACT_PERCENT,
  DEFAULT_HARNESS_COMPACT_WINDOW_TOKENS,
  HARNESS_PERCENT_WRITTEN_KEY,
  parseHarnessCompactPercent,
  syncHarnessPercent,
  type HarnessCompactThresholdLocation
} from '~/src/services/context/harness-compact-threshold-config';
import {
  describeHarnessCompactThreshold,
  ensureHarnessCompactThreshold
} from '~/src/services/context/harness-compact-threshold-ensure';
import { HARNESS_WINDOW_SYNC_OPTOUT_KEY } from '~/src/services/context/harness-window-config';
import { _resetAdaptersForTesting } from '~/src/services/ide/ide-registry';

declareDimensions('tests/unit/context/harness-compact-threshold-config.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const WINDOW_KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';
const PERCENT_KEY = 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE';

describe('harness-compact-threshold', () => {
  let root = '';
  let location: HarnessCompactThresholdLocation = {
    settingsPath: '',
    envVar: WINDOW_KEY,
    percentEnvVar: PERCENT_KEY
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-harness-threshold-'));
    location = {
      settingsPath: join(root, '.claude', 'settings.local.json'),
      envVar: WINDOW_KEY,
      percentEnvVar: PERCENT_KEY,
      // The ordinary project root. Explicit so the home guard is a deliberate
      // `false` rather than an accident of which temp dir the host picked.
      projectRoot: root
    };
  });

  afterEach(() => {
    _resetAdaptersForTesting();
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

  /** A settings file with a third-party env key, so "preserved" is testable. */
  function existingSettings(): Record<string, unknown> {
    return { env: { GATEGUARD_EXEMPT_GLOBS: '.peaks/**' } };
  }

  describe('(behavior) parseHarnessCompactPercent — whole 1..100 only', () => {
    it('when a candidate percent is parsed, should accept only whole integers in 1..100', () => {
      // given: the shapes an env block or a process env can carry
      // when: the parser runs
      // then: in-band integers pass and every out-of-band shape is null
      expect(parseHarnessCompactPercent(80)).toBe(80);
      expect(parseHarnessCompactPercent('80')).toBe(80);
      expect(parseHarnessCompactPercent(' 1 ')).toBe(1);
      expect(parseHarnessCompactPercent(100)).toBe(100);
      for (const bad of [
        '0',
        '101',
        '80.5',
        '1.5',
        '-1',
        'abc',
        '',
        '  ',
        null,
        undefined,
        {},
        []
      ]) {
        expect(parseHarnessCompactPercent(bad)).toBeNull();
      }
    });

    it('N7: should refuse scientific and float spellings of an in-band number', () => {
      // given: `8e1`, `80.0`, `+80` — all evaluate to 80 under Number()
      // when: the parser runs
      // then: none is accepted. peaks-loop writes `String(n)` → `80` and only
      //       reads that back, so a value it cannot have written is reported as
      //       unreadable rather than silently treated as its own output. The
      //       chain that makes this matter: an accepted `80.0` would compare
      //       equal to a marker of `80`, so peaks-loop would claim ownership of
      //       text it never wrote and would then be free to overwrite it.
      for (const spelling of ['8e1', '80.0', '80.00', '+80', '0x50']) {
        expect(parseHarnessCompactPercent(spelling)).toBeNull();
      }
      // and: surrounding whitespace is still trimmed, and the plain upward
      //      control really is accepted — so this is not a parser that refuses
      //      everything
      expect(parseHarnessCompactPercent(' 80 ')).toBe(80);
      expect(parseHarnessCompactPercent('80')).toBe(80);
    });
  });

  describe('(integration) ensure — the install path writes BOTH knobs', () => {
    it('when a fresh project has no keys, should write the 1000000 window and the 80 percent defaults', () => {
      // given: a project whose settings file does not exist yet
      // when: init reconciles the threshold
      // then: both defaults landed, each with its own provenance marker
      const result = ensureHarnessCompactThreshold({ location, env: {} });
      expect(result.window.action).toBe('written');
      expect(result.percent.action).toBe('written');
      expect(envBlock()).toEqual({
        [WINDOW_KEY]: '1000000',
        PEAKS_HARNESS_WINDOW_WRITTEN: '1000000',
        [PERCENT_KEY]: '80',
        [HARNESS_PERCENT_WRITTEN_KEY]: '80'
      });
      // and: the named constants are the values, not literals re-typed here
      expect(envBlock()[WINDOW_KEY]).toBe(String(DEFAULT_HARNESS_COMPACT_WINDOW_TOKENS));
      expect(envBlock()[PERCENT_KEY]).toBe(String(DEFAULT_HARNESS_COMPACT_PERCENT));
    });

    it('when the same values are reconciled twice, should write once (idempotent)', () => {
      // given: a project already configured by the first run
      // when: init runs again with the same (omitted) values
      // then: neither half rewrote the file
      ensureHarnessCompactThreshold({ location, env: {} });
      const first = readFileSync(location.settingsPath, 'utf8');
      const second = ensureHarnessCompactThreshold({ location, env: {} });
      expect(second.window.action).toBe('unchanged');
      expect(second.percent.action).toBe('unchanged');
      expect(readFileSync(location.settingsPath, 'utf8')).toBe(first);
    });

    it('when the file already holds a peaks-written window, should NOT overwrite it with the default', () => {
      // given: a 500K window an earlier probe wrote — deliberately NOT the
      //        current default, so "unchanged" proves a default fills EMPTY slots
      // when: init reconciles with no explicit window
      // then: the existing value stands
      writeSettings({
        env: { [WINDOW_KEY]: '500000', PEAKS_HARNESS_WINDOW_WRITTEN: '500000' }
      });
      const result = ensureHarnessCompactThreshold({ location, env: {} });
      expect(result.window.action).toBe('unchanged');
      expect(envBlock()[WINDOW_KEY]).toBe('500000');
      // and: the percent slot, being empty, is still filled
      expect(result.percent.action).toBe('written');
      expect(envBlock()[PERCENT_KEY]).toBe('80');
    });

    it('when a human has pinned a DIFFERENT percent, should keep it and leave the bytes alone', () => {
      // given: a hand-set percent with no peaks marker
      // when: init reconciles with a window but no explicit percent
      // then: the human's 65 IS the configured value, so "already in force" is
      //       the honest answer — init has no measurement to justify a rewrite
      writeSettings({ env: { [PERCENT_KEY]: '65' } });
      const result = ensureHarnessCompactThreshold({ location, env: {}, windowTokens: 500_000 });
      expect(result.percent.action).toBe('unchanged');
      expect(envBlock()[PERCENT_KEY]).toBe('65');
      expect(envBlock()[HARNESS_PERCENT_WRITTEN_KEY]).toBeUndefined();
      // and: the window half is unrelated and still written
      expect(result.window.action).toBe('written');
      expect(envBlock()[WINDOW_KEY]).toBe('500000');
    });

    it('when a MEASURED percent disagrees with a human pin, should refuse to overwrite it', () => {
      // given: a hand-set 65 with no peaks marker, and a caller with a new value
      // when: a probe explicitly asks for 80
      // then: the human's value stands, reported rather than silently replaced
      writeSettings({ env: { [PERCENT_KEY]: '65' } });
      const result = ensureHarnessCompactThreshold({ location, env: {}, percent: 80 });
      expect(result.percent.action).toBe('skipped');
      expect(result.percent.reason).toBe('not-peaks-owned');
      expect(envBlock()[PERCENT_KEY]).toBe('65');
      expect(describeHarnessCompactThreshold(result)).toContain('never overwrites');
    });

    it('when a percent is out of band, should REFUSE it rather than clamp', () => {
      // given: an empty slot beside a third-party env key
      // when: 101 is asked for
      // then: nothing was written, the refusal names the band, siblings survive
      writeSettings(existingSettings());
      const result = ensureHarnessCompactThreshold({ location, env: {}, percent: 101 });
      expect(result.percent.action).toBe('skipped');
      expect(result.percent.reason).toBe('out-of-range');
      expect(envBlock()[PERCENT_KEY]).toBeUndefined();
      expect(describeHarnessCompactThreshold(result)).toContain('1..100');
      expect(envBlock()['GATEGUARD_EXEMPT_GLOBS']).toBe('.peaks/**');
    });

    it('when the project root IS the home directory, should refuse BOTH halves and write nothing', () => {
      // given: `--project .` from a fresh terminal, against the REAL homedir
      // when: init reconciles for that root
      // then: neither knob was written, and each says why
      writeSettings(existingSettings());
      const before = readFileSync(location.settingsPath, 'utf8');
      const result = ensureHarnessCompactThreshold({
        location: { ...location, projectRoot: homedir() },
        env: {}
      });
      expect(result.window.reason).toBe('unsafe-project-root');
      expect(result.percent.reason).toBe('unsafe-project-root');
      expect(readFileSync(location.settingsPath, 'utf8')).toBe(before);
    });

    it('when the settings file cannot be parsed, should report unreadable and not throw', () => {
      // given: a file peaks-loop cannot edit
      // when: init reconciles
      // then: reported, not thrown — an init must not abort on a third-party file
      mkdirSync(join(root, '.claude'), { recursive: true });
      writeFileSync(location.settingsPath, '{ not json\n', 'utf8');
      const result = ensureHarnessCompactThreshold({ location, env: {} });
      expect(result.percent.reason).toBe('unreadable-settings');
      expect(result.window.reason).toBe('unreadable-settings');
      expect(readFileSync(location.settingsPath, 'utf8')).toBe('{ not json\n');
      expect(describeHarnessCompactThreshold(result)).toContain('not a JSON object');
    });

    it('when the project opted out with --reset, should not resurrect either knob', () => {
      // given: a rolled-back project
      // when: init reconciles
      // then: both halves stand down, because one rollback covers the pair
      writeSettings({ env: { [HARNESS_WINDOW_SYNC_OPTOUT_KEY]: 'off' } });
      const result = ensureHarnessCompactThreshold({ location, env: {} });
      expect(result.window.reason).toBe('opted-out');
      expect(result.percent.reason).toBe('opted-out');
      expect(envBlock()[PERCENT_KEY]).toBeUndefined();
    });
  });

  describe('(behavior) syncHarnessPercent — provenance and idempotence', () => {
    it('when peaks-loop wrote the percent, should allow a later deliberate change with the marker', () => {
      // given: peaks-loop's own 80
      // when: a measured configuration asks for 70
      // then: written, and the marker moved WITH the value
      syncHarnessPercent({ location, percent: 80 });
      const result = syncHarnessPercent({ location, percent: 70 });
      expect(result).toMatchObject({ action: 'written', percent: 70 });
      expect(envBlock()[HARNESS_PERCENT_WRITTEN_KEY]).toBe('70');
    });

    it('when the value on disk is a typo peaks-loop did not write, should refuse it', () => {
      // given: a hand-typed `eighty`
      // when: a sync wants 80
      // then: the typo stands, and the caller is told why
      writeSettings({ env: { [PERCENT_KEY]: 'eighty' } });
      const result = syncHarnessPercent({ location, percent: 80 });
      expect(result).toMatchObject({
        action: 'skipped',
        reason: 'not-peaks-owned',
        previousRawNote: 'a value that is not a number (6 chars, not echoed here)'
      });
      expect(envBlock()[PERCENT_KEY]).toBe('eighty');
    });

    it('when a typo sits beside a marker peaks-loop wrote, should still REFUSE to overwrite it', () => {
      // given: `eighty` with a surviving peaks marker — the shape the rollback
      //        calls `peaks-corrupt` and REMOVES under `--reset`
      // when: a probe wants 80
      // then: the WRITER refuses, because removing a value on the user's explicit
      //       request and silently replacing it from a background probe are
      //       different acts. If the writer shared the rollback's wider rule, an
      //       ordinary probe would erase the user's evidence of what went wrong.
      writeSettings({ env: { [PERCENT_KEY]: 'eighty', [HARNESS_PERCENT_WRITTEN_KEY]: '80' } });
      const result = syncHarnessPercent({ location, percent: 80 });
      expect(result).toMatchObject({ action: 'skipped', reason: 'not-peaks-owned' });
      expect(envBlock()[PERCENT_KEY]).toBe('eighty');
    });

    it('when peaks-loop owns the value and it parses, should permit the writer', () => {
      // given: peaks-loop's own 80 with a matching marker — the control for the
      //        case above, so "refuse" is not simply the writer refusing always
      // when: a probe wants 70
      // then: written, and the marker moves with the value
      writeSettings({ env: { [PERCENT_KEY]: '80', [HARNESS_PERCENT_WRITTEN_KEY]: '80' } });
      const result = syncHarnessPercent({ location, percent: 70 });
      expect(result).toMatchObject({ action: 'written', peakWritten: true });
      expect(envBlock()[PERCENT_KEY]).toBe('70');
    });

    it('N5: when the window is written beside an unusable percent, should announce BOTH facts', () => {
      // given: the EXACT fixture QA measured — the file holds `150` as the
      //        percent (out of band), and the window slot is empty
      // when: init reconciles, writing a 1000000 window and refusing the percent
      // then: the notice announces the window write AND the percent refusal. The
      //       window write used to be swallowed by the percent half's outcome,
      //       so a 1000000 window landed with the notice naming only `150`.
      writeSettings({ env: { [PERCENT_KEY]: '150' } });
      const result = ensureHarnessCompactThreshold({ location, env: {} });
      expect(result.window.action).toBe('written');
      expect(envBlock()[WINDOW_KEY]).toBe('1000000');
      expect(result.percent.action).toBe('skipped');
      const sentence = describeHarnessCompactThreshold(result);
      expect(sentence).toContain(`WROTE ${WINDOW_KEY}=1000000`);
      expect(sentence).toContain('150');
      // and: 150 IS a percentage — the notice must say it is out of band, not
      //      that it is unparseable, or the user is handed the wrong remedy
      expect(sentence).toContain('outside the 1..100 percent');
      expect(sentence).not.toContain('which is not a percentage');
      // and: two news items, two sentences — never a run-on
      expect(sentence).toMatch(/\. Harness threshold not managed/);
      expect(sentence).toContain(location.settingsPath);
    });

    it('N5: when the window is written beside a HUMAN pin, should announce the window and not claim the pin', () => {
      // given: a hand-set 65 percent, empty window — the R3 control that must
      //        keep holding now that the window clause is unconditional
      // when: init reconciles
      // then: the window write is named, and nothing claims the percent moved
      writeSettings({ env: { [PERCENT_KEY]: '65' } });
      const sentence = describeHarnessCompactThreshold(
        ensureHarnessCompactThreshold({ location, env: {} })
      );
      expect(sentence).toContain(`WROTE ${WINDOW_KEY}=1000000`);
      expect(sentence).not.toContain(`WROTE ${PERCENT_KEY}`);
      expect(envBlock()[PERCENT_KEY]).toBe('65');
    });

    it('when the on-disk typo is reported through ensure, should name the typo not "no-percent-resolved"', () => {
      // given: a project whose percent slot holds `eighty` and nothing else
      // when: init reconciles with no explicit percent (there is no number to
      //       read, so the resolve step yields null)
      // then: the reason names the unreadable value, and the sentence quotes it
      //       — `no-percent-resolved` describes an EMPTY slot and would send the
      //       user looking for an argument they never passed
      writeSettings({ env: { [PERCENT_KEY]: 'eighty' } });
      const result = ensureHarnessCompactThreshold({ location, env: {} });
      expect(result.percent.reason).toBe('unreadable-percent');
      expect(envBlock()[PERCENT_KEY]).toBe('eighty');
      const sentence = describeHarnessCompactThreshold(result);
      // BOUNDED (MED-2): the sentence says the slot holds something unreadable
      // and how long it is, never the content.
      expect(sentence).toContain('not echoed here');
      expect(sentence).not.toContain('eighty');
      expect(sentence).toContain('not a percentage');
    });

    it('when the caller asks for no percent on this call, should treat null as "do not manage"', () => {
      // given: an empty slot
      // when: the caller passes null explicitly
      // then: nothing is invented
      writeSettings(existingSettings());
      const result = syncHarnessPercent({ location, percent: null });
      expect(result.reason).toBe('no-percent-resolved');
      expect(envBlock()[PERCENT_KEY]).toBeUndefined();
    });

    it('when the percent is written, should leave every other top-level key and env row intact', () => {
      // given: a file with a third-party env row AND a `hooks` block
      // when: a percent is synced
      // then: only the two peaks rows moved. This is a read-modify-write of
      //       one env block; a spread that dropped `settings` (or replaced it
      //       with `{}`) would erase the user's hooks on every probe.
      writeSettings({
        hooks: { PreToolUse: [] },
        env: { GATEGUARD_EXEMPT_GLOBS: '.peaks/**' }
      });
      syncHarnessPercent({ location, percent: 80 });
      const after = JSON.parse(readFileSync(location.settingsPath, 'utf8')) as {
        hooks?: unknown;
        env?: Record<string, unknown>;
      };
      expect(after.hooks).toEqual({ PreToolUse: [] });
      expect(after.env).toEqual({
        GATEGUARD_EXEMPT_GLOBS: '.peaks/**',
        [PERCENT_KEY]: '80',
        [HARNESS_PERCENT_WRITTEN_KEY]: '80'
      });
    });

    it('when the write lands, should end the file with exactly one newline and re-arm the marker', () => {
      // given: an empty slot in a directory that does not exist yet
      // when: the percent is written
      // then: the bytes end in `}\n` and no more, and the result claims
      //       ownership. The trailing newline is the file convention both
      //       writers share, so a re-run diff stays empty; `peakWritten: true`
      //       describes the file AFTER the call, which this call armed.
      const result = syncHarnessPercent({ location, percent: 80 });
      const bytes = readFileSync(location.settingsPath, 'utf8');
      expect(bytes.endsWith('}\n')).toBe(true);
      expect(bytes.endsWith('}\n\n')).toBe(false);
      expect(result).toMatchObject({ action: 'written', peakWritten: true, percent: 80 });
    });

    it('when the settings directory already exists, should still write into it', () => {
      // given: `<root>/.claude` created up front, so the `mkdir` is skipped
      // when: the percent is written
      // then: the file lands. The existence check must not invert — `!existsSync`
      //       guarding a `recursive: true` mkdir is the shape that works on
      //       both a fresh directory and an existing one.
      mkdirSync(join(root, '.claude'), { recursive: true });
      expect(syncHarnessPercent({ location, percent: 80 }).action).toBe('written');
      expect(envBlock()[PERCENT_KEY]).toBe('80');
    });

    it('when the settings file already carries rows, should keep them and add the peaks pair', () => {
      // given: a file with an unrelated env row and no peaks marker yet
      // when: the percent is written over the existing file
      // then: the row survives AND the file's existing top-level shape is
      //       carried over. This is the read-modify-write, not a fresh file:
      //       a write that started from `{}` (instead of the parsed settings)
      //       would drop everything the user had.
      writeSettings({ env: { SOME_USER_KEY: 'keep-me' }, model: 'opus' });
      syncHarnessPercent({ location, percent: 80 });
      const after = JSON.parse(readFileSync(location.settingsPath, 'utf8')) as {
        model?: unknown;
        env?: Record<string, unknown>;
      };
      expect(after.model).toBe('opus');
      expect(after.env).toMatchObject({ SOME_USER_KEY: 'keep-me', [PERCENT_KEY]: '80' });
    });

    it('when the settings file is a LINK, should refuse the write and leave the target untouched', () => {
      // given: `.claude/settings.local.json` is a link (or junction) to a file
      //        outside it — `writeFileSync` would follow it and rewrite the victim
      // when: the percent sync runs
      // then: its OWN reason (the file parses; where the bytes land is the issue),
      //       and the target is byte-identical
      const victim = join(root, 'victim.json');
      writeFileSync(victim, '{"env":{"DO_NOT_TOUCH":"yes"}}\n', 'utf8');
      mkdirSync(join(root, '.claude'), { recursive: true });
      try {
        symlinkSync(victim, location.settingsPath, 'file');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EPERM' && code !== 'EACCES' && code !== 'UNKNOWN') throw error;
        symlinkSync(victim, location.settingsPath, 'junction');
      }
      // the fixture really is a link, so this test cannot pass on a plain file
      expect(lstatSync(location.settingsPath).isSymbolicLink()).toBe(true);
      const before = readFileSync(victim, 'utf8');
      const result = syncHarnessPercent({ location, percent: 80 });
      expect(result.action).toBe('skipped');
      expect(result.reason).toBe('symlinked-settings');
      expect(readFileSync(victim, 'utf8')).toBe(before);
    });

    it('when the settings file is ABSENT, should still write — a missing path is not a link', () => {
      // given: no settings file at all (the ordinary first write)
      // when: the percent sync runs
      // then: it writes — lstat's ENOENT is "not a link", not a refusal
      expect(existsSync(location.settingsPath)).toBe(false);
      const result = syncHarnessPercent({ location, percent: 80 });
      expect(result.action).toBe('written');
      expect(envBlock()[PERCENT_KEY]).toBe('80');
    });
  });
});

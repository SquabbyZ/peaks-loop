// tests/unit/context/harness-compact-threshold-reset.test.ts
//
// The DOCUMENTED ROLLBACK must actually roll back the PAIR.
//
// `peaks compact harness-window --reset` is the rollback a user is told to run
// when peaks-loop's own threshold misfires. Before this module it removed the
// window key only, so `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` and its provenance
// marker survived: on a 1M model the harness then compacted at 800,000 instead
// of 987,000 — the rollback moved the threshold EARLIER while the opt-out row
// claimed peaks-loop had stopped managing anything.
//
// The property under test: reset removes a percent PEAKS-LOOP WROTE (file value
// === marker), and never touches one a human set.
//
// Dimensions covered:
//   - render:      the reset result shape + the sentence
//   - behavior:    owned / human / typo / absent ownership decisions
//   - integration: the real settings file, and a re-run of the install path
//                  proving the removal is durable
//   - a11y:        the sentence names both knobs and the rollback's undo

import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  HARNESS_PERCENT_WRITTEN_KEY,
  type HarnessCompactThresholdLocation
} from '~/src/services/context/harness-compact-threshold-config';
import {
  describeHarnessCompactThreshold,
  ensureHarnessCompactThreshold
} from '~/src/services/context/harness-compact-threshold-ensure';
import {
  describeHarnessThresholdReset,
  resetHarnessThreshold
} from '~/src/services/context/harness-compact-threshold-reset';
import {
  HARNESS_WINDOW_SYNC_OPTOUT_KEY,
  HARNESS_WINDOW_WRITTEN_KEY
} from '~/src/services/context/harness-window-config';

declareDimensions('tests/unit/context/harness-compact-threshold-reset.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const WINDOW_KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';
const PERCENT_KEY = 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE';

describe('harness-compact-threshold — the reset path covers the PAIR', () => {
  let root = '';
  let location: HarnessCompactThresholdLocation;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-threshold-reset-'));
    location = {
      settingsPath: join(root, '.claude', 'settings.local.json'),
      envVar: WINDOW_KEY,
      percentEnvVar: PERCENT_KEY,
      projectRoot: root
    };
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

  /**
   * `envBlock()` with one key REPLACED, typed as an open record so a computed
   * key (the provenance marker constant) can be deleted from it. Spread of a
   * `Record<string, unknown>` into an object literal infers `{ [x: string]:
   * unknown }`, which `delete withHuman[MARKER]` needs — indexing a literal
   * type by an expression was TS7053 (ceiling 0).
   */
  function envWith(key: string, value: unknown): Record<string, unknown> {
    return { ...envBlock(), [key]: value };
  }

  describe('(behavior) ownership decides what the rollback may remove', () => {
    it('when peaks-loop wrote the percent, should remove it, its marker, and opt out in one write', () => {
      // given: the pair peaks-loop installed (window + percent + both markers)
      // when: the documented rollback runs
      // then: BOTH knobs are gone and the opt-out is durable
      ensureHarnessCompactThreshold({ location, env: {} });
      resetHarnessThreshold({ thresholdLocation: location });
      expect(envBlock()[PERCENT_KEY]).toBeUndefined();
      expect(envBlock()[HARNESS_PERCENT_WRITTEN_KEY]).toBeUndefined();
      expect(envBlock()[WINDOW_KEY]).toBeUndefined();
      expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBeUndefined();
      expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBe('off');
    });

    it('when a HUMAN set the percent, should leave it exactly as it was', () => {
      // given: a hand-set 65 with no peaks marker, beside a peaks window
      // when: the rollback runs
      // then: the human's value survives — "remove what you wrote" is not
      //       "remove what I set", and a removed human pin cannot be recovered
      ensureHarnessCompactThreshold({ location, env: {}, windowTokens: 250_000 });
      const withHuman = envWith(PERCENT_KEY, '65');
      delete withHuman[HARNESS_PERCENT_WRITTEN_KEY];
      writeSettings({ env: withHuman });
      const result = resetHarnessThreshold({ thresholdLocation: location });
      expect(result.percent.action).toBe('kept-human');
      expect(envBlock()[PERCENT_KEY]).toBe('65');
      expect(envBlock()[HARNESS_PERCENT_WRITTEN_KEY]).toBeUndefined();
      // and: the window half, which peaks-loop DID write, is still removed
      expect(envBlock()[WINDOW_KEY]).toBeUndefined();
    });

    it('when the value on disk no longer matches its marker, should treat it as taken over by a human', () => {
      // given: peaks-loop wrote 80, a human then edited the value to 70
      // when: the rollback runs
      // then: 70 is a human setting and survives
      writeSettings({
        env: { [PERCENT_KEY]: '70', [HARNESS_PERCENT_WRITTEN_KEY]: '80' }
      });
      const result = resetHarnessThreshold({ thresholdLocation: location });
      expect(result.percent.action).toBe('kept-human');
      expect(envBlock()[PERCENT_KEY]).toBe('70');
    });

    it('when the file carries no peaks row, should write nothing at all', () => {
      // given: another tool's settings file
      // when: the rollback runs
      // then: byte-identical — the $HOME litter guard still holds
      writeSettings({ env: { SOME_USER_KEY: 'keep-me' } });
      const before = readFileSync(location.settingsPath, 'utf8');
      const result = resetHarnessThreshold({ thresholdLocation: location });
      expect(result.percent.action).toBe('absent');
      expect(readFileSync(location.settingsPath, 'utf8')).toBe(before);
    });

    it('when only a peaks-owned percent is left, should still record the opt-out', () => {
      // given: the window was deleted by hand, the percent and marker remain
      // when: the rollback runs
      // then: the percent is gone AND the opt-out is durable — otherwise the
      //       next init would re-add it and the rollback would last one command
      writeSettings({ env: { [PERCENT_KEY]: '80', [HARNESS_PERCENT_WRITTEN_KEY]: '80' } });
      resetHarnessThreshold({ thresholdLocation: location });
      expect(envBlock()[PERCENT_KEY]).toBeUndefined();
      expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBe('off');
      const after = ensureHarnessCompactThreshold({ location, env: {} });
      expect(after.percent.reason).toBe('opted-out');
      expect(envBlock()[PERCENT_KEY]).toBeUndefined();
    });

    it('N3: when the init notice says `--reset` clears a typo, should actually clear it', () => {
      // given: the EXACT fixture QA measured — a peaks-written percent whose
      //        value was then corrupted to `eighty`, marker left at 80, no window
      // when: init sees an unreadable percent, tells the user to run `--reset`,
      //       and that rollback then runs
      // then: both are gone, and the recovery survives a later init
      writeSettings({ env: { [PERCENT_KEY]: 'eighty', [HARNESS_PERCENT_WRITTEN_KEY]: '80' } });
      const init = ensureHarnessCompactThreshold({ location, env: {} });
      expect(init.percent.reason).toBe('unreadable-percent');
      expect(describeHarnessCompactThreshold(init)).toContain('--reset');
      const result = resetHarnessThreshold({ thresholdLocation: location });
      expect(result.percent.ownership).toBe('peaks-corrupt');
      expect(result.percent.action).toBe('removed');
      expect(envBlock()[PERCENT_KEY]).toBeUndefined();
      expect(envBlock()[HARNESS_PERCENT_WRITTEN_KEY]).toBeUndefined();
      expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBe('off');
      // and: the recovery is durable — a later init cannot re-lock the typo
      const again = ensureHarnessCompactThreshold({ location, env: {} });
      expect(again.percent.reason).toBe('opted-out');
      expect(envBlock()[PERCENT_KEY]).toBeUndefined();
    });

    it('N3 control: when a human typo has NO marker, should still be kept', () => {
      // given: the same `eighty`, but with no marker peaks-loop wrote — the
      //        value might be the user's own (unusable) setting
      // when: the rollback runs
      // then: kept, so the ownership predicate above is not just "delete any
      //       unparseable percent"
      writeSettings({ env: { [PERCENT_KEY]: 'eighty' } });
      const result = resetHarnessThreshold({ thresholdLocation: location });
      expect(result.percent.ownership).toBe('human');
      expect(result.percent.action).toBe('kept-human');
      expect(envBlock()[PERCENT_KEY]).toBe('eighty');
    });

    it('N3 control: when a human pin parses beside a different marker, should keep it', () => {
      // given: marker 80, value 65 — a human takeover, the R6 case
      // when: the rollback runs
      // then: kept, because both parse and they disagree
      writeSettings({ env: { [PERCENT_KEY]: '65', [HARNESS_PERCENT_WRITTEN_KEY]: '80' } });
      const result = resetHarnessThreshold({ thresholdLocation: location });
      expect(result.percent.ownership).toBe('human');
      expect(envBlock()[PERCENT_KEY]).toBe('65');
    });
  });

  describe('(integration) the removal is durable against a later install', () => {
    it('when init runs after the rollback, should not resurrect either knob', () => {
      // given: an installed project that was then rolled back
      // when: the install path runs again
      // then: nothing is written — this is R1's measured defect, closed
      ensureHarnessCompactThreshold({ location, env: {} });
      resetHarnessThreshold({ thresholdLocation: location });
      const afterReset = readFileSync(location.settingsPath, 'utf8');
      const again = ensureHarnessCompactThreshold({ location, env: {} });
      expect(again.window.reason).toBe('opted-out');
      expect(again.percent.reason).toBe('opted-out');
      expect(readFileSync(location.settingsPath, 'utf8')).toBe(afterReset);
    });

    it('when the rollback runs twice, should be idempotent', () => {
      // given: a rolled-back project
      // when: the rollback runs again
      // then: reported absent and the bytes do not move
      ensureHarnessCompactThreshold({ location, env: {} });
      resetHarnessThreshold({ thresholdLocation: location });
      const after = readFileSync(location.settingsPath, 'utf8');
      const second = resetHarnessThreshold({ thresholdLocation: location });
      expect(second.percent.action).toBe('absent');
      expect(readFileSync(location.settingsPath, 'utf8')).toBe(after);
    });

    it('when the file holds no window key but a surviving window marker, should treat the window as present', () => {
      // given: the user deleted the window VALUE by hand; the marker survived
      // when: the rollback runs
      // then: the marker is cleaned up and the opt-out recorded. `action` is
      //       `absent` — there is no VALUE to name — but the marker proves the
      //       row was peaks content, so the write still happens (the sentence
      //       says "Cleaned the stale … marker", never "Nothing to remove").
      writeSettings({ env: { [HARNESS_WINDOW_WRITTEN_KEY]: '250000' } });
      const result = resetHarnessThreshold({ thresholdLocation: location });
      expect(result.window.ownership).toBe('stale-marker');
      expect(result.window.action).toBe('absent');
      expect(result.wrote).toBe(true);
      expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBeUndefined();
      expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBe('off');
    });

    it('when a window VALUE sits without its marker, should KEEP it — a hand-set window is not peaks content', () => {
      // given: a hand-set window with no marker beside a peaks-owned percent
      // when: the rollback runs
      // then: the WINDOW is kept (ownership `human`, action `kept-human`) while
      //       the percent it DID write is removed. This is HIGH-1: the old code
      //       deleted the window unconditionally and destroyed a user's 700000.
      writeSettings({
        env: { [WINDOW_KEY]: '250000', [PERCENT_KEY]: '80', [HARNESS_PERCENT_WRITTEN_KEY]: '80' }
      });
      const result = resetHarnessThreshold({ thresholdLocation: location });
      expect(result.window).toMatchObject({
        key: WINDOW_KEY,
        action: 'kept-human',
        ownership: 'human',
        previousTokens: 250_000
      });
      expect(result.percent.action).toBe('removed');
      expect(envBlock()[WINDOW_KEY]).toBe('250000');
      expect(envBlock()[PERCENT_KEY]).toBeUndefined();
    });

    it('when a window marker alone was cleaned, should report the write, not an empty removal', () => {
      // given: the window value deleted by hand, its marker left behind
      //        (the marker alone IS peaks content, so the file changes)
      // when: the rollback runs
      // then: no knob reports a removal — there is no value to name — but the
      //       call still wrote, and the opt-out is recorded
      writeSettings({ env: { [HARNESS_WINDOW_WRITTEN_KEY]: '250000' } });
      const result = resetHarnessThreshold({ thresholdLocation: location });
      expect(result.wrote).toBe(true);
      expect(result.window.action).toBe('absent');
      expect(result.percent.action).toBe('absent');
      expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBe('off');
    });

    it('when the rollback writes, should report optedOut true; when it does not write, the file’s own row', () => {
      // given: a peaks-owned pair, and separately a file with nothing of
      //        peaks-loop's that ALREADY carries the opt-out
      // when: the rollback runs on each
      // then: `true` for the write, and the EXISTING row's truth for the no-op
      //       — the no-op must not claim it recorded a row it did not write
      ensureHarnessCompactThreshold({ location, env: {} });
      expect(resetHarnessThreshold({ thresholdLocation: location }).optedOut).toBe(true);
      writeSettings({ env: { SOME_USER_KEY: 'keep-me', [HARNESS_WINDOW_SYNC_OPTOUT_KEY]: 'off' } });
      const noop = resetHarnessThreshold({ thresholdLocation: location });
      expect(noop.window.action).toBe('absent');
      expect(noop.optedOut).toBe(true);
      writeSettings({ env: { SOME_USER_KEY: 'keep-me' } });
      expect(resetHarnessThreshold({ thresholdLocation: location }).optedOut).toBe(false);
    });
  });

  describe('(integration) what the write leaves in the file', () => {
    it('when the rollback writes, should preserve every unrelated row and the other top-level keys', () => {
      // given: a settings file with a third-party env key AND a top-level key
      // when: the rollback removes the peaks pair
      // then: both survive. This is a read-modify-write of the two peaks rows
      //       and the opt-out only — a dropped `hooks` block would be a
      //       settings file destroyed by the command the user ran to undo one.
      writeSettings({
        hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'x' }] }] },
        env: {
          SOME_USER_KEY: 'keep-me',
          [WINDOW_KEY]: '250000',
          [HARNESS_WINDOW_WRITTEN_KEY]: '250000',
          [PERCENT_KEY]: '80',
          [HARNESS_PERCENT_WRITTEN_KEY]: '80'
        }
      });
      resetHarnessThreshold({ thresholdLocation: location });
      const after = JSON.parse(readFileSync(location.settingsPath, 'utf8')) as Record<
        string,
        unknown
      >;
      expect(after).toMatchObject({
        hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'x' }] }] }
      });
      expect(envBlock()).toEqual({
        SOME_USER_KEY: 'keep-me',
        [HARNESS_WINDOW_SYNC_OPTOUT_KEY]: 'off'
      });
    });

    it('when a human percent was kept, should keep BOTH its value and the mismatching marker', () => {
      // given: marker 80, value 70 — a takeover — beside a peaks window, so the
      //        rollback actually performs its write (a human percent with no
      //        window row is a no-op, covered separately)
      // when: the rollback runs
      // then: both percent rows survive together. Deleting the marker alone
      //       would silently relabel the human's value as unmarked; keeping
      //       the value alone would erase the evidence that peaks-loop had
      //       written here before.
      writeSettings({
        env: {
          [WINDOW_KEY]: '250000',
          [HARNESS_WINDOW_WRITTEN_KEY]: '250000',
          [PERCENT_KEY]: '70',
          [HARNESS_PERCENT_WRITTEN_KEY]: '80'
        }
      });
      resetHarnessThreshold({ thresholdLocation: location });
      expect(envBlock()[PERCENT_KEY]).toBe('70');
      expect(envBlock()[HARNESS_PERCENT_WRITTEN_KEY]).toBe('80');
      expect(envBlock()[WINDOW_KEY]).toBeUndefined();
    });

    it('when only a HUMAN value is in the file, should still record the opt-out and keep the value', () => {
      // given: a hand-set 65 with no window row and no peaks marker — the value
      //        IS the threshold's content, so "stop managing this" has something
      //        to make durable
      // when: the rollback runs
      // then: the human value survives byte-for-byte AND the opt-out is
      //       recorded, so the next probe cannot fill the window behind their
      //       back. `wrote` is true (the file changed) and the sentence names
      //       the kept value rather than claiming nothing was written.
      writeSettings({ env: { [PERCENT_KEY]: '65' } });
      const result = resetHarnessThreshold({ thresholdLocation: location });
      expect(result.percent.action).toBe('kept-human');
      expect(result.optedOut).toBe(true);
      expect(result.wrote).toBe(true);
      expect(envBlock()[PERCENT_KEY]).toBe('65');
      expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBe('off');
      expect(describeHarnessThresholdReset(result)).toContain('Kept');
    });

    it('when a stale percent marker is cleaned, should report wrote=true despite naming nothing removed', () => {
      // given: the percent value deleted by hand, its marker left behind
      // when: the rollback runs
      // then: `wrote` is true while both knob actions are `absent` — the exact
      //       pair of facts the old sentence conflated (it printed "nothing was
      //       written" for this file). See the sentence test in the a11y file.
      writeSettings({ env: { [HARNESS_PERCENT_WRITTEN_KEY]: '80' } });
      const result = resetHarnessThreshold({ thresholdLocation: location });
      expect(result.wrote).toBe(true);
      expect(result.percent.action).toBe('absent');
      expect(result.window.action).toBe('absent');
    });
  });

  describe('(integration) a LINKED settings file is refused, never written through', () => {
    it('when the settings file is ABSENT, should report a no-op — not a refusal', () => {
      // given: no settings file at all (the ordinary fresh project)
      // when: the rollback runs
      // then: `wrote=false` with NO refusal — telling the user "is not a JSON
      //       object" about a file that does not exist would be a false sentence
      //       of exactly the class this slice fixes. The sentence is the no-op one.
      const before = existsSync(location.settingsPath);
      expect(before).toBe(false);
      const result = resetHarnessThreshold({ thresholdLocation: location });
      expect(result.refusal).toBeUndefined();
      expect(result.wrote).toBe(false);
      expect(result.optedOut).toBe(false);
      expect(describeHarnessThresholdReset(result)).toContain('Nothing to remove');
      expect(existsSync(location.settingsPath)).toBe(false);
    });

    it('when a LINKED settings file is refused, should say it is a link, not that it is unreadable', () => {
      // given: `.claude/settings.local.json` is a link (or junction) to a file
      //        carrying a peaks pair — the rollback would otherwise follow it
      // when: the documented rollback runs
      // then: refused for the LINK reason (not `unreadable-settings` — the file
      //       parses), nothing written, and the target keeps every row
      const victim = join(root, 'victim.json');
      writeFileSync(
        victim,
        `${JSON.stringify(
          {
            env: {
              [WINDOW_KEY]: '250000',
              [HARNESS_WINDOW_WRITTEN_KEY]: '250000',
              [PERCENT_KEY]: '80',
              [HARNESS_PERCENT_WRITTEN_KEY]: '80'
            }
          },
          null,
          2
        )}\n`,
        'utf8'
      );
      mkdirSync(join(root, '.claude'), { recursive: true });
      try {
        symlinkSync(victim, location.settingsPath, 'file');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EPERM' && code !== 'EACCES' && code !== 'UNKNOWN') throw error;
        symlinkSync(victim, location.settingsPath, 'junction');
      }
      expect(lstatSync(location.settingsPath).isSymbolicLink()).toBe(true);
      const before = readFileSync(victim, 'utf8');
      const result = resetHarnessThreshold({ thresholdLocation: location });
      expect(result.refusal).toBe('symlinked-settings');
      expect(result.wrote).toBe(false);
      expect(readFileSync(victim, 'utf8')).toBe(before);
    });
  });
});

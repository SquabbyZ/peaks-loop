// tests/unit/context/harness-compact-threshold-reset-a11y.test.ts
//
// The SENTENCE half of `peaks compact harness-window --reset` — split out of
// `harness-compact-threshold-reset.test.ts` when that file crossed the 500-line
// cap for `tests/**`.
//
// The property under test: the rollback's one sentence must be TRUE about what
// it did. "Removed the threshold" is false when a human's percent survived,
// "Nothing to remove" is false when the file was in fact written, and an empty
// `Removed  from` is false when a stale marker was cleaned. Each branch here
// pins one of those claims against a real settings file.
//
// Dimensions covered:
//   - a11y:        the human-visible sentence, in every branch it has
//   - render:      the clause structure (`Removed A and B`, `(was N)`, the
//                  kept clause, the corrupt clause)
//   - behavior:    which result shape each branch is reached from
//   - integration: the result the sentence is rendered from comes from a real
//                  read-modify-write, not a hand-built literal
//
// Omitting nothing: the four dimensions above are this file's whole surface.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  HARNESS_PERCENT_WRITTEN_KEY,
  type HarnessCompactThresholdLocation
} from '~/src/services/context/harness-compact-threshold-config';
import { ensureHarnessCompactThreshold } from '~/src/services/context/harness-compact-threshold-ensure';
import {
  describeHarnessThresholdReset,
  resetHarnessThreshold
} from '~/src/services/context/harness-compact-threshold-reset';
import {
  HARNESS_WINDOW_SYNC_OPTOUT_KEY,
  HARNESS_WINDOW_WRITTEN_KEY
} from '~/src/services/context/harness-window-config';

declareDimensions('tests/unit/context/harness-compact-threshold-reset-a11y.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const WINDOW_KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';
const PERCENT_KEY = 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE';

describe('harness-compact-threshold — the reset sentence', () => {
  let root = '';
  let location: HarnessCompactThresholdLocation;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-threshold-reset-a11y-'));
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

  /** The file's env with the percent marker removed — a human's own value. */
  function humanPercent(): Record<string, unknown> {
    const env: Record<string, unknown> = { ...envBlock(), [PERCENT_KEY]: '65' };
    delete env[HARNESS_PERCENT_WRITTEN_KEY];
    return env;
  }

  describe('(a11y) the sentence says what was removed and how to undo it', () => {
    it('when the pair was removed, should name both knobs and the way back', () => {
      // given: a removed pair
      // when: the sentence is rendered
      // then: it names both keys and --reenable, and asks no question
      ensureHarnessCompactThreshold({ location, env: {} });
      const result = resetHarnessThreshold({ thresholdLocation: location });
      const sentence = describeHarnessThresholdReset(result);
      expect(sentence).toContain(WINDOW_KEY);
      expect(sentence).toContain(PERCENT_KEY);
      expect(sentence).toContain('--reenable');
      expect(sentence).not.toContain('?');
    });

    it('when a human percent was kept, should say so rather than claim a full rollback', () => {
      // given: a peaks-written window beside a percent the user set by hand
      // when: the sentence is rendered
      // then: it names the kept value and why it was left alone
      ensureHarnessCompactThreshold({ location, env: {}, windowTokens: 250_000 });
      writeSettings({ env: humanPercent() });
      const sentence = describeHarnessThresholdReset(
        resetHarnessThreshold({ thresholdLocation: location })
      );
      expect(sentence).toContain('65');
      expect(sentence.toLowerCase()).toContain('kept claude_autocompact_pct_override');
    });

    it('when nothing of peaks-loop’s is there, should say nothing was written and record no opt-out', () => {
      // given: another tool's settings file
      // when: the sentence is rendered
      // then: the no-op sentence, naming both keys and claiming no opt-out row.
      //       Rendering it as "Removed  from … and opted this project out"
      //       would tell the user a rollback happened when nothing was written.
      writeSettings({ env: { SOME_USER_KEY: 'keep-me' } });
      const sentence = describeHarnessThresholdReset(
        resetHarnessThreshold({ thresholdLocation: location })
      );
      expect(sentence).toContain('Nothing to remove');
      expect(sentence).toContain(WINDOW_KEY);
      expect(sentence).toContain(PERCENT_KEY);
      expect(sentence).toContain('nothing was written');
      expect(sentence).not.toContain('--reenable');
    });

    it('when a stale percent marker alone was cleaned, should report the write, not "nothing to remove"', () => {
      // given: the percent VALUE deleted by hand, its marker left behind, and no
      //        window row at all — a file that WILL change when the rollback runs
      // when: the rollback runs and the sentence is rendered
      // then: the file WAS written (marker gone, opt-out recorded), and the
      //       sentence must say so. Both knobs are `absent` (there is no value to
      //       name), so the removals alone look like a no-op — the sentence is
      //       decided by `result.wrote`, not by them.
      writeSettings({ env: { [HARNESS_PERCENT_WRITTEN_KEY]: '80' } });
      const before = readFileSync(location.settingsPath, 'utf8');
      const result = resetHarnessThreshold({ thresholdLocation: location });
      // the result is the honest account AND the file agrees with it
      expect(result.percent.ownership).toBe('stale-marker');
      expect(result.percent.action).toBe('absent');
      expect(result.window.action).toBe('absent');
      expect(result.optedOut).toBe(true);
      expect(result.wrote).toBe(true);
      expect(readFileSync(location.settingsPath, 'utf8')).not.toBe(before);
      expect(envBlock()[HARNESS_PERCENT_WRITTEN_KEY]).toBeUndefined();
      expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBe('off');
      // …and the SENTENCE agrees: it claims a write and a cleanup, never the
      // no-op sentence the old removal-shape branch printed for this exact file.
      const sentence = describeHarnessThresholdReset(result);
      expect(sentence).toContain('Cleaned the stale peaks-loop provenance marker');
      expect(sentence).toContain(location.settingsPath);
      expect(sentence).toContain('opted this project out');
      expect(sentence).not.toContain('Nothing to remove');
      expect(sentence).not.toContain('nothing was written');
    });

    it('when a stale WINDOW marker alone was cleaned, should report the cleanup, not a removal', () => {
      // given: the window VALUE deleted by hand, its marker left behind — a file
      //        that also changes on disk
      // when: the rollback runs
      // then: there is no value to name, so the sentence is the stale-marker
      //       one; reporting `Removed WINDOW` would name a removal that did not
      //       happen
      writeSettings({ env: { [HARNESS_WINDOW_WRITTEN_KEY]: '250000' } });
      const result = resetHarnessThreshold({ thresholdLocation: location });
      expect(result.wrote).toBe(true);
      const sentence = describeHarnessThresholdReset(result);
      expect(sentence).toContain('Cleaned the stale peaks-loop provenance marker');
      expect(sentence).not.toContain('Nothing to remove');
    });

    it('when a human percent survived, should pair the removed window with the kept clause', () => {
      // given: a peaks-written 250000 window and a hand-set 65
      // when: the sentence is rendered
      // then: both clauses appear, and the removed half names the OLD value
      //       (`(was 250000)`), so the user can see what moved
      ensureHarnessCompactThreshold({ location, env: {}, windowTokens: 250_000 });
      writeSettings({ env: humanPercent() });
      const sentence = describeHarnessThresholdReset(
        resetHarnessThreshold({ thresholdLocation: location })
      );
      expect(sentence).toContain(`Removed ${WINDOW_KEY} (was 250000)`);
      expect(sentence).toContain('Kept');
      expect(sentence).toContain('your own setting');
    });

    it('when a peaks-corrupt percent was removed, should name it as not a percentage', () => {
      // given: `eighty` where peaks-loop wrote 80
      // when: the sentence is rendered
      // then: the corrupt clause — the raw text, quoted, and the reason it was
      //       removed. Rendering `(was null)` would name a number that never
      //       existed; naming it "your own setting" would be false.
      writeSettings({ env: { [PERCENT_KEY]: 'eighty', [HARNESS_PERCENT_WRITTEN_KEY]: '80' } });
      const sentence = describeHarnessThresholdReset(
        resetHarnessThreshold({ thresholdLocation: location })
      );
      // BOUNDED (MED-2): the sentence is printed, so it says WHAT the slot held
      // without echoing the file's content — the raw `eighty` must not appear.
      expect(sentence).toContain(
        `${PERCENT_KEY} (held a value that is not a percentage, not echoed here)`
      );
      expect(sentence).not.toContain('eighty');
      expect(sentence).not.toContain('your own setting');
      expect(sentence).not.toContain('was null');
    });

    it('when a parseable peaks percent was removed, should name its old value', () => {
      // given: peaks-loop's own 80 percent with no window row
      // when: the sentence is rendered
      // then: `(was 80)` on the percent too, in the same `was N` form the
      //       window half uses — the CONTROL for the corrupt clause above
      writeSettings({ env: { [PERCENT_KEY]: '80', [HARNESS_PERCENT_WRITTEN_KEY]: '80' } });
      const sentence = describeHarnessThresholdReset(
        resetHarnessThreshold({ thresholdLocation: location })
      );
      expect(sentence).toContain(`${PERCENT_KEY} (was 80)`);
      expect(sentence).not.toContain('not a percentage');
    });

    it('when both halves were removed, should join them with "and" and add no kept clause', () => {
      // given: the pair peaks-loop installed
      // when: the sentence is rendered
      // then: `Removed W (was N) and P (was N)`, with no ` Kept ` clause. The
      //       kept clause exists only for a human's surviving value, and the
      //       joiner is what keeps two removals from reading as one.
      ensureHarnessCompactThreshold({ location, env: {} });
      const sentence = describeHarnessThresholdReset(
        resetHarnessThreshold({ thresholdLocation: location })
      );
      expect(sentence).toContain(
        `Removed ${WINDOW_KEY} (was 250000) and ${PERCENT_KEY} (was 80) from ${location.settingsPath}`
      );
      expect(sentence).not.toContain('Kept ');
      expect(sentence).not.toContain('your own setting');
    });

    it('when only a HUMAN value was found, should not claim a stale marker was cleaned', () => {
      // given: a lone hand-set window — the HIGH-1 fixture — with no marker at
      //        all, so the only write is the opt-out row
      // when: the sentence is rendered
      // then: it says peaks-loop now leaves the knobs alone and names the kept
      //       value. "Cleaned the stale provenance marker" was the measured
      //       wording defect: nothing was cleaned.
      writeSettings({ env: { [WINDOW_KEY]: '700000' } });
      const sentence = describeHarnessThresholdReset(
        resetHarnessThreshold({ thresholdLocation: location })
      );
      expect(sentence).toContain('leaves');
      expect(sentence).toContain('opted this project out');
      expect(sentence).toContain('Kept');
      expect(sentence).toContain('700000');
      expect(sentence).not.toContain('Cleaned the stale');
      expect(sentence).not.toContain('Nothing to remove');
    });

    it('when a window marker alone was cleaned, should say it cleaned a marker, not "Removed WINDOW from"', () => {
      // given: the window value deleted by hand, its marker left behind
      // when: the rollback runs
      // then: the stale-marker sentence — there is no value to put after
      //       `Removed`, and an empty `Removed  from` would be false
      writeSettings({ env: { [HARNESS_WINDOW_WRITTEN_KEY]: '250000' } });
      const sentence = describeHarnessThresholdReset(
        resetHarnessThreshold({ thresholdLocation: location })
      );
      expect(sentence).toContain(location.settingsPath);
      expect(sentence).toContain('Cleaned the stale peaks-loop provenance marker');
      expect(sentence).not.toContain('was null');
      expect(sentence).not.toContain('was undefined');
      expect(sentence).not.toContain('(was )');
      expect(sentence).not.toContain('Removed ');
    });
  });
});

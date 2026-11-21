// tests/unit/context/harness-settings-file-sentences.test.ts
//
// The SENTENCE vocabulary in `src/services/context/harness-settings-file.ts` —
// the small shared read layer the threshold modules sit on.
//
// WHY A FILE OF ITS OWN. `wasValue`, `percentClause` and
// `nothingToRemoveSentence` are only ever reached THROUGH
// `describeHarnessThresholdReset`, so the rollback suites assert them as
// substrings of one long sentence. A substring assertion cannot tell "the
// percent clause is right" from "the window clause happened to share the
// wording", and it cannot reach the branch where the value is `null` at all —
// a removal with no previous number. These arms call the helpers directly, so
// each clause is pinned on its own.
//
// The property under test: every one of these is printed to the user, so a
// clause that silently disappears or names `null` is a false statement about
// what the rollback found.
//
// Dimensions covered:
//   - render:      the exact clause text for each ownership state
//   - behavior:    the null / non-null split and the `peaks-corrupt` split
//   - integration: the readers against a real settings file
//   - a11y:        the MED-2 bounded phrasing, which is what keeps user text
//                  out of a message that reaches logs

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { HARNESS_PERCENT_WRITTEN_KEY } from '~/src/services/context/harness-compact-threshold-config';
import {
  describeHarnessThresholdReset,
  resetHarnessThreshold,
  type HarnessThresholdResetResult
} from '~/src/services/context/harness-compact-threshold-reset';
import { HARNESS_WINDOW_WRITTEN_KEY } from '~/src/services/context/harness-window-config';
import {
  envBlock,
  isEditableSettingsFile,
  nothingToRemoveSentence,
  percentClause,
  settingsEnvValue,
  wasValue
} from '~/src/services/context/harness-settings-file';

declareDimensions('tests/unit/context/harness-settings-file-sentences.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

describe('harness-settings-file — the sentence vocabulary', () => {
  describe('(render) wasValue', () => {
    it('when the previous value is a number, should render it in parentheses', () => {
      // given: a removal that DID find a value
      // when: the clause is rendered
      // then: ` (was N)` — the reader can see what moved, and the leading space
      //       is part of it, because the clause is concatenated onto a key name
      expect(wasValue(250_000)).toBe(' (was 250000)');
      expect(wasValue(80)).toBe(' (was 80)');
      // and: `0` is a NUMBER, not an absent value — a truthiness test would
      //      drop it and claim nothing was there
      expect(wasValue(0)).toBe(' (was 0)');
    });

    it('when the previous value is null, should render nothing at all', () => {
      // given: a removal that found no parseable number
      // when: the clause is rendered
      // then: the empty string — never ` (was null)`, which would name a
      //       number that never existed
      expect(wasValue(null)).toBe('');
      expect(wasValue(null)).not.toContain('null');
    });
  });

  describe('(render) percentClause', () => {
    it('when the percent was peaks-owned and parseable, should name its number', () => {
      // given: peaks-loop's own 80, removed
      // when: the clause is rendered
      // then: `KEY (was 80)`, the same form the window half uses
      expect(percentClause({ key: 'PCT', ownership: 'peaks', previousPercent: 80 })).toBe(
        'PCT (was 80)'
      );
    });

    it('when the percent was peaks-corrupt, should use the bounded phrase and never the raw text', () => {
      // given: a corrupted peaks write — the value does not parse, so there is
      //        no number to name and the raw text must not be echoed (MED-2)
      // when: the clause is rendered
      // then: the fixed phrase. ` (was null)` would name a number that never
      //       existed, and echoing the value would put user-writable text on
      //       stdout and into logs.
      expect(percentClause({ key: 'PCT', ownership: 'peaks-corrupt', previousPercent: null })).toBe(
        'PCT (held a value that is not a percentage, not echoed here)'
      );
      // and: the phrase is chosen by OWNERSHIP, not by the null percent — a
      //      `peaks` value that somehow parsed to null still takes the number
      //      branch, so the two inputs are not interchangeable
      expect(percentClause({ key: 'PCT', ownership: 'peaks', previousPercent: null })).toBe('PCT');
    });
  });

  describe('(a11y) nothingToRemoveSentence', () => {
    it('when the file carries nothing of peaks-loop’s, should name both keys and claim no write', () => {
      // given: a settings path the rollback found nothing to change in
      // when: the sentence is rendered
      // then: both key names in it, the path, and the explicit "nothing was
      //       written" — the sentence a user reads after running the command
      //       to REMOVE something must not read as though it removed anything
      const sentence = nothingToRemoveSentence('/p/settings.local.json', 'WKEY', 'PKEY');
      expect(sentence).toContain('Nothing to remove');
      expect(sentence).toContain('/p/settings.local.json');
      expect(sentence).toContain('WKEY');
      expect(sentence).toContain('PKEY');
      expect(sentence).toContain('nothing was written');
      expect(sentence).toContain('no opt-out row was recorded');
      // and: it points at no undo verb — there is nothing to undo
      expect(sentence).not.toContain('--reenable');
    });
  });

  describe('(integration) the readers', () => {
    let root = '';
    let settingsPath = '';

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'peaks-settings-file-'));
      settingsPath = join(root, 'settings.local.json');
    });

    afterEach(() => {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    });

    it('when the file is absent, should be editable and carry no env value', () => {
      // given: the ordinary first write — nothing on disk
      // when: the readers run
      // then: editable (a write may create it), and every env question is
      //       `undefined` rather than a throw
      expect(isEditableSettingsFile(settingsPath)).toBe(true);
      expect(settingsEnvValue(null, 'ANY')).toBeUndefined();
      expect(envBlock(null)).toEqual({});
    });

    it('when the env block is not an object, should answer an empty block rather than throw', () => {
      // given: the four shapes a non-object `env` can take — absent, null, an
      //        array and a string. The harness itself cannot read any of them,
      //        and a probe must not crash on a file another tool mangled.
      // when: the readers run
      // then: `{}` and `undefined` for every one, never a TypeError
      mkdirSync(root, { recursive: true });
      for (const env of [null, [], 'oops', 7]) {
        writeFileSync(settingsPath, `${JSON.stringify({ env })}\n`, 'utf8');
        expect(envBlock({ env: env as never })).toEqual({});
        expect(settingsEnvValue({ env: env as never }, 'ANY')).toBeUndefined();
      }
      // and: the file IS still editable — a non-object `env` is replaceable,
      //      which is what keeps a percent write possible on such a file
      expect(isEditableSettingsFile(settingsPath)).toBe(true);
    });

    it('when the file is not valid JSON, should report it as not editable', () => {
      // given: a file peaks-loop cannot parse
      // when: the editability question is asked
      // then: false — an init must REPORT this, not clobber the bytes
      mkdirSync(root, { recursive: true });
      writeFileSync(settingsPath, '{ not json\n', 'utf8');
      expect(isEditableSettingsFile(settingsPath)).toBe(false);
    });
  });

  // WHY THE RESET RESULT SHAPE IS PINNED HERE: `harness-compact-threshold-
  // reset.ts` has no test file of its own in the mutation run's `--test-files`
  // selection beyond the one that spends most of its 500-line cap on ownership
  // decisions, and this vocabulary module is where the fields that reach the
  // sentence are read from. Measured 2026-11-22: the refusal, note-omission and
  // `wrote` branches below accounted for 33 of the module's 38 survivors.
  describe('(render) the reset result the sentence is built from', () => {
    const WINDOW_KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';
    const PERCENT_KEY = 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE';

    function resetAt(
      dir: string,
      env?: Record<string, unknown>
    ): { result: HarnessThresholdResetResult; settingsPath: string } {
      const settingsPath = join(dir, '.claude', 'settings.local.json');
      if (env !== undefined) {
        mkdirSync(join(dir, '.claude'), { recursive: true });
        writeFileSync(settingsPath, `${JSON.stringify({ env }, null, 2)}\n`, 'utf8');
      }
      return {
        result: resetHarnessThreshold({
          thresholdLocation: {
            settingsPath,
            envVar: WINDOW_KEY,
            percentEnvVar: PERCENT_KEY,
            projectRoot: dir
          }
        }),
        settingsPath
      };
    }

    it('when the settings file is not JSON, should refuse, write nothing, and claim no opt-out', () => {
      // given: a file carrying bytes peaks-loop cannot parse — it may hold a
      //        peaks pair, and a rollback that DELETED rows it could not read
      //        would be a rollback that destroyed a settings file to undo one
      // when: the documented rollback runs
      // then: `unreadable-settings`, `wrote` false, `optedOut` false, and the
      //       bytes untouched. `optedOut` must be false: it is the refusal
      //       argument, and `true` would tell the user they are opted out of a
      //       row this call never wrote.
      const dir = mkdtempSync(join(tmpdir(), 'peaks-sent-refusal-'));
      try {
        const settingsPath = join(dir, '.claude', 'settings.local.json');
        mkdirSync(join(dir, '.claude'), { recursive: true });
        writeFileSync(settingsPath, '{ not json\n', 'utf8');
        const before = readFileSync(settingsPath, 'utf8');
        const result = resetHarnessThreshold({
          thresholdLocation: {
            settingsPath,
            envVar: WINDOW_KEY,
            percentEnvVar: PERCENT_KEY,
            projectRoot: dir
          }
        });
        expect(result.refusal).toBe('unreadable-settings');
        expect(result.wrote).toBe(false);
        expect(result.optedOut).toBe(false);
        expect(readFileSync(settingsPath, 'utf8')).toBe(before);
        const sentence = describeHarnessThresholdReset(result);
        expect(sentence).toContain('Nothing written');
        expect(sentence).toContain('were left exactly as found');
        expect(sentence).not.toContain('Removed');
        expect(sentence).not.toContain('opted this project out');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('when the file is a LINK, should refuse for the LINK reason and claim no opt-out', () => {
      // given: a settings path that is a link to a file carrying a parseable
      //        peaks pair — `unreadable-settings` would describe it falsely,
      //        because the JSON is fine and where the bytes LAND is the problem
      // when: the documented rollback runs
      // then: `symlinked-settings`, nothing written, `optedOut` false, and the
      //       target unchanged. A parses-fine link reported as "not JSON" would
      //       send the user hunting a syntax error that does not exist.
      const dir = mkdtempSync(join(tmpdir(), 'peaks-sent-link-'));
      try {
        const victim = join(dir, 'victim.json');
        writeFileSync(
          victim,
          `${JSON.stringify({ env: { [PERCENT_KEY]: '80', [HARNESS_PERCENT_WRITTEN_KEY]: '80' } }, null, 2)}\n`,
          'utf8'
        );
        const settingsPath = join(dir, '.claude', 'settings.local.json');
        mkdirSync(join(dir, '.claude'), { recursive: true });
        try {
          symlinkSync(victim, settingsPath, 'file');
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'EPERM' && code !== 'EACCES' && code !== 'UNKNOWN') throw error;
          symlinkSync(victim, settingsPath, 'junction');
        }
        const before = readFileSync(victim, 'utf8');
        const result = resetHarnessThreshold({
          thresholdLocation: {
            settingsPath,
            envVar: WINDOW_KEY,
            percentEnvVar: PERCENT_KEY,
            projectRoot: dir
          }
        });
        expect(result.refusal).toBe('symlinked-settings');
        expect(result.wrote).toBe(false);
        expect(result.optedOut).toBe(false);
        expect(readFileSync(victim, 'utf8')).toBe(before);
        const sentence = describeHarnessThresholdReset(result);
        expect(sentence).toContain('is a symlink');
        expect(sentence).toContain('Replace the link with a real file (or directory) and re-run.');
        expect(sentence).not.toContain('not a JSON object');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('when the file carries nothing of peaks-loop’s, should omit the refusal PROPERTY and every note', () => {
      // given: another tool's settings file
      // when: the rollback runs
      // then: `wrote` false, no `refusal` KEY (not `refusal: undefined`, which
      //       `exactOptionalPropertyTypes` forbids and which a consumer could
      //       still find with `'refusal' in result`), and neither half carrying
      //       a `previousRawNote`. A present-but-undefined note would render
      //       `Kept K=undefined` in the sentence.
      const dir = mkdtempSync(join(tmpdir(), 'peaks-sent-noop-'));
      try {
        const { result } = resetAt(dir, { SOME_USER_KEY: 'keep-me' });
        expect(result.wrote).toBe(false);
        expect('refusal' in result).toBe(false);
        expect(result.optedOut).toBe(false);
        expect('previousRawNote' in result.window).toBe(false);
        expect('previousRawNote' in result.percent).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('when each half held a value, should carry ONE bounded note per present half only', () => {
      // given: a hand-set window beside a peaks-owned percent — both halves
      //        have something to report, and their notes must be bounded
      // when: the rollback runs
      // then: both notes present and bounded (`the number …`, never the raw
      //       string, which is user-writable and reaches stdout / logs, MED-2).
      //       The mirror arm below proves neither note is unconditional.
      const dir = mkdtempSync(join(tmpdir(), 'peaks-sent-notes-'));
      try {
        const { result } = resetAt(dir, {
          [WINDOW_KEY]: '700000',
          [PERCENT_KEY]: '80',
          [HARNESS_PERCENT_WRITTEN_KEY]: '80'
        });
        expect(result.window.previousTokens).toBe(700_000);
        expect(result.window.previousRawNote).toBe('the number 700000');
        expect(result.percent.previousPercent).toBe(80);
        expect(result.percent.previousRawNote).toBe('the number 80');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('when the WINDOW half was absent, should omit the window note and keep the percent’s', () => {
      // given: peaks-loop's own percent and NO window row
      // when: the rollback runs
      // then: the percent carries its note and the window carries NONE. An
      //       unconditional spread would attach `previousRawNote` to a key the
      //       file never held, so "was it there?" would answer yes every time.
      const dir = mkdtempSync(join(tmpdir(), 'peaks-sent-notes2-'));
      try {
        const { result } = resetAt(dir, {
          [PERCENT_KEY]: '80',
          [HARNESS_PERCENT_WRITTEN_KEY]: '80'
        });
        expect(result.percent.previousRawNote).toBe('the number 80');
        expect('previousRawNote' in result.window).toBe(false);
        expect(result.window.previousTokens).toBeNull();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('when a stale percent marker alone was cleaned, should report a write that removed no knob', () => {
      // given: a percent MARKER with no value — nothing to name as removed, but
      //        the marker IS peaks content, so the file does change
      // when: the rollback runs
      // then: `wrote` true (the file moved), both actions `absent`, both notes
      //       omitted, AND the marker row is gone from the file. That delete is
      //       keyed on `removable || stale-marker`; a rule keyed on the value
      //       alone would leave a provenance row behind that claims ownership
      //       peaks-loop no longer has.
      const dir = mkdtempSync(join(tmpdir(), 'peaks-sent-stale-'));
      try {
        const { result } = resetAt(dir, { [HARNESS_PERCENT_WRITTEN_KEY]: '80' });
        expect(result.wrote).toBe(true);
        expect(result.window.action).toBe('absent');
        expect(result.percent.action).toBe('absent');
        expect(result.percent.ownership).toBe('stale-marker');
        expect('previousRawNote' in result.percent).toBe(false);
        expect(describeHarnessThresholdReset(result)).toContain(
          'Cleaned the stale peaks-loop provenance marker'
        );
        const after = JSON.parse(
          readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf8')
        ) as { env: Record<string, unknown> };
        expect(after.env[HARNESS_PERCENT_WRITTEN_KEY]).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('when a peaks-owned window sits beside a HUMAN percent, should remove the window and keep the percent', () => {
      // given: peaks-loop's own 250000 pair and a hand-set 65 with NO marker
      // when: the rollback runs
      // then: the window pair is gone and the human percent's value survives.
      //       The control for the marker delete above: a HUMAN percent has no
      //       marker to clean, and inventing or deleting one here would relabel
      //       the user's value as peaks-owned on the next probe.
      const dir = mkdtempSync(join(tmpdir(), 'peaks-sent-mixed-'));
      try {
        const { result } = resetAt(dir, {
          [WINDOW_KEY]: '250000',
          [HARNESS_WINDOW_WRITTEN_KEY]: '250000',
          [PERCENT_KEY]: '65'
        });
        expect(result.window.action).toBe('removed');
        expect(result.percent.action).toBe('kept-human');
        const after = JSON.parse(
          readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf8')
        ) as { env: Record<string, unknown> };
        expect(after.env[PERCENT_KEY]).toBe('65');
        expect(after.env[HARNESS_PERCENT_WRITTEN_KEY]).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

// tests/unit/context/harness-compact-threshold-window-ownership.test.ts
//
// HIGH-1: `--reset` deleted the WINDOW unconditionally, so a hand-set 700000 was
// destroyed by the command documented to "never touch the user's own
// configuration". The percent half had been ownership-guarded since the pair was
// introduced; the window half had not.
//
// These four arms are the window half's ownership table, over a real settings
// file: a human pin is kept, a peaks write is removed, a corrupted peaks write
// is removed, and a MIXED file obeys each half's own rule in one write. Kept in
// a file of their own because `harness-compact-threshold-reset.test.ts` sits at
// the 500-line tests cap.
//
// Dimensions covered:
//   - render:      the result's `window.ownership`/`action` and the sentence
//   - behavior:    the four ownership decisions
//   - integration: the real settings file, byte-compared

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  HARNESS_PERCENT_WRITTEN_KEY,
  type HarnessCompactThresholdLocation
} from '~/src/services/context/harness-compact-threshold-config';
import {
  describeHarnessThresholdReset,
  resetHarnessThreshold
} from '~/src/services/context/harness-compact-threshold-reset';
import {
  HARNESS_WINDOW_SYNC_OPTOUT_KEY,
  HARNESS_WINDOW_WRITTEN_KEY
} from '~/src/services/context/harness-window-config';

declareDimensions(
  'tests/unit/context/harness-compact-threshold-window-ownership.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason:
        'the sentence kept clause is asserted as a substring; the full wording lives in the a11y suite'
    }
  ]
);

const WINDOW_KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';
const PERCENT_KEY = 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE';

describe('harness-compact-threshold — the WINDOW half obeys the ownership rule', () => {
  let root = '';
  let location: HarnessCompactThresholdLocation;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-window-ownership-'));
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

  it('when the user hand-set the window (no marker), should keep it and report kept-human', () => {
    // given: exactly the fixture the reviewer reproduced — a 700000 window
    //        with no provenance marker, i.e. the user's own setting
    // when: the documented rollback runs
    // then: the value is untouched (the only row that appears is the opt-out,
    //       which the user asked for) and the result names it as KEPT
    writeSettings({ env: { [WINDOW_KEY]: '700000' } });
    const result = resetHarnessThreshold({ thresholdLocation: location });
    expect(result.window.action).toBe('kept-human');
    expect(result.window.ownership).toBe('human');
    expect(result.window.previousTokens).toBe(700_000);
    expect(envBlock()[WINDOW_KEY]).toBe('700000');
    expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBeUndefined();
    expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBe('off');
  });

  it('when peaks-loop wrote the window, should remove it and its marker', () => {
    // given: peaks-loop's own 250000 (value === marker)
    // when: the rollback runs
    // then: removed — the CONTROL for the human arm above, so "kept" is not
    //       simply "keep every window"
    writeSettings({ env: { [WINDOW_KEY]: '250000', [HARNESS_WINDOW_WRITTEN_KEY]: '250000' } });
    const result = resetHarnessThreshold({ thresholdLocation: location });
    expect(result.window.action).toBe('removed');
    expect(result.window.ownership).toBe('peaks');
    expect(envBlock()[WINDOW_KEY]).toBeUndefined();
    expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBeUndefined();
  });

  it('when a peaks-owned window was corrupted, should still remove it', () => {
    // given: `500k` where peaks-loop wrote 250000 — peaks-loop never writes a
    //        non-token-count, so this is its own write mangled afterwards
    // when: the rollback runs
    // then: removed as `peaks-corrupt`, never kept as a human pin
    writeSettings({ env: { [WINDOW_KEY]: '500k', [HARNESS_WINDOW_WRITTEN_KEY]: '250000' } });
    const result = resetHarnessThreshold({ thresholdLocation: location });
    expect(result.window.action).toBe('removed');
    expect(result.window.ownership).toBe('peaks-corrupt');
    expect(envBlock()[WINDOW_KEY]).toBeUndefined();
    expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBeUndefined();
  });

  it('when the same garbage sits in BOTH the window and its marker, should keep it (MED-1)', () => {
    // given: `500k` typed into both rows — the shape the percent half's
    //        reproduction established a human can produce by hand
    // when: the rollback runs
    // then: KEPT. peaks-loop writes only `String(tokens)` as its marker, so an
    //       unparseable marker is not one of its writes; the old "both raws
    //       equal" arm deleted the user's value.
    writeSettings({ env: { [WINDOW_KEY]: '500k', [HARNESS_WINDOW_WRITTEN_KEY]: '500k' } });
    const result = resetHarnessThreshold({ thresholdLocation: location });
    expect(result.window.action).toBe('kept-human');
    expect(result.window.ownership).toBe('human');
    expect(envBlock()[WINDOW_KEY]).toBe('500k');
    expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBe('500k');
  });

  it('when a human window sits beside a peaks-owned percent, should keep the window and remove the percent', () => {
    // given: the MIXED case — a hand-set 700000 window, peaks-loop's own 80
    // when: the rollback runs
    // then: each half obeys its own rule in the SAME write: the human window
    //       survives, the peaks percent goes, and the sentence names both
    writeSettings({
      env: { [WINDOW_KEY]: '700000', [PERCENT_KEY]: '80', [HARNESS_PERCENT_WRITTEN_KEY]: '80' }
    });
    const result = resetHarnessThreshold({ thresholdLocation: location });
    expect(result.window.action).toBe('kept-human');
    expect(result.percent.action).toBe('removed');
    expect(envBlock()[WINDOW_KEY]).toBe('700000');
    expect(envBlock()[PERCENT_KEY]).toBeUndefined();
    const sentence = describeHarnessThresholdReset(result);
    expect(sentence).toContain(`Removed ${PERCENT_KEY}`);
    expect(sentence).toContain('Kept');
    expect(sentence).toContain('700000');
  });

  it('when the window held no marker and the percent held nothing, should still NOT be a pure no-op', () => {
    // given: a lone hand-set window — the harness threshold's own content, so
    //        "stop managing this" has something to make durable
    // when: the rollback runs
    // then: the value survives and the opt-out is recorded, so the next probe
    //       cannot fill the other knob behind the user's back. A `$HOME` file
    //       with NEITHER knob still writes nothing (pinned in the reset suite).
    writeSettings({ env: { [WINDOW_KEY]: '700000' } });
    const result = resetHarnessThreshold({ thresholdLocation: location });
    expect(result.wrote).toBe(true);
    expect(envBlock()[WINDOW_KEY]).toBe('700000');
    expect(envBlock()[HARNESS_WINDOW_SYNC_OPTOUT_KEY]).toBe('off');
  });

  // WHY THE SENTENCES LIVE HERE AND NOT ONLY IN `…-reset-a11y.test.ts`: that
  // file already asserts most of these, but it is NOT in the mutation run's
  // `--test-files` selection (`.peaks/_runtime/<sid>/rd/measure.sh`), so every
  // assertion in it is invisible to the mutation gate. Measured 2026-11-22:
  // adding the a11y file to the selection alone kills 27 of the 38 reported
  // survivors of `harness-compact-threshold-reset.ts`, and the rest are pinned
  // by the arms below. A sentence assertion that must COUNT toward the gate has
  // to live in a file the gate actually runs.
  it('when both halves were removed, should render EXACTLY the two-removal sentence', () => {
    // given: the installed pair
    // when: the rollback runs
    // then: the exact sentence. Equality, not `toContain`: this is the only
    //       write shape whose kept list is EMPTY, so it is where a join that
    //       forgot to filter its empty clauses would leave an artifact.
    writeSettings({
      env: {
        [WINDOW_KEY]: '250000',
        [HARNESS_WINDOW_WRITTEN_KEY]: '250000',
        [PERCENT_KEY]: '80',
        [HARNESS_PERCENT_WRITTEN_KEY]: '80'
      }
    });
    const sentence = describeHarnessThresholdReset(
      resetHarnessThreshold({ thresholdLocation: location })
    );
    expect(sentence).toBe(
      `Removed ${WINDOW_KEY} (was 250000) and ${PERCENT_KEY} (was 80) from ${location.settingsPath}` +
        ' and opted this project out, so later probes and installs stop writing either knob.' +
        ' Undo with `peaks compact harness-window --reenable`.'
    );
    expect(sentence).not.toContain('Kept');
  });

  it('when only the WINDOW half was removed, should render EXACTLY the one-removal sentence', () => {
    // given: peaks-loop's own window and no percent row
    // when: the rollback runs
    // then: one removal clause and nothing about the percent key. Emitting the
    //       percent clause unconditionally would name a key the file never held.
    writeSettings({ env: { [WINDOW_KEY]: '250000', [HARNESS_WINDOW_WRITTEN_KEY]: '250000' } });
    const sentence = describeHarnessThresholdReset(
      resetHarnessThreshold({ thresholdLocation: location })
    );
    expect(sentence).toBe(
      `Removed ${WINDOW_KEY} (was 250000) from ${location.settingsPath}` +
        ' and opted this project out, so later probes and installs stop writing either knob.' +
        ' Undo with `peaks compact harness-window --reenable`.'
    );
    expect(sentence).not.toContain(`${PERCENT_KEY} (was`);
    expect(sentence).not.toContain(`and ${PERCENT_KEY}`);
  });

  it('when only the PERCENT half was removed, should render EXACTLY the one-removal sentence', () => {
    // given: peaks-loop's own percent, no window row — the state the old
    //        `resetHarnessWindow` no-op guard could not reach at all
    // when: the rollback runs
    // then: one removal clause, the percent's, with ITS old value, and no
    //       window key anywhere in the sentence
    writeSettings({ env: { [PERCENT_KEY]: '80', [HARNESS_PERCENT_WRITTEN_KEY]: '80' } });
    const sentence = describeHarnessThresholdReset(
      resetHarnessThreshold({ thresholdLocation: location })
    );
    expect(sentence).toBe(
      `Removed ${PERCENT_KEY} (was 80) from ${location.settingsPath}` +
        ' and opted this project out, so later probes and installs stop writing either knob.' +
        ' Undo with `peaks compact harness-window --reenable`.'
    );
    expect(sentence).not.toContain(WINDOW_KEY);
  });

  it('when a stale WINDOW marker alone was cleaned, should render EXACTLY the cleanup sentence', () => {
    // given: the window VALUE deleted by hand, its marker left behind
    // when: the rollback runs
    // then: the cleanup shape, and no removal. Both knob actions are `absent`,
    //       so a sentence that decided by the WINDOW action alone would fall
    //       through to "leaves … alone" and claim nothing was cleaned about a
    //       file whose marker it just deleted.
    writeSettings({ env: { [HARNESS_WINDOW_WRITTEN_KEY]: '250000' } });
    const sentence = describeHarnessThresholdReset(
      resetHarnessThreshold({ thresholdLocation: location })
    );
    expect(sentence).toBe(
      `Cleaned the stale peaks-loop provenance marker from ${location.settingsPath}` +
        ' and opted this project out, so later probes and installs stop writing either knob.' +
        ' Undo with `peaks compact harness-window --reenable`.'
    );
    expect(sentence).not.toContain('Removed ');
    expect(sentence).not.toContain('Peaks-loop now leaves');
  });

  it('when a human window survived, should render the leaves-alone shape plus its kept clause', () => {
    // given: a lone hand-set 700000 window with no marker at all — no removal
    //        happened and no marker was cleaned, so the only write is the opt-out
    // when: the rollback runs
    // then: the "leaves … alone" shape and a kept clause naming the value AND
    //       why it survived. A bare `Kept WIN=a value` would drop the one
    //       number the user needs to confirm their setting is intact.
    writeSettings({ env: { [WINDOW_KEY]: '700000' } });
    const sentence = describeHarnessThresholdReset(
      resetHarnessThreshold({ thresholdLocation: location })
    );
    expect(sentence).toContain(
      `Peaks-loop now leaves ${WINDOW_KEY} and ${PERCENT_KEY} alone in ${location.settingsPath}`
    );
    expect(sentence).toContain(
      `Kept ${WINDOW_KEY}=the number 700000, which is your own value rather than one peaks-loop wrote.`
    );
    expect(sentence).not.toContain('Cleaned the stale');
    expect(sentence).not.toContain('Removed ');
  });

  it('when BOTH knobs are human pins, should render both kept clauses with their own wording', () => {
    // given: a hand-set window AND a hand-set percent, each with no marker
    // when: the rollback runs
    // then: two kept clauses, window first, percent second, each starting with
    //       its own leading space and using its own "value" / "setting" noun.
    //       A join that dropped the empty clauses' filter would fuse them.
    writeSettings({ env: { [WINDOW_KEY]: '700000', [PERCENT_KEY]: '65' } });
    const sentence = describeHarnessThresholdReset(
      resetHarnessThreshold({ thresholdLocation: location })
    );
    const windowClause = ` Kept ${WINDOW_KEY}=the number 700000, which is your own value rather than one peaks-loop wrote.`;
    const percentClause = ` Kept ${PERCENT_KEY}=the number 65, which is your own setting rather than a value peaks-loop wrote.`;
    expect(sentence).toContain(
      `stop writing either knob.${windowClause}${percentClause} Undo with \`peaks compact harness-window --reenable\`.`
    );
  });

  // THE SPELLING GATE. `parseHarnessWindowTokens` accepts every `Number()`
  // spelling, while peaks-loop writes only `String(tokens)` — plain digits. The
  // percent half has guarded exactly this since its parser landed
  // (`PLAIN_PERCENT_SPELLING`); the window half classified by the lenient parse
  // alone, so `1e6` beside marker `1000000` read as peaks-loop's own write and
  // `--reset` DELETED a value it never wrote. These arms pin the gate on BOTH
  // sides of the pair, and the plain control that must not regress.
  describe('the window spelling gate — a value peaks-loop cannot write is never its own', () => {
    it('when the value is scientific notation beside its numeric marker, should keep it as human', () => {
      // given: `1e6` where peaks-loop wrote `1000000` — the reviewer's
      //        reproduction; `Number('1e6')` is 1000000, so the lenient parse
      //        compared equal and reported the pair removable
      // when: the rollback runs
      // then: `human` and KEPT. `String(1000000)` emits `1000000`, never `1e6`,
      //       so this spelling is not evidence that peaks-loop wrote here; the
      //       value and its marker both survive.
      writeSettings({ env: { [WINDOW_KEY]: '1e6', [HARNESS_WINDOW_WRITTEN_KEY]: '1000000' } });
      const result = resetHarnessThreshold({ thresholdLocation: location });
      expect(result.window.action).toBe('kept-human');
      expect(result.window.ownership).toBe('human');
      expect(envBlock()[WINDOW_KEY]).toBe('1e6');
      expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBe('1000000');
      // and: the kept clause describes the value BOUNDEDLY (MED-2). `1e6` is
      //      not the plain-integer note, so the sentence carries a character
      //      count instead — a spelling a human typed must not travel into an
      //      envelope or a log through the sentence describing why it was kept.
      const sentence = describeHarnessThresholdReset(result);
      expect(sentence).toContain(
        `Kept ${WINDOW_KEY}=a value that is not a number (3 chars, not echoed here)`
      );
      expect(sentence).not.toContain('1e6');
    });

    it('when the value carries a leading zero, should keep it as human', () => {
      // given: `00100000` beside marker `100000` — padded digits parse to the
      //        same number, but `String(100000)` never emits a leading zero
      // when: the rollback runs
      // then: `human` and KEPT, both rows intact
      writeSettings({ env: { [WINDOW_KEY]: '00100000', [HARNESS_WINDOW_WRITTEN_KEY]: '100000' } });
      const result = resetHarnessThreshold({ thresholdLocation: location });
      expect(result.window.ownership).toBe('human');
      expect(envBlock()[WINDOW_KEY]).toBe('00100000');
      expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBe('100000');
    });

    it('when the value is signed or fractional, should keep it as human', () => {
      // given: `+1000000` and `1000000.0` — both parse to 1000000 under
      //        `Number()`, neither is a spelling `String(tokens)` produces
      // when: the rollback runs on each
      // then: `human` and KEPT for both, rows unchanged
      for (const spelling of ['+1000000', '1000000.0']) {
        writeSettings({ env: { [WINDOW_KEY]: spelling, [HARNESS_WINDOW_WRITTEN_KEY]: '1000000' } });
        const result = resetHarnessThreshold({ thresholdLocation: location });
        expect(result.window.ownership).toBe('human');
        expect(envBlock()[WINDOW_KEY]).toBe(spelling);
        expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBe('1000000');
      }
    });

    it('when the plain value sits beside its own plain marker, should still remove it', () => {
      // given: the exact pair peaks-loop writes, `String(1000000)` in both rows
      // when: the rollback runs
      // then: `peaks` and REMOVED — the CONTROL for the arms above. Widening the
      //       gate until the feature's own write stopped being removable would
      //       be the opposite failure, and this number (not only 250000) is the
      //       one the 1M rescue writes.
      writeSettings({ env: { [WINDOW_KEY]: '1000000', [HARNESS_WINDOW_WRITTEN_KEY]: '1000000' } });
      const result = resetHarnessThreshold({ thresholdLocation: location });
      expect(result.window.ownership).toBe('peaks');
      expect(result.window.action).toBe('removed');
      expect(envBlock()[WINDOW_KEY]).toBeUndefined();
      expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBeUndefined();
    });

    it('when the MARKER is in a spelling peaks-loop cannot write, should keep the plain value', () => {
      // given: a plain `1000000` value beside a marker of `1e6` — the mirror of
      //        the first arm, and the same percent rule applied to the other row
      // when: the rollback runs
      // then: `human` and KEPT. The marker is the only evidence that peaks-loop
      //       wrote here, so a marker in a spelling `String(tokens)` never
      //       emits cannot supply it; both rows survive.
      writeSettings({ env: { [WINDOW_KEY]: '1000000', [HARNESS_WINDOW_WRITTEN_KEY]: '1e6' } });
      const result = resetHarnessThreshold({ thresholdLocation: location });
      expect(result.window.ownership).toBe('human');
      expect(envBlock()[WINDOW_KEY]).toBe('1000000');
      expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBe('1e6');
    });

    it('when a JSON NUMBER sits in the human row, should treat it as human unless it is a plain integer', () => {
      // given: `env` blocks are string-valued, but a hand-edited or foreign
      //        writer can leave a NUMBER in the slot
      // when: the rollback runs on each
      // then: an integer is a spelling `String(tokens)` produces, so it is
      //       readable — `human` here because it does not match the marker —
      //       while a FRACTION (`1000000.5`) is not, and neither is a boolean
      //       or an object. All four are KEPT; the point is that the number
      //       branch decides by the value, not by a string cast that would
      //       turn `true` into the spelling `true`.
      writeSettings({ env: { [WINDOW_KEY]: 1_000_000, [HARNESS_WINDOW_WRITTEN_KEY]: '250000' } });
      expect(resetHarnessThreshold({ thresholdLocation: location }).window.ownership).toBe('human');
      for (const shape of [1_000_000.5, true, {}]) {
        writeSettings({ env: { [WINDOW_KEY]: shape } });
        expect(resetHarnessThreshold({ thresholdLocation: location }).window.ownership).toBe(
          'human'
        );
        expect(envBlock()[WINDOW_KEY]).toEqual(shape);
      }
    });

    it('when digits are padded with SPACES, should accept the trimmed plain spelling', () => {
      // given: `1000000` wrapped in spaces — the environment can carry padding
      // when: the rollback runs
      // then: REMOVED, exactly as the bare digits are. This pins the TRIM in the
      //       spelling predicate: an untrimmed matcher rejects the padded form
      //       and keeps a pair peaks-loop demonstrably wrote.
      writeSettings({
        env: { [WINDOW_KEY]: ' 1000000 ', [HARNESS_WINDOW_WRITTEN_KEY]: ' 1000000 ' }
      });
      const result = resetHarnessThreshold({ thresholdLocation: location });
      expect(result.window.ownership).toBe('peaks');
      expect(envBlock()[WINDOW_KEY]).toBeUndefined();
      expect(envBlock()[HARNESS_WINDOW_WRITTEN_KEY]).toBeUndefined();
    });

    it('when the marker is `0`, should keep the value — in the spelling but never a write', () => {
      // given: marker `0` beside a plain 1000000 value
      // when: the rollback runs
      // then: KEPT. `String(0)` could be emitted, but the writer's own band gate
      //       refuses 0, so a `0` marker cannot be peaks-loop's record of a
      //       window it wrote. The readable-but-unwritable marker arm decides
      //       this; without it the marker would parse to 0, differ from the
      //       value, and the pair would still be `human` — which is why the
      //       control matters: the same `0` beside a `0` VALUE is the arm that
      //       would have been `peaks` without it.
      writeSettings({ env: { [WINDOW_KEY]: '1000000', [HARNESS_WINDOW_WRITTEN_KEY]: '0' } });
      expect(resetHarnessThreshold({ thresholdLocation: location }).window.ownership).toBe('human');
      writeSettings({ env: { [WINDOW_KEY]: '0', [HARNESS_WINDOW_WRITTEN_KEY]: '0' } });
      const result = resetHarnessThreshold({ thresholdLocation: location });
      expect(result.window.ownership).toBe('human');
      expect(envBlock()[WINDOW_KEY]).toBe('0');
    });
  });
});

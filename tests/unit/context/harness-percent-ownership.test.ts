// tests/unit/context/harness-percent-ownership.test.ts
//
// The OWNERSHIP + GATES half of the harness auto-compact THRESHOLD percent —
// split out of `harness-compact-threshold-config.test.ts`, which would have
// crossed the 500-line cap for `tests/**` if it carried these too.
//
//   - src/services/context/harness-percent-ownership.ts  (parse, predicates,
//     five-state classifier, the state read)
//   - src/services/context/harness-percent-gates.ts      (why a write must not
//     happen, and in what order)
//
// The property under test: "peaks-loop wrote this percent" is answered by ONE
// predicate for the writer and a deliberately WIDER one for `--reset`. The two
// must not be the same rule — a probe must never overwrite a human's
// unreadable pin, while `--reset` is the documented remedy for exactly that
// shape — and the gate order must report the first true reason rather than a
// later, less specific one.
//
// Dimensions covered:
//   - render:      the classifier's five names and the gate reasons
//   - behavior:    each predicate's truth table, including the absent sides
//   - integration: the state read against a real settings file
//   - a11y:        the reason a refusal reports (it is what the notice prints)

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  HARNESS_PERCENT_WRITTEN_KEY,
  isHarnessPercentRemovable,
  parseHarnessCompactPercent,
  percentOwnershipOf,
  readHarnessPercentState,
  readSettingsObject,
  syncHarnessPercent,
  type HarnessCompactThresholdLocation
} from '~/src/services/context/harness-compact-threshold-config';
import {
  describeHarnessCompactThreshold,
  ensureHarnessCompactThreshold
} from '~/src/services/context/harness-compact-threshold-ensure';
import { SKIP_UNCHANGED, percentSkipReason } from '~/src/services/context/harness-percent-gates';

declareDimensions('tests/unit/context/harness-percent-ownership.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const WINDOW_KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';
const PERCENT_KEY = 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE';

describe('harness percent — ownership predicates and gates', () => {
  let root = '';
  let location: HarnessCompactThresholdLocation;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-percent-ownership-'));
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

  describe('(render) parseHarnessCompactPercent — the plain-spelling anchors', () => {
    it('when digits are wrapped or padded, should accept only the whole anchored spelling', () => {
      // given: `80a`, `a80`, `8a0`, and a single digit `5`
      // when: the parser runs
      // then: none of the padded forms is accepted, while `5` is. Each of the
      //       three rejected forms passes one of the four anchor-relaxed
      //       spellings (`/\d+$/`, `/^\d+/`, `/^\d$/`) — an unanchored
      //       matcher would let a hand edit or another tool masquerade as
      //       peaks-loop's own output, which is exactly what provenance must
      //       not allow.
      for (const padded of ['80a', 'a80', '8a0', '5.0', '80.,', ' 8 0 ']) {
        expect(parseHarnessCompactPercent(padded)).toBeNull();
      }
      expect(parseHarnessCompactPercent('5')).toBe(5);
    });

    it('when the raw value is a JSON NUMBER, should accept it without string coercion', () => {
      // given: env blocks are string-valued, but a hand-edited or programmatic
      //        writer can put a number in
      // when: the parser runs
      // then: an in-band integer is accepted and an out-of-band one is not.
      //       The number branch is separate from the string branch: coercing
      //       it through `Number(raw)` would still work here, but skipping the
      //       band check on that branch would accept `0` and `101`.
      expect(parseHarnessCompactPercent(80)).toBe(80);
      expect(parseHarnessCompactPercent(0)).toBeNull();
      expect(parseHarnessCompactPercent(101)).toBeNull();
      expect(parseHarnessCompactPercent(80.5)).toBeNull();
    });
  });

  describe('(behavior) isHarnessPercentRemovable — the rollback’s wider rule', () => {
    it('when either side is absent, should be false — a hole proves nothing', () => {
      // given: the three shapes with a side missing
      // when: the rollback's predicate runs
      // then: none is removable. A marker without a value is `stale-marker`
      //       (the marker is cleaned up, the value cannot be), a value without
      //       a marker is a human's own setting, and neither is an ownership
      //       claim — falling through to the comparison would report the
      //       marker-only shape as peaks-loop's and delete the marker's owner.
      expect(isHarnessPercentRemovable({ fileRaw: undefined, markerRaw: '80' })).toBe(false);
      expect(isHarnessPercentRemovable({ fileRaw: '80', markerRaw: undefined })).toBe(false);
      expect(isHarnessPercentRemovable({ fileRaw: undefined, markerRaw: undefined })).toBe(false);
    });

    it('when the marker is unreadable beside a readable value, should be false', () => {
      // given: value 80, marker `abc`
      // when: the rollback's predicate runs
      // then: false — "both parse, but the marker does not match" is not the
      //       same fact as "the marker proves peaks-loop wrote this", and a
      //       marker that does not parse is no evidence at all
      expect(isHarnessPercentRemovable({ fileRaw: '80', markerRaw: 'abc' })).toBe(false);
    });

    it('when both sides are unreadable and IDENTICAL, should be false — an unparseable marker proves nothing (MED-1)', () => {
      // given: `eighty` typed into both slots — the reproduction a human makes by
      //        hand-editing the value and then the marker to the same typo
      // when: the rollback's predicate runs
      // then: false. peaks-loop writes only `String(n)` as its marker, so an
      //       unparseable marker is by definition NOT one of its writes, and the
      //       pair is the user's. The old "both raws equal ⇒ corrupted peaks
      //       write" arm classified it `peaks-corrupt` and `--reset` DELETED the
      //       user's value — the exact failure the "no marker ⇒ human" rule
      //       promises cannot happen.
      expect(isHarnessPercentRemovable({ fileRaw: 'eighty', markerRaw: 'eighty' })).toBe(false);
      expect(percentOwnershipOf({ fileRaw: 'eighty', markerRaw: 'eighty' })).toBe('human');
    });

    it('when a garbled value sits beside a VALID numeric marker, should be true — the recovery the feature needs', () => {
      // given: `eighty` where peaks-loop wrote 80 (its marker still parses)
      // when: the rollback's predicate runs
      // then: removable — the CONTROL for the MED-1 case above. A valid marker is
      //       peaks-loop's own write mangled afterwards, so `--reset` must still
      //       clear it or the documented typo recovery stops working.
      expect(isHarnessPercentRemovable({ fileRaw: 'eighty', markerRaw: '80' })).toBe(true);
      expect(isHarnessPercentRemovable({ fileRaw: 'eighty', markerRaw: 'abc' })).toBe(false);
    });
  });

  describe('(render) percentOwnershipOf — the five states, named once', () => {
    it('when both sides are absent, should report none', () => {
      // given: an empty percent slot
      // when: the classifier runs
      // then: `none` — the one state that says peaks-loop has nothing to undo
      expect(percentOwnershipOf({ fileRaw: undefined, markerRaw: undefined })).toBe('none');
    });

    it('when the value was deleted by hand, should report stale-marker', () => {
      // given: a surviving marker beside an absent value
      // when: the classifier runs
      // then: `stale-marker`, not `none` — the marker IS peaks content and must
      //       be cleaned up, or a later human value would inherit the claim
      expect(percentOwnershipOf({ fileRaw: undefined, markerRaw: '80' })).toBe('stale-marker');
    });

    it('when the value matches its marker, should report peaks', () => {
      // given: peaks-loop's own 80 and the marker it wrote in the same write
      // when: the classifier runs
      // then: `peaks` — the CONTROL for `peaks-corrupt` below, so the corrupt
      //       state is not simply "a marker is present"
      expect(percentOwnershipOf({ fileRaw: '80', markerRaw: '80' })).toBe('peaks');
    });

    it('when the marker parses but the value does not, should report peaks-corrupt', () => {
      // given: `eighty` where peaks-loop wrote 80
      // when: the classifier runs
      // then: `peaks-corrupt` — reported as REMOVED by `--reset`, because the
      //       user did not type it and calling it theirs would send them
      //       looking for a value they never wrote
      expect(percentOwnershipOf({ fileRaw: 'eighty', markerRaw: '80' })).toBe('peaks-corrupt');
    });

    it('when a human pin parses beside a different marker, should report human', () => {
      // given: marker 80, value 65, and the reverse direction as a control
      // when: the classifier runs
      // then: `human` — a parseable value that differs from its parseable marker
      //       is a takeover, whichever side is larger
      expect(percentOwnershipOf({ fileRaw: '65', markerRaw: '80' })).toBe('human');
      expect(percentOwnershipOf({ fileRaw: '90', markerRaw: '80' })).toBe('human');
      expect(percentOwnershipOf({ fileRaw: 'eighty', markerRaw: 'abc' })).toBe('human');
    });
  });

  describe('(behavior) MED — the spelling predicate rejects values peaks-loop cannot write', () => {
    it('when a value carries a leading zero beyond a lone `0`, should refuse it as a spelling peaks-loop cannot write', () => {
      // given: `080` beside a marker of `80`, and bare `0`
      // when: the parser and the classifier run
      // then: `080` / `00080` do NOT parse as a percent — `String(80)` never
      //       emits a leading zero — so `080` can never compare equal to the
      //       marker and be classified `peaks` (the old /^\d+$/ let a hand-typed
      //       `080` masquerade as peaks-loop's own 80 and be overwritten). Bare
      //       `0` IS a spelling peaks-loop can emit, but it is out of band, so it
      //       is a corruption rather than a usable value.
      expect(parseHarnessCompactPercent('080')).toBeNull();
      expect(parseHarnessCompactPercent('00080')).toBeNull();
      // `0` is out of band, so BOTH rows fail to parse; a null marker proves
      // nothing, so MED-1's corrected rule classifies the pair `human` (kept).
      // peaks-loop's own writer can never emit `0` — the band gate refuses it —
      // so this pair is by definition not peaks-loop's output.
      expect(percentOwnershipOf({ fileRaw: '0', markerRaw: '0' })).toBe('human');
      expect(percentOwnershipOf({ fileRaw: '080', markerRaw: '80' })).not.toBe('peaks');
    });

    it('when the file value has a leading zero, should refuse to overwrite it as if peaks wrote it', () => {
      // given: the exact fixture the reviewer measured — `080` beside marker `80`
      // when: a probe asks for 80
      // then: the value is NOT peaks-loop's own (`not-peaks-owned`), so it is
      //       left in the file rather than silently rewritten. The old
      //       `/^\d+$/` accepted `080`, parsed it to 80, compared equal to the
      //       marker and overwrote a value it never wrote.
      writeSettings({ env: { [PERCENT_KEY]: '080', [HARNESS_PERCENT_WRITTEN_KEY]: '80' } });
      const result = syncHarnessPercent({ location, percent: 80 });
      expect(result.action).toBe('skipped');
      expect(result.reason).toBe('not-peaks-owned');
      expect(envBlock()[PERCENT_KEY]).toBe('080');
    });
  });

  describe('(render) the persisted key name is the cross-release contract', () => {
    it('when the marker key is read, should be the documented env var name', () => {
      // given: the marker constant a later release must still recognise
      // when: its value is read
      // then: the exact name. This is a PERSISTED key — a release that renamed
      //       or emptied it would stop recognising the markers every earlier
      //       release wrote, and would then treat peaks-loop's own values as a
      //       human's pins forever.
      expect(HARNESS_PERCENT_WRITTEN_KEY).toBe('PEAKS_HARNESS_PERCENT_WRITTEN');
    });
  });

  describe('(integration) readHarnessPercentState — what the state report shows', () => {
    it('when the file holds a peaks-written percent, should report the value and its ownership', () => {
      // given: the pair peaks-loop wrote
      // when: the percent half is read for the state report
      // then: the key, the raw text, the parsed number and `peaks`
      writeSettings({ env: { [PERCENT_KEY]: '80', [HARNESS_PERCENT_WRITTEN_KEY]: '80' } });
      expect(readHarnessPercentState(location.settingsPath, PERCENT_KEY)).toEqual({
        key: PERCENT_KEY,
        rawNote: 'the number 80',
        percent: 80,
        ownership: 'peaks'
      });
    });

    it('when the file does not exist, should report an empty slot rather than throw', () => {
      // given: a project whose settings file was never created
      // when: the percent half is read
      // then: absent, with no percent and nothing of peaks-loop's
      expect(readHarnessPercentState(location.settingsPath, PERCENT_KEY)).toEqual({
        key: PERCENT_KEY,
        percent: null,
        ownership: 'none'
      });
    });
  });

  describe('(a11y) the gates — the reason a refusal reports', () => {
    it('when a HUMAN `150` is refused, should advise the user, not --reset which keeps it (HIGH-3)', () => {
      // given: a no-marker `150` — out of band, but the user's own value
      // when: init reconciles and renders the refusal
      // then: the advice is "you set this, change it yourself". The old notice
      //       said "`--reset` to clear it", and `--reset` answered "Kept … your
      //       own setting" — advice the rollback refuses to carry out.
      writeSettings({ env: { [PERCENT_KEY]: '150' } });
      const result = ensureHarnessCompactThreshold({ location, env: {} });
      expect(result.percent.reason).toBe('out-of-range');
      const sentence = describeHarnessCompactThreshold(result);
      expect(sentence).toContain('outside the 1..100 percent');
      expect(sentence).not.toContain('--reset');
      expect(sentence).toContain('yours');
      expect(sentence).toContain(PERCENT_KEY);
    });

    it('HIGH-3 control: when a PEAKS-OWNED typo is refused, should still point at --reset', () => {
      // given: `eighty` beside peaks-loop's own marker — the corruption --reset
      //        DOES remove (the documented recovery)
      // when: init reconciles
      // then: `--reset` is named, because for this ownership it is the remedy
      writeSettings({ env: { [PERCENT_KEY]: 'eighty', [HARNESS_PERCENT_WRITTEN_KEY]: '80' } });
      const result = ensureHarnessCompactThreshold({ location, env: {} });
      expect(result.percent.ownership).toBe('peaks-corrupt');
      expect(describeHarnessCompactThreshold(result)).toContain('--reset');
    });
    it('when the caller asks for no percent over a readable value, should say no-percent-resolved', () => {
      // given: a file holding a valid 65 while this call carries no number
      // when: the gates run
      // then: `no-percent-resolved` — "the caller passed nothing", which is a
      //       different fact from "the file holds something unreadable", and
      //       the file's value is still reported as the previous one
      writeSettings({ env: { [PERCENT_KEY]: '65' } });
      expect(syncHarnessPercent({ location, percent: null })).toMatchObject({
        action: 'skipped',
        reason: 'no-percent-resolved',
        previousPercent: 65
      });
    });

    it('when the file holds a whole number outside the band, should say out-of-range', () => {
      // given: `150`, as a JSON number and as text
      // when: the gates classify it with no value offered
      // then: `out-of-range` for both — 150 IS a percentage, and calling it
      //       "not a percentage" hands the user the wrong remedy
      writeSettings({ env: { [PERCENT_KEY]: 150 } });
      expect(syncHarnessPercent({ location, percent: null }).reason).toBe('out-of-range');
      writeSettings({ env: { [PERCENT_KEY]: '150' } });
      expect(syncHarnessPercent({ location, percent: null }).reason).toBe('out-of-range');
    });

    it('when the file holds a shape that is not a whole number, should say unreadable', () => {
      // given: an OBJECT in the slot, the fractional spelling `80.5`, and the
      //        float/signed spellings `80.0` / `+80` / `00080`
      // when: the gates classify each with no value offered
      // then: `unreadable-percent` for all. The object is the case that would
      //       throw if the test assumed a string; `80.5` separates "is a
      //       number" from "is a WHOLE number"; and `80.0`/`+80` are not numbers
      //       in the plain spelling this module writes at all — the old
      //       `Number(raw)` coercion called them whole numbers "outside the
      //       1..100 band", which points at the wrong remedy.
      writeSettings({ env: { [PERCENT_KEY]: {} } });
      expect(syncHarnessPercent({ location, percent: null }).reason).toBe('unreadable-percent');
      for (const spelling of ['80.5', '80.0', '+80', '00080']) {
        writeSettings({ env: { [PERCENT_KEY]: spelling } });
        expect(syncHarnessPercent({ location, percent: null }).reason).toBe('unreadable-percent');
      }
    });

    it('N7: when the whole number is PADDED with whitespace, should still read it as out of band', () => {
      // given: `' 150 '` — a whole number outside the band, surrounded by the
      //        whitespace an env block or a hand edit can carry
      // when: the gates classify it with no value offered
      // then: `out-of-range`, the same answer the bare `150` gets. This is the
      //       arm that pins the TRIM: the plain-spelling regex is anchored
      //       (`^…$`), so a matcher run on the untrimmed text rejects a padded
      //       whole number and reports `unreadable-percent` — telling the user
      //       their `150` is "not a percentage", which is false, when the only
      //       problem is the spaces around it.
      writeSettings({ env: { [PERCENT_KEY]: ' 150 ' } });
      expect(syncHarnessPercent({ location, percent: null }).reason).toBe('out-of-range');
      // and: the in-band control — a padded `80` is a number too, so it must
      //      NOT be reported as unreadable: it answers `no-percent-resolved`
      //      ("the file already holds a percentage; this call offered none")
      writeSettings({ env: { [PERCENT_KEY]: ' 80 ' } });
      expect(syncHarnessPercent({ location, percent: null }).reason).toBe('no-percent-resolved');
    });

    it('when the settings file’s env block is null, should treat it as empty and not throw', () => {
      // given: `"env": null` — a shape the harness itself cannot read
      // when: a percent is synced and the gates read the opt-out row from it
      // then: the write proceeds over a fresh env object. A null dereference
      //       here would crash every probe on a file another tool mangled.
      writeSettings({ env: null });
      const settings = readSettingsObject(location.settingsPath);
      expect(
        percentSkipReason({
          location,
          percent: 80,
          settings,
          fileRaw: undefined,
          filePercent: null,
          peakWritten: false
        })
      ).toBeNull();
      expect(syncHarnessPercent({ location, percent: 80 }).action).toBe('written');
      expect(envBlock()).toEqual({ [PERCENT_KEY]: '80', [HARNESS_PERCENT_WRITTEN_KEY]: '80' });
    });
  });

  describe('(behavior) the gate order decides before the provenance rule', () => {
    it('when the wanted value is already on disk, should return the unchanged sentinel', () => {
      // given: peaks-loop's own 80 and a request for the same 80
      // when: the gates run
      // then: the sentinel, one value no refusal reason can equal — the caller
      //       branches on it to report `unchanged` rather than a refusal
      writeSettings({ env: { [PERCENT_KEY]: '80', [HARNESS_PERCENT_WRITTEN_KEY]: '80' } });
      const settings = readSettingsObject(location.settingsPath);
      expect(
        percentSkipReason({
          location,
          percent: 80,
          settings,
          fileRaw: '80',
          filePercent: 80,
          peakWritten: true
        })
      ).toBe(SKIP_UNCHANGED);
      // and: the sentinel is a value no refusal reason can equal — the caller
      //      distinguishes "write nothing, report unchanged" from a refusal by
      //      exactly this comparison
      expect(SKIP_UNCHANGED).not.toBe(
        percentSkipReason({
          location,
          percent: null,
          settings,
          fileRaw: '80',
          filePercent: 80,
          peakWritten: true
        })
      );
    });
  });

  describe('(behavior) MED-4 — ensure is fail-soft when the write itself throws', () => {
    it('when `.claude` is a regular FILE, should report a skip and not throw', () => {
      // given: `.claude` exists as a regular file, so the sync's
      //        `mkdirSync(dirname(...), { recursive: true })` throws EEXIST —
      //        the comment claimed "nothing throws", which was false
      // when: ensure reconciles
      // then: it returns a result with an `unreadable-settings` skip instead of
      //       raising into `peaks workspace init`
      const fileRoot = mkdtempSync(join(tmpdir(), 'peaks-ensure-throw-'));
      const blocked = join(fileRoot, '.claude');
      writeFileSync(blocked, 'not a directory', 'utf8');
      try {
        const result = ensureHarnessCompactThreshold({
          location: {
            settingsPath: join(blocked, 'settings.local.json'),
            envVar: WINDOW_KEY,
            percentEnvVar: PERCENT_KEY,
            projectRoot: fileRoot
          },
          env: {}
        });
        expect(result.window.action).toBe('skipped');
        expect(result.window.reason).toBe('unreadable-settings');
        expect(result.percent.action).toBe('skipped');
        expect(result.percent.reason).toBe('unreadable-settings');
      } finally {
        rmSync(fileRoot, { recursive: true, force: true });
      }
    });
  });
});

// tests/unit/context/harness-compact-threshold-verdict.test.ts
//
// The READ half of the harness auto-compact THRESHOLD pair — split out of
// `harness-compact-threshold-config.test.ts` when that file crossed the
// 500-line cap for `tests/**`.
//
// The property under test: the running session's configuration and the project
// file's configuration are two different facts (the harness reads its env once,
// at process start), so a write that landed on disk must be REPORTED as not yet
// in force — with the numbers on both sides, and with a typo rendered as the
// typo rather than as "unset".
//
// Dimensions covered:
//   - render:      the restart line's wording and the verdict's shape
//   - behavior:    matches=true / false in both directions, absent vs unparseable
//   - integration: a real settings file read by the real reader
//   - a11y:        the sentence names both sides and is a statement, not a question

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  resolveHarnessCompactThresholdLocation,
  type HarnessCompactThresholdLocation
} from '~/src/services/context/harness-compact-threshold-config';
import {
  buildHarnessThresholdVerdict,
  describeHarnessThresholdRestart,
  readHarnessCompactThreshold
} from '~/src/services/context/harness-compact-threshold-verdict';
import { _resetAdaptersForTesting, _setAdapterForTesting } from '~/src/services/ide/ide-registry';
import { CLAUDE_CODE_ADAPTER } from '~/src/services/ide/adapters/claude-code-adapter';

declareDimensions('tests/unit/context/harness-compact-threshold-verdict.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const WINDOW_KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';
const PERCENT_KEY = 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE';

describe('harness-compact-threshold — read half', () => {
  let root = '';
  let location: HarnessCompactThresholdLocation = {
    settingsPath: '',
    envVar: WINDOW_KEY,
    percentEnvVar: PERCENT_KEY
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-harness-threshold-read-'));
    location = {
      settingsPath: join(root, '.claude', 'settings.local.json'),
      envVar: WINDOW_KEY,
      percentEnvVar: PERCENT_KEY,
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

  describe('(behavior) read — the verdict compares the FILE against this session', () => {
    it('when the env and the file agree, should report matches=true and no restart line', () => {
      // given: a project configured at 250000 × 80 and a session that captured it
      // when: the verdict is read
      // then: it matches, and there is nothing to restart for
      writeSettings({ env: { [WINDOW_KEY]: '250000', [PERCENT_KEY]: '80' } });
      const read = readHarnessCompactThreshold({
        location,
        env: { [WINDOW_KEY]: '250000', [PERCENT_KEY]: '80' }
      });
      expect(read.matches).toBe(true);
      expect(read.configured).toEqual({ windowTokens: 250_000, percent: 80 });
      expect(read.inForce).toEqual({ windowTokens: 250_000, percent: 80 });
      expect(describeHarnessThresholdRestart(read)).toBeNull();
      expect(buildHarnessThresholdVerdict(read)).toMatchObject({
        windowTokens: 250_000,
        percent: 80
      });
    });

    it('when the session is STALE, should report matches=false and demand a restart', () => {
      // given: the file now says 250000 × 80, but this session captured 1M × unset
      // when: the verdict is read
      // then: it reports BOTH pairs and the restart, driven by the numbers
      writeSettings({ env: { [WINDOW_KEY]: '250000', [PERCENT_KEY]: '80' } });
      const read = readHarnessCompactThreshold({
        location,
        env: { [WINDOW_KEY]: '1000000' }
      });
      expect(read.matches).toBe(false);
      const notice = describeHarnessThresholdRestart(read);
      expect(notice).toContain('250000 tokens × 80%');
      expect(notice).toContain('1000000 tokens × unset%');
      expect(notice).toContain('Restart');
      expect(notice).toContain(location.settingsPath);
    });

    it('when the FILE is stale, should report matches=false in that direction too', () => {
      // given: the file still says 250000 × 80 while the session runs 1M × 60
      // when: the verdict is read
      // then: the same false verdict, with the two pairs swapped
      writeSettings({ env: { [WINDOW_KEY]: '250000', [PERCENT_KEY]: '80' } });
      const read = readHarnessCompactThreshold({
        location,
        env: { [WINDOW_KEY]: '1000000', [PERCENT_KEY]: '60' }
      });
      expect(read.matches).toBe(false);
      expect(read.configured).toEqual({ windowTokens: 250_000, percent: 80 });
      expect(read.inForce).toEqual({ windowTokens: 1_000_000, percent: 60 });
    });

    it('when the file configures nothing, should not invent a disagreement from an outer env layer', () => {
      // given: no keys on disk, and an env supplied by an outer settings layer
      // when: the verdict is read
      // then: there is nothing on disk to apply, so nothing is "not in force"
      writeSettings({ env: {} });
      const read = readHarnessCompactThreshold({
        location,
        env: { [WINDOW_KEY]: '1000000', [PERCENT_KEY]: '50' }
      });
      expect(read.matches).toBe(true);
      expect(read.configured).toEqual({ windowTokens: null, percent: null });
    });

    it('when the file says a percent that is not one, should not render it as "unset"', () => {
      // given: a hand-typed `eighty` on disk and a session whose env carries none
      // when: the restart line is composed
      // then: the FILE side says what the file actually says, so the line cannot
      //       read "configures … × unset%, but the running session uses … × unset%"
      writeSettings({ env: { [WINDOW_KEY]: '250000', [PERCENT_KEY]: 'eighty' } });
      const read = readHarnessCompactThreshold({ location, env: { [WINDOW_KEY]: '250000' } });
      const notice = describeHarnessThresholdRestart(read) ?? '';
      expect(read.matches).toBe(false);
      expect(notice).toContain('a value that is not a number (6 chars, not echoed here)');
      expect(notice).not.toContain('eighty');
      expect(notice).toContain('not a percentage');
      // and: the two sides no longer render identically
      expect(notice).not.toContain('unset%, but the running session uses 250000 tokens × unset%');
    });
    it('when the file is silent on a knob, should name only the knob it configures (N6)', () => {
      // given: the control for the case above — an ABSENT percent, not a typo
      // when: the restart line is composed
      // then: the line is about the window, because a percent the project never
      //       set is not something the session failed to apply. The old
      //       `250000 tokens × unset%` framing described a knob the file does not
      //       own, and on the OTHER side it read `unset × unset%`.
      writeSettings({ env: { [WINDOW_KEY]: '250000' } });
      const read = readHarnessCompactThreshold({ location, env: { [WINDOW_KEY]: '1000000' } });
      const notice = describeHarnessThresholdRestart(read);
      expect(notice).toContain('configures 250000 tokens');
      expect(notice).toContain('running session uses 1000000 tokens');
      expect(notice).not.toContain('unset');
    });

    it('when the file configures ONLY the percent, should not render an unset window (N6)', () => {
      // given: the exact shape N6 measured — a percent-only file whose session
      //        has not picked it up
      // when: the restart line is composed
      // then: it speaks in percent terms only, on BOTH sides
      writeSettings({ env: { [PERCENT_KEY]: '80' } });
      const read = readHarnessCompactThreshold({ location, env: {} });
      const notice = describeHarnessThresholdRestart(read);
      expect(notice).toContain('configures 80%');
      // The session genuinely has no percent, so `unset%` about IT is true; what
      // must not appear is an `unset tokens` window the project never configured.
      expect(notice).not.toContain('unset tokens');
      expect(notice).not.toContain('×');
    });

    it('when the file configures an unreadable WINDOW, should render the typo on the file side', () => {
      // given: `500k` as the window and a valid 80 percent, so BOTH halves are
      //        configured and the pair form is used
      // when: the restart line is composed
      // then: the window side quotes the typo with its own unit-specific
      //       reason. Substituting the percent's `not a percentage` here would
      //       describe the wrong knob, and a bare `unset tokens` would hide a
      //       value the user actually typed.
      writeSettings({ env: { [WINDOW_KEY]: '500k', [PERCENT_KEY]: '80' } });
      const read = readHarnessCompactThreshold({ location, env: {} });
      const notice = describeHarnessThresholdRestart(read);
      expect(read.matches).toBe(false);
      expect(notice).toContain(
        'a value that is not a number (4 chars, not echoed here) (not a token count) tokens × 80%'
      );
      expect(notice).not.toContain('500k');
      expect(notice).not.toContain('not a percentage');
    });

    it('when the file configures an unreadable WINDOW only, should use the window-only form', () => {
      // given: `500k` with no percent at all — the `halves.window` branch
      // when: the restart line is composed
      // then: the single window clause, and no `×` pair for a knob the file
      //       never configured
      writeSettings({ env: { [WINDOW_KEY]: '500k' } });
      const notice = describeHarnessThresholdRestart(
        readHarnessCompactThreshold({ location, env: {} })
      );
      expect(notice).toContain(
        'configures a value that is not a number (4 chars, not echoed here) (not a token count) tokens'
      );
      expect(notice).not.toContain('500k');
      expect(notice).not.toContain('×');
    });

    it('when an unreadable file value and an unreadable session value differ, should still report a mismatch', () => {
      // given: `eighty` on disk and `ninety` in a session that captured it
      // when: the verdict is read
      // then: matches=false with BOTH sides rendered as the bounded note. Both
      //       sides parse to null, so a comparison on the parsed numbers alone
      //       would call this agreement and let a session run a threshold the
      //       file no longer says. The two sides are no longer distinguished by
      //       content (MED-2: the line reaches stdout, so neither typo is
      //       echoed) — only by being present on each side of the sentence.
      writeSettings({ env: { [PERCENT_KEY]: 'eighty' } });
      const read = readHarnessCompactThreshold({
        location,
        env: { [PERCENT_KEY]: 'ninety' }
      });
      const notice = describeHarnessThresholdRestart(read);
      expect(read.matches).toBe(false);
      // both sides carry the bounded note (MED-2), so the sentence shows the
      // contention without echoing either value
      expect(
        (notice ?? '').match(
          /a value that is not a number \(6 chars, not echoed here\) \(not a percentage\)/g
        )
      ).toHaveLength(2);
      expect(notice).not.toContain('eighty');
      expect(notice).not.toContain('ninety');
    });

    it('when the file configures a window and the session carries an unreadable percent, should render each side’s own raw', () => {
      // given: the file at 250000 with NO percent, and a session whose percent
      //        is the typo `ninety` — so the file's halves are window-only
      //       while the session's raw percent must still be named
      // when: the restart line is composed
      // then: the window-only form is used, and the session side does NOT
      //       borrow the file's absent percent. `halvesConfiguredBy` is
      //       computed from the FILE, and each side renders from its own raw;
      //       swapping them would print the file's window where the session's
      //       percent belongs.
      writeSettings({ env: { [WINDOW_KEY]: '250000' } });
      const notice = describeHarnessThresholdRestart(
        readHarnessCompactThreshold({ location, env: { [WINDOW_KEY]: '1000000' } })
      );
      expect(notice).toContain('configures 250000 tokens');
      expect(notice).toContain('running session uses 1000000 tokens');
      expect(notice).not.toContain('%');
    });

    it('when the file configures BOTH halves and the session agrees on the window, should render the full pair on both sides', () => {
      // given: the file at 250000 × 80 and a session with the same window but
      //        no percent — the pair form, and a session side whose percent is
      //       genuinely absent
      // when: the restart line is composed
      // then: both sides use `N tokens × P%`, and the session's absent percent
      //       renders as `unset%` — not as the FILE's 80, which would claim
      //       the session already honours a value it never captured
      writeSettings({ env: { [WINDOW_KEY]: '250000', [PERCENT_KEY]: '80' } });
      const notice = describeHarnessThresholdRestart(
        readHarnessCompactThreshold({ location, env: { [WINDOW_KEY]: '250000' } })
      );
      expect(notice).toContain('configures 250000 tokens × 80%');
      expect(notice).toContain('running session uses 250000 tokens × unset%');
    });
  });

  describe('(render) the verdict — a result built WITHOUT raw values', () => {
    /**
     * A hand-built read result: the shape's other producer, as the interface
     * documents (`raw` is `undefined` "on a result built without the raw
     * values"). It is not a test-only fiction — the type says it exists.
     */
    function readWithoutRaw(
      configured: { readonly windowTokens: number | null; readonly percent: number | null },
      inForce: { readonly windowTokens: number | null; readonly percent: number | null }
    ): Parameters<typeof describeHarnessThresholdRestart>[0] {
      return {
        settingsPath: location.settingsPath,
        windowKey: WINDOW_KEY,
        percentKey: PERCENT_KEY,
        configured,
        inForce,
        matches: false
      };
    }

    it('when a result with BOTH halves configured carries no raw values, should render the pair without throwing', () => {
      // given: a result with no `raw` field and both halves parsed
      // when: the restart line is composed
      // then: the `N tokens × P%` form on both sides. This is the pair branch
      //       reached with `raw === undefined`, so every `raw?.x` in it must
      //       stay optional: dereferencing `raw.windowRaw` here throws, and a
      //       consumer with no raw values would get a crash instead of the
      //       restart line.
      const notice = describeHarnessThresholdRestart(
        readWithoutRaw(
          { windowTokens: 250_000, percent: 80 },
          { windowTokens: 1_000_000, percent: 60 }
        )
      );
      expect(notice).toContain('configures 250000 tokens × 80%');
      expect(notice).toContain('running session uses 1000000 tokens × 60%');
    });

    it('when a result with a window only carries no raw values, should use the window clause', () => {
      // given: a no-raw result whose window parses and whose percent is null
      // when: the restart line is composed
      // then: the window-only form — `halves.window` must be read from the
      //       PARSED window, and the absent percent must not be dereferenced
      //       as `raw.percentRaw`. This is also what stops a file that
      //       configures only the window from being described as unconfigured.
      const notice = describeHarnessThresholdRestart(
        readWithoutRaw(
          { windowTokens: 250_000, percent: null },
          { windowTokens: null, percent: null }
        )
      );
      expect(notice).toContain('configures 250000 tokens');
      expect(notice).toContain('running session uses unset tokens');
      expect(notice).not.toContain('%');
    });

    it('when a result carries no raw values and configures only the percent, should use the percent clause', () => {
      // given: a no-raw result whose percent parses and whose window is null
      // when: the restart line is composed
      // then: the percent-only form, and no `×` pair for a window the file
      //       does not configure
      const notice = describeHarnessThresholdRestart(
        readWithoutRaw({ windowTokens: null, percent: 80 }, { windowTokens: null, percent: 60 })
      );
      expect(notice).toContain('configures 80%');
      expect(notice).toContain('running session uses 60%');
      expect(notice).not.toContain('×');
    });
  });

  describe('(render) buildHarnessThresholdVerdict — the envelope field', () => {
    it('when the envelope verdict is built, should report the CONFIGURED pair at the top level', () => {
      // given: a file at 250000 × 80 and a session at 1M × unset
      // when: the envelope verdict is built
      // then: top-level `windowTokens`/`percent` are the FILE's, `inForce` is
      //       the session's, and `matches` rides through unchanged — a
      //       consumer reading the top level gets "what the project says"
      //       without a second read
      writeSettings({ env: { [WINDOW_KEY]: '250000', [PERCENT_KEY]: '80' } });
      const read = readHarnessCompactThreshold({ location, env: { [WINDOW_KEY]: '1000000' } });
      expect(buildHarnessThresholdVerdict(read)).toEqual({
        windowTokens: 250_000,
        percent: 80,
        configured: { windowTokens: 250_000, percent: 80 },
        inForce: { windowTokens: 1_000_000, percent: null },
        matches: false
      });
    });
  });

  describe('(behavior) location — both keys come from the adapter', () => {
    it('when the adapter declares both knobs, should build the path and keys from its declarations', () => {
      // given: a fake adapter whose declarations name a different file and keys
      // when: the location is resolved
      // then: every half came from the adapter — no IDE name or key literal here
      const shipped = CLAUDE_CODE_ADAPTER.compact;
      if (shipped === undefined) throw new Error('claude-code must declare a compact profile');
      _setAdapterForTesting('claude-code', {
        ...CLAUDE_CODE_ADAPTER,
        settings: {
          ...CLAUDE_CODE_ADAPTER.settings,
          dirName: '.fakeide',
          localSettingsFileName: 'settings.local.json'
        },
        compact: {
          ...shipped,
          autoCompactWindowEnvVar: 'FAKEIDE_WINDOW',
          autoCompactPercentEnvVar: 'FAKEIDE_PCT'
        }
      });
      expect(resolveHarnessCompactThresholdLocation({ projectRoot: root })).toEqual({
        settingsPath: join(root, '.fakeide', 'settings.local.json'),
        envVar: 'FAKEIDE_WINDOW',
        percentEnvVar: 'FAKEIDE_PCT',
        projectRoot: root
      });
    });

    it('when the adapter declares no percent knob, should resolve nothing', () => {
      // given: an adapter with a window knob but no percent knob
      // when: the location is resolved
      // then: null, so there is no write and no invented key
      _setAdapterForTesting('claude-code', {
        ...CLAUDE_CODE_ADAPTER,
        compact: {
          envVarForContextPercent: 'PEAKS_TEST_CONTEXT_PCT',
          compactCommand: 'claude --compact',
          compactPathway: 'ide-native',
          autoCompactWindowEnvVar: 'FAKEIDE_WINDOW'
        }
      });
      expect(resolveHarnessCompactThresholdLocation({ projectRoot: root })).toBeNull();
    });

    it('when the shipped claude-code adapter is asked, should declare the percent key', () => {
      // given: the real registry entry (the control for the two cases above)
      // when: its declaration is read
      // then: it exists, and it is the documented variable
      expect(CLAUDE_CODE_ADAPTER.compact?.autoCompactPercentEnvVar).toBe(PERCENT_KEY);
    });

    it('when the env names another IDE, should resolve THAT adapter’s file and keys', () => {
      // given: `TRAE_CLI` in the env and a fake trae adapter declaring both
      //        knobs under its own names
      // when: the location is resolved from that env
      // then: every half comes from the SELECTED adapter, not from the
      //       claude-code default. Reading `process.env` instead of the
      //       caller's env would resolve the claude-code file here, and
      //       reading the window key in place of the percent key would report
      //       the same variable twice.
      const shipped = CLAUDE_CODE_ADAPTER.compact;
      if (shipped === undefined) throw new Error('claude-code must declare a compact profile');
      _setAdapterForTesting('trae', {
        ...CLAUDE_CODE_ADAPTER,
        settings: {
          ...CLAUDE_CODE_ADAPTER.settings,
          dirName: '.trae',
          localSettingsFileName: 'settings.local.json'
        },
        compact: {
          ...shipped,
          autoCompactWindowEnvVar: 'TRAE_WINDOW',
          autoCompactPercentEnvVar: 'TRAE_AUTOCOMPACT_PCT'
        }
      });
      expect(
        resolveHarnessCompactThresholdLocation({ projectRoot: root, env: { TRAE_CLI: '1' } })
      ).toEqual({
        settingsPath: join(root, '.trae', 'settings.local.json'),
        envVar: 'TRAE_WINDOW',
        percentEnvVar: 'TRAE_AUTOCOMPACT_PCT',
        projectRoot: root
      });
    });

    it('when the adapter declares no machine-local settings layer, should fall back to the shared file name', () => {
      // given: an adapter with BOTH knobs but no machine-local layer
      // when: the location is resolved
      // then: the shared `settingsFileName` is used, not `undefined`. Without
      //       the fallback the path would end in "undefined" and a write
      //       would create a new file beside the real one.
      const shipped = CLAUDE_CODE_ADAPTER.compact;
      if (shipped === undefined) throw new Error('claude-code must declare a compact profile');
      const { localSettingsFileName: _omit, ...sharedLayerOnly } = CLAUDE_CODE_ADAPTER.settings;
      void _omit;
      _setAdapterForTesting('claude-code', {
        ...CLAUDE_CODE_ADAPTER,
        settings: { ...sharedLayerOnly, dirName: '.sharedide', settingsFileName: 'settings.json' },
        compact: {
          ...shipped,
          autoCompactWindowEnvVar: 'SHARED_WINDOW',
          autoCompactPercentEnvVar: 'SHARED_PCT'
        }
      });
      expect(resolveHarnessCompactThresholdLocation({ projectRoot: root, env: {} })).toEqual({
        settingsPath: join(root, '.sharedide', 'settings.json'),
        envVar: 'SHARED_WINDOW',
        percentEnvVar: 'SHARED_PCT',
        projectRoot: root
      });
    });

    it('when the adapter declares no compact profile at all, should resolve nothing', () => {
      // given: an adapter with no `compact` field at all — the shape every
      //        shipped adapter except claude-code carries
      // when: the location is resolved
      // then: null, rather than a throw from reading through `undefined`. The
      //       `?.` on the profile is load-bearing for those adapters.
      const { compact: _omit, ...withoutCompact } = CLAUDE_CODE_ADAPTER;
      void _omit;
      _setAdapterForTesting('claude-code', withoutCompact);
      expect(resolveHarnessCompactThresholdLocation({ projectRoot: root, env: {} })).toBeNull();
    });
  });
});

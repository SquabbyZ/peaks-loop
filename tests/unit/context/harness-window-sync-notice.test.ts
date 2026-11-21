// tests/unit/context/harness-window-sync-notice.test.ts
//
// The T4 RENDER arms for the harness window — split out of
// `harness-window-config.test.ts` when that file crossed the 500-line tests cap.
//
// The property under test: a refused write is NOT automatically a non-event. The
// two notices below are the whole remedy for a state peaks-loop deliberately
// refuses to fix by writing, so each must name the concrete numbers, the file,
// and the way out — `Harness window not managed (not-peaks-owned).` was true and
// told the reader nothing.
//
// Dimensions covered:
//   - render:      describeHarnessWindowSync / harnessWindowSyncWarning wording
//   - behavior:    which result shape reaches each branch, quiet cases included
//   - integration: the results rendered come from real read-modify-writes
//
// Dimensions omitted:
//   - a11y:        the CLI renders these results; asserted in the CLI tests

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  describeHarnessWindowSync,
  harnessWindowSyncWarning,
  syncHarnessWindow,
  type HarnessWindowLocation
} from '~/src/services/context/harness-window-config';

declareDimensions(
  'tests/unit/context/harness-window-sync-notice.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'the CLI renders these results; asserted in the CLI tests' }]
);

const KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';

/** A settings file shaped like the real one: a third-party env key + hooks. */
function existingSettings(): Record<string, unknown> {
  return { env: { GATEGUARD_EXEMPT_GLOBS: '.peaks/**' } };
}

describe('harness-window-config — the sync notices', () => {
  let root = '';
  let location: HarnessWindowLocation = { settingsPath: '', envVar: KEY };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-harness-window-notice-'));
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

  it('when the probe divided by a different window than the file pins, should name BOTH numbers and the file', () => {
    // given: a human-pinned 150000 in the file and a probe that resolved 500000
    // when: the sync refuses to overwrite the human's value
    // then: the notice names both numbers and the file, so a reader can say
    //       which two things disagree, and offers the three ways out
    writeSettings({ env: { [KEY]: '150000' } });
    const result = syncHarnessWindow({ location, tokens: 500_000, env: {} });
    expect(result).toMatchObject({
      action: 'skipped',
      reason: 'not-peaks-owned',
      previousTokens: 150_000,
      requestedTokens: 500_000,
      peakWritten: false
    });
    const notice = describeHarnessWindowSync(result);
    expect(notice).toContain('500000');
    expect(notice).toContain('150000');
    expect(notice).toContain(location.settingsPath);
    expect(notice).toContain('CONFLICT');
    expect(notice).toContain('does not describe when it fires');
    expect(notice).toContain('PEAKS_CONTEXT_WINDOW_TOKENS');
    expect(notice).toContain('context.windowTokens');
    expect(notice).toContain('peaks compact harness-window --reset');
    // and: the machine channel carries the same disagreement
    const warning = harnessWindowSyncWarning(result);
    expect(warning).toContain('500000');
    expect(warning).toContain('150000');
    expect(warning).toContain(location.settingsPath);
  });

  it('when there is no disagreement to report, should emit NO warning (the quiet case stays quiet)', () => {
    // given: a window in force that peaks-loop wrote, and the same value asked for
    // when: the probe re-syncs the identical number
    // then: nothing to warn about — a probe that disagrees with nothing must not
    //       become noise on every tool call
    writeSettings(existingSettings());
    syncHarnessWindow({ location, tokens: 200_000, env: {} });
    const unchanged = syncHarnessWindow({ location, tokens: 200_000, env: {} });
    expect(unchanged.action).toBe('unchanged');
    expect(harnessWindowSyncWarning(unchanged)).toBeNull();
    // and: an absent knob is not a warning either
    expect(harnessWindowSyncWarning(null)).toBeNull();
  });

  it('when the file value is not a token count at all, should say so WITHOUT echoing it, and give the way out', () => {
    // given: a hand-typed `500k` — `previousTokens` is null for this, exactly as
    //        for an ABSENT key, so only the raw value's PRESENCE tells them apart
    // when: the sync runs
    // then: the notice says the slot holds an unreadable value and how long it
    //       is, and gives both ways out — never the content (MED-2: the sentence
    //       reaches stdout/logs and the value is arbitrary user input)
    writeSettings({ env: { [KEY]: '500k' } });
    const result = syncHarnessWindow({ location, tokens: 500_000, env: {} });
    expect(result).toMatchObject({
      action: 'skipped',
      reason: 'not-peaks-owned',
      previousTokens: null,
      previousRawNote: 'a value that is not a number (4 chars, not echoed here)',
      requestedTokens: 500_000
    });
    const notice = describeHarnessWindowSync(result);
    expect(notice).toContain('not a plain token count');
    expect(notice).toContain('not echoed here');
    expect(notice).not.toContain('500k');
    expect(notice).toContain('cannot align');
    expect(notice).toContain('peaks compact harness-window --reset');
    // and: there is no numeric CONFLICT clause — there is no number to be
    //      inconsistent WITH, which is precisely why this case needed its own
    expect(notice).not.toContain('CONFLICT');
    const warning = harnessWindowSyncWarning(result) ?? '';
    expect(warning).toContain('not echoed here');
    expect(warning).not.toContain('500k');
  });

  it('when a legacy value is in force with no marker, should say it is not peaks-loop-managed and how to hand it back', () => {
    // given: 200000 with no marker — the shape every project installed by a
    //        pre-marker release is left in
    // when: the probe asks for exactly that number
    // then: `unchanged`, but the notice says peaks-loop will never raise it and
    //       names the ordered way back
    writeSettings({ env: { [KEY]: '200000' } });
    const result = syncHarnessWindow({ location, tokens: 200_000, env: {} });
    expect(result.action).toBe('unchanged');
    expect(result.peakWritten).toBe(false);
    const notice = describeHarnessWindowSync(result);
    expect(notice).toContain('NOT peaks-loop');
    expect(notice).toContain('will never raise it');
    expect(notice).toContain('peaks compact harness-window --reset');
    expect(notice).toContain('peaks compact harness-window --reenable');
    // and: the two sides AGREE here, so no warning rides this one
    expect(harnessWindowSyncWarning(result)).toBeNull();
  });

  it('when peaks-loop is the writer, should keep the plain "already in force" sentence', () => {
    // given: peaks-loop's own window
    // when: the same number is asked for again
    // then: the short sentence stands — the ownership caveat is false here
    writeSettings(existingSettings());
    syncHarnessWindow({ location, tokens: 200_000, env: {} });
    const result = syncHarnessWindow({ location, tokens: 200_000, env: {} });
    expect(result.peakWritten).toBe(true);
    expect(describeHarnessWindowSync(result)).toBe(
      `Harness window ${KEY} already in force; peaks-loop computes this ratio against it.`
    );
  });

  it('when a write lands, should report the file as peaks-written (the marker the write armed)', () => {
    // given: an empty slot
    // when: the sync fills it
    // then: `peakWritten` describes the state AFTER the call — the write is what
    //       armed the marker, so the pre-write read could only say false
    writeSettings(existingSettings());
    const result = syncHarnessWindow({ location, tokens: 200_000, env: {} });
    expect(result.action).toBe('written');
    expect(result.peakWritten).toBe(true);
    expect(readSettings()['env']).toMatchObject({ [KEY]: '200000' });
  });
});

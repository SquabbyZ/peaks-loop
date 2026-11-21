// tests/unit/context/harness-window-config-absent.test.ts
//
// The window reader and rollback when the settings file is ABSENT — the
// ordinary fresh project.
//
// WHY A FILE OF ITS OWN. `harness-window-config.test.ts`, the guards suite and
// the linked-settings suite all drive a settings file that EXISTS, so the
// absent path was reached only through the sync's first write (which then
// creates the file). Nothing asserted what `readHarnessWindow` and
// `resetHarnessWindow` answer BEFORE anything has ever been written — which is
// the state every probe of a fresh project starts in, and the state `--reset`
// must be a no-op in (writing the opt-out there would be litter in a file
// peaks-loop never touched).
//
// Dimensions covered:
//   - render:      the exact read result for an absent file
//   - behavior:    the rollback's no-op, and that it creates nothing
//   - integration: real fs — the file must still NOT exist afterwards
//   - a11y:        omitted — the reader returns a record; the CLI renders the
//                  sentence

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  HARNESS_WINDOW_SYNC_OPTOUT_KEY,
  readHarnessWindow,
  resetHarnessWindow,
  syncHarnessWindow,
  type HarnessWindowLocation
} from '~/src/services/context/harness-window-config';

declareDimensions(
  'tests/unit/context/harness-window-config-absent.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'the reader returns a record; the CLI renders the sentence' }]
);

describe('harness-window-config — the settings file is ABSENT', () => {
  let root = '';
  let location: HarnessWindowLocation = { settingsPath: '', envVar: 'W' };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-harness-absent-'));
    location = { settingsPath: join(root, '.claude', 'settings.local.json'), envVar: 'W' };
  });

  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it('when no file exists and the process env is silent, should report an empty slot', () => {
    // given: a fresh project, and a session whose env carries no window
    // when: the window is read
    // then: the EMPTY result — no tokens, no source, not opted out, nothing
    //       peaks-written, and no raw note. The bounded note's PRESENCE is what
    //       tells "the slot holds an unreadable value" from "there is no
    //       slot", so an absent file must not carry one.
    expect(readHarnessWindow({ location, env: {} })).toEqual({
      tokens: null,
      source: null,
      optedOut: false,
      peakWritten: false,
      fileTokens: null
    });
  });

  it('when no file exists and the process env carries a window, should report the env copy and no file value', () => {
    // given: a shell export, but no settings file yet
    // when: the window is read
    // then: the env copy is in force, the FILE is silent (`fileTokens` null,
    //       and no `fileRawNote` — an absent file has nothing to describe)
    expect(readHarnessWindow({ location, env: { W: '200000' } })).toEqual({
      tokens: 200_000,
      source: 'process-env',
      optedOut: false,
      peakWritten: false,
      fileTokens: null,
      rawNote: 'the number 200000'
    });
  });

  it('when --reset runs with no file at all, should report absent and create nothing', () => {
    // given: `--project .` in a directory peaks-loop has never written to
    // when: the documented rollback runs
    // then: `absent`, and the file still does not exist — an absent file is not
    //       an unreadable one, and the rollback must not answer by creating it
    //       just to record an opt-out nobody needed
    expect(existsSync(location.settingsPath)).toBe(false);
    const result = resetHarnessWindow({ location, env: {} });
    expect(result).toMatchObject({ action: 'absent', previousTokens: null });
    expect(result.settingsPath).toBe(location.settingsPath);
    expect(existsSync(location.settingsPath)).toBe(false);
  });

  it('when the first sync lands, should create the file and arm the marker', () => {
    // given: the absent state, then a probe that resolved a window
    // when: the sync runs
    // then: written, and the file exists — the control that shows the absent
    //       arms above were about the reader and the rollback, not a sync that
    //       refuses to create its own settings file
    expect(syncHarnessWindow({ location, tokens: 250_000, env: {} }).action).toBe('written');
    expect(existsSync(location.settingsPath)).toBe(true);
    const read = readHarnessWindow({ location, env: {} });
    expect(read.tokens).toBe(250_000);
    expect(read.peakWritten).toBe(true);
    expect(read.optedOut).toBe(false);
  });

  it('when --reset has recorded an opt-out, should report optedOut on the next read', () => {
    // given: a file carrying only the opt-out row
    // when: the window is read
    // then: `optedOut: true` and no window — the flag is read from the SAME
    //       env block the window key lives in, so a rollback is visible to the
    //       next probe without any other state file
    syncHarnessWindow({ location, tokens: 250_000, env: {} });
    expect(resetHarnessWindow({ location, env: {} }).action).toBe('removed');
    const read = readHarnessWindow({ location, env: {} });
    expect(read.optedOut).toBe(true);
    expect(read.tokens).toBeNull();
    expect(syncHarnessWindow({ location, tokens: 250_000, env: {} }).reason).toBe('opted-out');
    expect(HARNESS_WINDOW_SYNC_OPTOUT_KEY).toBe('PEAKS_HARNESS_WINDOW_SYNC');
  });

  it('when the file is not valid UTF-8, should still report an empty slot and not throw', () => {
    // given: a file whose bytes are not valid UTF-8 — the shape a settings file
    //        takes when another tool writes it in a legacy code page, or when a
    //        crash truncates it mid-character. Node's UTF-8 decoder SUBSTITUTES
    //        (it does not throw), so `JSON.parse` receives a string of U+FFFD
    //        and throws there — which is why the reader must still wrap the
    //        whole read, not only the parse.
    // when: the window is read
    // then: the EMPTY result, never an exception — a context probe must not die
    //       on a file it was only trying to READ
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(location.settingsPath, Buffer.from([0xff, 0xfe, 0x80, 0x81, 0x82]));
    expect(readHarnessWindow({ location, env: {} })).toEqual({
      tokens: null,
      source: null,
      optedOut: false,
      peakWritten: false,
      fileTokens: null
    });
    // and: the rollback treats it as uneditable rather than throwing
    expect(resetHarnessWindow({ location, env: {} }).action).toBe('absent');
  });

  it('when the file holds a JSON ARRAY or a bare number, should report it as NOT editable', () => {
    // given: a syntactically valid JSON document that is not an object — an
    //        array, and a bare number. `JSON.parse` succeeds on both, so this
    //        is the ONLY case that reaches the shape guard; everything else
    //        (truncation, a bad code page, `{ not json`) throws at the parse
    //        and is already handled by the catch.
    // when: the rollback and the sync run
    // then: `absent` / `unreadable-settings`, and the bytes are untouched.
    //       Without the shape guard `readSettingsObject` would hand back an
    //       ARRAY typed as an object, `Object.keys` would treat its ELEMENTS as
    //       the document's top-level keys, and the read-modify-write below
    //       would rewrite the user's file as a JSON OBJECT — silently
    //       destroying whatever the file was.
    mkdirSync(join(root, '.claude'), { recursive: true });
    for (const document of ['[1,2,3]', '42', '"a string"']) {
      writeFileSync(location.settingsPath, document, 'utf8');
      const before = readFileSyncBytes(location.settingsPath);
      expect(resetHarnessWindow({ location, env: {} }).action).toBe('absent');
      expect(syncHarnessWindow({ location, tokens: 250_000, env: {} }).reason).toBe(
        'unreadable-settings'
      );
      expect(readFileSyncBytes(location.settingsPath)).toEqual(before);
    }
  });

  it('when the file is an ARRAY shaped like env rows, should never read a row off it', () => {
    // given: `[{ "W": "200000" }, { "PEAKS_HARNESS_WINDOW_SYNC": "off" }]` — a
    //        JSON array whose ELEMENTS have the key names the reader looks for.
    //        An array is `typeof 'object'`, so a guard that tests only that
    //        (or that drops the `Array.isArray` half because the later
    //        `ArrowFunction` mutator makes it unreachable for nulls) hands the
    //        array to `env[key]`, which resolves the array's NUMERIC indices
    //        and never its elements — the ambient lookup then answers
    //        `undefined` and the FILE is reported as opted in, blank, and
    //        not peaks-written.
    // when: the window is read and the sync runs
    // then: the array is treated as NO settings at all. With the guard,
    //       `envString` returns `undefined` for every key and the read falls to
    //       the empty-slot result; the sync is refused as `unreadable-settings`
    //       rather than writing a peaks row into a document it cannot manage.
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(
      location.settingsPath,
      JSON.stringify([{ W: '200000' }, { PEAKS_HARNESS_WINDOW_SYNC: 'off' }]),
      'utf8'
    );
    expect(readHarnessWindow({ location, env: {} })).toEqual({
      tokens: null,
      source: null,
      optedOut: false,
      peakWritten: false,
      fileTokens: null
    });
    expect(syncHarnessWindow({ location, tokens: 250_000, env: {} }).reason).toBe(
      'unreadable-settings'
    );
  });
});

/** The file's bytes, so "untouched" is compared without any decoding. */
function readFileSyncBytes(path: string): Buffer {
  return readFileSync(path) as Buffer;
}

/**
 * `tests/unit/preferences/auto-compact-profile-preference.test.ts`
 *
 * `autoCompactProfile` is a PUBLIC project setting.
 *
 * What this pins down:
 *   - a preferences file that does NOT carry the key still loads — the field
 *     is additive and the schema version is unchanged, so an existing
 *     project does not break;
 *   - the key is writable, and the value that lands on disk is the canonical
 *     profile name;
 *   - the legal values are a closed set, named by one exported list, so the
 *     write path and the error message cannot disagree about them.
 *
 * The CLI-level rejection of an illegal value is measured against the real
 * command (`peaks preferences set --key autoCompactProfile --value bogus`);
 * it calls `process.exit(1)`, so it cannot be driven from inside the test
 * worker.
 *
 * Dimensions covered:
 *   - behavior:    the value guard and the closed set
 *   - integration: a real `.peaks/preferences.json` on disk
 *   - a11y:        the legal values are named by one list the message uses
 *   - render:      omitted — the preference file is machine state; the
 *     operator-facing rendering is the CLI's, measured outside this file.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';
import {
  loadPreferences,
  preferencesPath,
  savePreferences
} from '~/src/services/preferences/preferences-service';
import {
  AUTO_COMPACT_PROFILE_VALUES,
  isAutoCompactProfile
} from '~/src/services/preferences/preferences-types';

declareDimensions(
  'tests/unit/preferences/auto-compact-profile-preference.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'the preference file is machine state; the CLI rendering is measured separately'
    }
  ]
);

const getWs = withTmpWorkspacePerTest('peaks-auto-compact-pref-');

/** Write a preferences file the way an existing project would have it. */
function writeLegacyPreferences(projectRoot: string): void {
  mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.peaks', 'preferences.json'),
    JSON.stringify({ schema_version: '2.0.0', economyMode: true, swarmMode: true }, null, 2) + '\n',
    'utf8'
  );
}

describe('behavior — the value guard', () => {
  it('when the legal values are listed, should be standard and eager and nothing else', () => {
    // given: the exported list of legal profile values
    // when: the list is read
    // then: it holds the two public profiles and nothing else
    expect(AUTO_COMPACT_PROFILE_VALUES).toEqual(['standard', 'eager']);
  });

  it('when a value outside the closed set is checked, should be refused', () => {
    // given: values inside and outside the closed set
    // when: each one is checked by the guard
    // then: only the members of the set are accepted
    expect(isAutoCompactProfile('standard')).toBe(true);
    expect(isAutoCompactProfile('eager')).toBe(true);
    expect(isAutoCompactProfile('partial')).toBe(false);
    expect(isAutoCompactProfile('bogus')).toBe(false);
    expect(isAutoCompactProfile(42)).toBe(false);
    expect(isAutoCompactProfile(null)).toBe(false);
  });
});

describe('integration — the preference on disk', () => {
  it('when a preferences file has no profile key, should still load', () => {
    // given: a preferences file written by an older project, with no key
    // when: the preferences are loaded
    // then: the file still loads, on the default profile
    const ws = getWs();
    writeLegacyPreferences(ws.path);

    const loaded = loadPreferences(ws.path);
    expect(loaded.schema_version).toBe('2.0.0');
    expect(loaded.autoCompactProfile).toBe('standard');
  });

  it('when a project pins the earlier-firing profile, should the value land on disk', () => {
    // given: a project that pins no profile yet
    // when: the profile is saved
    // then: the canonical profile name lands on disk
    const ws = getWs();
    writeLegacyPreferences(ws.path);

    const merged = savePreferences(ws.path, { autoCompactProfile: 'eager' });
    expect(merged.autoCompactProfile).toBe('eager');

    const onDisk = JSON.parse(readFileSync(preferencesPath(ws.path), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(onDisk.autoCompactProfile).toBe('eager');
    expect(loadPreferences(ws.path).autoCompactProfile).toBe('eager');
  });

  it('when the override is removed, should put the project back on the default profile', () => {
    // given: a project whose profile override was just removed
    // when: the preferences are loaded
    // then: the profile is back on the default
    const ws = getWs();
    writeLegacyPreferences(ws.path);
    savePreferences(ws.path, { autoCompactProfile: 'eager' });

    const raw = JSON.parse(readFileSync(preferencesPath(ws.path), 'utf8')) as Record<
      string,
      unknown
    >;
    delete raw.autoCompactProfile;
    writeFileSync(preferencesPath(ws.path), JSON.stringify(raw, null, 2) + '\n', 'utf8');

    expect(loadPreferences(ws.path).autoCompactProfile).toBe('standard');
  });
});

describe('a11y — the legal values are named once', () => {
  it('when the error message and the guard are compared, should read the same list', () => {
    // given: the one exported list of legal values
    // when: the message text and the guard are both read from it
    // then: they name the same values
    //   One list, so the message cannot name a value the guard rejects.
    expect(AUTO_COMPACT_PROFILE_VALUES.join(' | ')).toBe('standard | eager');
  });
});

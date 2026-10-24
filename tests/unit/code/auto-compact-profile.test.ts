/**
 * `tests/unit/code/auto-compact-profile.test.ts`
 *
 * The auto-compact profile is a PUBLIC choice, resolved in one order.
 *
 * What this pins down:
 *   - an explicit `--mode` beats the project setting (one call, one override);
 *   - the project setting `autoCompactProfile` beats the default;
 *   - with neither, the profile is `standard`;
 *   - the 24h long-run mode does NOT take part — a 24h project with no
 *     project setting resolves to `standard`, not to the earlier thresholds.
 *
 * Dimensions covered:
 *   - behavior:    the resolution order and the source label
 *   - integration: a real `.peaks/preferences.json` on disk
 *   - render:      the resolved record carries the profile and its source
 *   - a11y:        omitted — the resolver produces a record, not human text;
 *     the wording lives in `auto-compact-modes.test.ts`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';
import {
  readAutoCompactProfilePreference,
  resolveAutoCompactProfile
} from '~/src/services/code/auto-compact-profile';

declareDimensions(
  'tests/unit/code/auto-compact-profile.test.ts',
  ['behavior', 'integration', 'render'],
  [
    {
      dim: 'a11y',
      reason: 'the resolver returns a record; the wording is asserted in the modes test'
    }
  ]
);

const getWs = withTmpWorkspacePerTest('peaks-auto-compact-profile-');

/** Write a project preferences file with the given extra keys. */
function writePreferences(projectRoot: string, body: Record<string, unknown>): void {
  mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.peaks', 'preferences.json'),
    JSON.stringify({ schema_version: '2.0.0', ...body }, null, 2) + '\n',
    'utf8'
  );
}

describe('behavior — the resolution order', () => {
  it('when the project pins nothing, should resolve the standard profile', () => {
    // given: a project that pins no profile anywhere
    // when: the profile is resolved
    // then: it is the standard one, and the source is the default
    const ws = getWs();
    const resolved = resolveAutoCompactProfile({ projectRoot: ws.path });
    expect(resolved.profile).toBe('standard');
    expect(resolved.source).toBe('default');
  });

  it('when no mode is named on the command line, should the project setting decide', () => {
    // given: a project that pins the eager profile, and no mode argument
    // when: the profile is resolved
    // then: the project setting is the source of the answer
    const ws = getWs();
    writePreferences(ws.path, { autoCompactProfile: 'eager' });

    const resolved = resolveAutoCompactProfile({ projectRoot: ws.path });
    expect(resolved.profile).toBe('eager');
    expect(resolved.source).toBe('preference');
  });

  it('when an explicit mode is named, should beat the project setting for that one call', () => {
    // given: a project that pins the eager profile
    // when: one call names an explicit mode
    // then: the explicit mode wins, and the source says so
    const ws = getWs();
    writePreferences(ws.path, { autoCompactProfile: 'eager' });

    const resolved = resolveAutoCompactProfile({ projectRoot: ws.path, cliMode: 'standard' });
    expect(resolved.profile).toBe('standard');
    expect(resolved.source).toBe('cli');
  });

  it('when a 24h project pins no setting, should keep the standard thresholds', () => {
    // given: a 24h project that pins no profile setting
    // when: the profile is resolved
    // then: the 24h state machine is not consulted, so the default stands
    //   The 24h state machine used to be one of the two sources of the
    //   profile. It is not a source any more, so the resolution never reads
    //   it — the profile of a project that pinned nothing is `standard`.
    const ws = getWs();
    const resolved = resolveAutoCompactProfile({ projectRoot: ws.path });
    expect(resolved.profile).toBe('standard');
    expect(resolved.source).toBe('default');
  });
});

describe('integration — the preference is read from the project file', () => {
  it('when the preference file has no key, should leave the profile on the default', () => {
    // given: a preferences file that carries no profile key
    // when: the preference is read
    // then: there is none, and the profile stays on the default
    const ws = getWs();
    writePreferences(ws.path, { economyMode: true });

    expect(readAutoCompactProfilePreference(ws.path)).toBeNull();
    expect(resolveAutoCompactProfile({ projectRoot: ws.path }).profile).toBe('standard');
  });

  it('when the preference file names the legacy alias, should read the eager one', () => {
    // given: a preferences file whose profile key is the legacy alias
    // when: the preference is read
    // then: it is the eager profile the alias means
    const ws = getWs();
    writePreferences(ws.path, { autoCompactProfile: 'partial' });

    expect(readAutoCompactProfilePreference(ws.path)).toBe('eager');
    expect(resolveAutoCompactProfile({ projectRoot: ws.path }).profile).toBe('eager');
  });

  it('when the preferences file cannot be read, should leave the project on the default', () => {
    // given: a preferences file this build cannot parse
    // when: the preference is read
    // then: there is none, and the project stays on the default
    const ws = getWs();
    mkdirSync(join(ws.path, '.peaks'), { recursive: true });
    writeFileSync(join(ws.path, '.peaks', 'preferences.json'), '{ not json', 'utf8');

    expect(readAutoCompactProfilePreference(ws.path)).toBeNull();
    expect(resolveAutoCompactProfile({ projectRoot: ws.path }).profile).toBe('standard');
  });
});

describe('render — the resolved record', () => {
  it('when the profile is resolved, should the record carry the profile and its source', () => {
    // given: a project that pins the eager profile
    // when: the profile is resolved
    // then: the record carries the profile and the source it came from
    const ws = getWs();
    writePreferences(ws.path, { autoCompactProfile: 'eager' });

    const resolved = resolveAutoCompactProfile({ projectRoot: ws.path });
    expect(Object.keys(resolved).sort()).toEqual(['profile', 'source']);
    expect(resolved.profile).toBe('eager');
    expect(resolved.source).toBe('preference');
  });
});

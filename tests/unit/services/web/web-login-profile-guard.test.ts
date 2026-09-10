// tests/unit/services/web/web-login-profile-guard.test.ts
//
// The name guard half of `web-login-profile.ts` (tech-doc §7.2 rule 1, AC1):
// `resolveProfileName` plus the two path resolvers it anchors. Split out of
// `web-login-profile.test.ts` when the S4 repair round pushed that file past the
// 800-line scan limit — the split is along the module's own seam: this file is
// pure and needs no browser fake, no HOME redirect and no fixture, while the
// login RUN (fake chromium, real fs writes under a redirected HOME) stays there.
//
// Nothing here touches the filesystem: every assertion is a string comparison or
// a throw. `homedir()` is read for path COMPOSITION only (`webProfileDir`,
// `loginStorageStatePath`), never written to, so no tmp HOME is needed and the
// developer's own `~/.peaks/web-profiles/` cannot be reached from this file.
//
// Dimensions covered:
//   - behavior:    the accept/reject verdict of every name shape, and the fold
//   - a11y:        the refusal text a human reads (bounded, code said once)
//   - render:      OMITTED — no stdout/JSON surface; the refusal text is the
//                  only output and is asserted under a11y
//   - integration: OMITTED — no fs/subprocess/network/clock boundary

import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/web/web-login-profile-guard.test.ts',
  ['behavior', 'a11y'],
  [
    { dim: 'render', reason: 'returns a name or throws; the refusal text is asserted under a11y' },
    { dim: 'integration', reason: 'string comparisons and throws only — no fs, env, clock or subprocess boundary' },
  ],
);

import {
  loginStorageStatePath,
  resolveProfileName,
  webProfileDir
} from '../../../../src/services/web/web-login-profile.js';

describe('behavior — the profile name guard', () => {
  it('when a valid name is resolved, should land under the profile root', () => {
    // given: a plain name
    // when:  the path resolvers run
    // then:  both land under <home>/.peaks/web-profiles/<name>/
    expect(resolveProfileName('work')).toBe('work');
    expect(webProfileDir('work')).toBe(join(homedir(), '.peaks', 'web-profiles', 'work'));
    expect(loginStorageStatePath('work')).toBe(
      join(homedir(), '.peaks', 'web-profiles', 'work', 'storageState.json'),
    );
  });

  it('when a name is outside the charset or traverses, should reject it', () => {
    // given: every shape the guard exists for
    const rejected = [
      '..',
      '.',
      '../escape',
      '/etc/passwd',
      'C:\\Windows',
      'a'.repeat(65),
      'has space',
      'back\\slash',
      '',
      'semi;colon',
    ];
    // when:  each is resolved
    // then:  each throws WEB_PROFILE_NAME_INVALID rather than returning a path
    for (const name of rejected) {
      expect(() => resolveProfileName(name), name).toThrow(/WEB_PROFILE_NAME_INVALID/);
    }
  });

  it('when the caller types an upper-case name, should fold it to the canonical name', () => {
    // given: the case variants NTFS/APFS fold onto ONE directory
    // when:  each is resolved
    // then:  each resolves to the name they all mean — one profile, not an alias
    //        that silently shares `work`'s cookies under a second spelling
    expect(resolveProfileName('Work')).toBe('work');
    expect(resolveProfileName('WORK')).toBe('work');
    expect(resolveProfileName('Work.Profile')).toBe('work.profile');
    expect(resolveProfileName('My_Profile-1')).toBe('my_profile-1');
    // The path is the same one, so `Work` and `work` read and write one profile.
    expect(loginStorageStatePath('Work')).toBe(loginStorageStatePath('work'));
    expect(webProfileDir(resolveProfileName('Work'))).toBe(webProfileDir('work'));
  });

  it('when a name ends in a dot or a space, should reject it rather than trim it', () => {
    // given: the shapes Windows normalises away, so they have no stable
    //        canonical form and the fold cannot produce one
    const rejected = ['work.', 'Work.', 'work '];
    // when:  each is resolved
    // then:  each is refused — the fold handles case, not trailing punctuation
    for (const name of rejected) {
      expect(() => resolveProfileName(name), name).toThrow(/WEB_PROFILE_NAME_INVALID/);
    }
  });

  it('when a name is a Windows device name, should reject it', () => {
    // given: the reserved set, including the NAME.ext form (`con.json` is the
    //        device too) — a profile there silently persists nothing
    const rejected = ['con', 'prn', 'aux', 'nul', 'com1', 'lpt9', 'con.json', 'aux.txt'];
    // when:  each is resolved
    // then:  each is refused
    for (const name of rejected) {
      expect(() => resolveProfileName(name), name).toThrow(/WEB_PROFILE_NAME_INVALID/);
    }
  });

  it('when a name begins with a dot, should reject it deliberately and not by accident', () => {
    // given: a leading dot makes the device-name stem empty — `.con` is the
    //        Windows device under a name the stem test cannot see, and `..foo`
    //        is a dot segment the charset accepts (`assertUnder` caught that one
    //        by accident, under the wrong code) — security S6
    const rejected = ['.con', '..con', '..foo', '.'];
    for (const name of rejected) {
      // then:  the refusal is the guard's own, not the path containment check's
      expect(() => resolveProfileName(name), name).toThrow(/^WEB_PROFILE_NAME_INVALID:/);
      expect(() => resolveProfileName(name), name).not.toThrow(/WEB_PATH_ESCAPE/);
    }
  });
});

describe('a11y — the refusal a human reads', () => {
  it('when an oversized invalid name is refused, should not echo it whole', () => {
    // given: a 500-character name that never passes the charset (it ends in a
    //        space) — the CLI gate path caps its echo, and the guard's refusal
    //        used to reproduce the whole flag (security S6)
    let message = '';
    try {
      resolveProfileName(`${'x'.repeat(499)} `);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    // when:  the refusal text is read
    // then:  it is bounded like the gate's, and still names the failure
    expect(message).toMatch(/^WEB_PROFILE_NAME_INVALID:/);
    expect(message).not.toContain('x'.repeat(100));
  });
});

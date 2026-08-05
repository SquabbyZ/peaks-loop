// tests/unit/services/worktree/playwright-profile.test.ts
//
// 4-dimension unit test for the pure path generator in
// src/services/worktree/playwright-profile.ts. The generator
// returns a deterministic (userDataDir, profileName) pair for a
// (session, dispatch) tuple so concurrent dispatches land in
// separate Chromium profiles.
//
// Dimensions covered:
//   - behavior:   same input -> same output; output contains the
//                 expected segments
//   - integration: not exercised
//   - render:     not applicable (returns structured data)
//   - a11y:       not applicable (no user-visible text)

import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/worktree/playwright-profile.test.ts',
  ['behavior'],
  [
    { dim: 'integration', reason: 'pure function, no fs / subprocess boundary' },
    { dim: 'render', reason: 'returns a structured object, no text surface' },
    { dim: 'a11y', reason: 'no user-visible text or exit code' },
  ],
);

import { playwrightProfilePaths } from '~/src/services/worktree/playwright-profile';

describe("Scenario: behavior — path generator", () => {
  it("when invoked, should returns a user-data-dir under .peaks/_runtime and a deterministic profile name", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = playwrightProfilePaths({ projectRoot: '/r', sessionId: 's1', dispatchId: 'd1' });
    expect(out.userDataDir.replace(/\\/g, '/')).toContain('/.peaks/_runtime/s1/pw-profiles/d1');
    expect(out.profileName).toBe('dispatch-d1');
  });

  it("when invoked, should collision guard: same dispatchId produces the same path", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const a = playwrightProfilePaths({ projectRoot: '/r', sessionId: 's1', dispatchId: 'd1' });
    const b = playwrightProfilePaths({ projectRoot: '/r', sessionId: 's1', dispatchId: 'd1' });
    expect(a).toEqual(b);
  });
});
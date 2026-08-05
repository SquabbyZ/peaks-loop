// tests/unit/services/dispatch/service-shutdown.test.ts
//
// 4-dimension unit test for the pure best-effort service shutdown helper
// in src/services/dispatch/service-shutdown.ts. The helper accepts a
// list of registrations (pid + name) and returns a parallel list of
// kill outcomes — `skipped: not-running` when the pid is invalid, the
// OS-level signal/taskkill otherwise.
//
// Dimensions covered:
//   - behavior:   empty / invalid / platform-shaped inputs map to the
//                 right outcome shape
//   - integration: NOT exercised — execFileSync to taskkill / kill is
//                  best-effort and skipped in unit tests
//   - render:     not applicable (returns structured data, no text surface)
//   - a11y:       not applicable (no user-visible text or exit code)

import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/dispatch/service-shutdown.test.ts',
  ['behavior'],
  [
    { dim: 'integration', reason: 'execFileSync is best-effort; unit tests stay on the skip branches' },
    { dim: 'render', reason: 'returns a structured ServiceKillResult, no text surface' },
    { dim: 'a11y', reason: 'no user-visible text or exit code' },
  ],
);

import { killRegisteredServices } from '~/src/services/dispatch/service-shutdown';

describe("Scenario: behavior — kill shape", () => {
  it("when invoked, should returns an empty array for an empty registration list", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(killRegisteredServices({ registrations: [] })).toEqual([]);
  });

  it("when invoked, should returns skipped: not-running when a pid that does not exist is given on win32", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = killRegisteredServices({
      registrations: [{ pid: 99999, name: 'mock' }],
      platform: 'win32',
    });
    expect(out).toEqual([{ pid: 99999, name: 'mock', skipped: true, reason: 'not-running' }]);
  });

  it("when invoked, should treats pid 0 as not-running without invoking kill", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = killRegisteredServices({
      registrations: [{ pid: 0, name: 'self' }],
      platform: 'linux',
    });
    expect(out[0]).toEqual({ pid: 0, name: 'self', skipped: true, reason: 'not-running' });
  });

  it("when invoked, should preserves the order of registrations", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = killRegisteredServices({
      registrations: [
        { pid: 99998, name: 'a' },
        { pid: 99997, name: 'b' },
      ],
      platform: 'win32',
    });
    expect(out.map((r) => r.name)).toEqual(['a', 'b']);
  });
});
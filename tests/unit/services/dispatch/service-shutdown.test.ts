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
import { HEAVY_SUBPROCESS_TEST_TIMEOUT_MS } from '../../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/services/dispatch/service-shutdown.test.ts',
  ['behavior'],
  [
    {
      dim: 'integration',
      // NOT "skipped in unit tests" — measured 2026-09-19, the win32 branch
      // really does spawn `taskkill`, one real 18.7-28.7 s process per
      // registration that reaches it. That cost is what made this file the
      // source of two `Test timed out in 30000ms` failures; it is why the two
      // spawning tests carry HEAVY_SUBPROCESS_TEST_TIMEOUT_MS. The dimension is
      // still omitted: no describe here tests the SPAWN contract itself (which
      // pid tree, which signal), only the skip/order mapping around it.
      //
      // CLASS C, RE-MEASURED 2026-09-22 (slice B1): one `taskkill /T /F /PID
      // <missing>` now costs 27-155 s, up from the 18.7-28.7 s of S6. This file
      // therefore runs ON its 240 s budget, not under it — the order test
      // measured 223 s green in one run and 287 s red in S16's. The cost is
      // Windows process ENUMERATION (`taskkill /?` costs 1.6 s while the same
      // binary with a PID argument costs up to 155 s; `tasklist` is 23.5 s for
      // the same question; `process.kill(pid, 'SIGKILL')` answers it in 0-1 ms).
      // It is a property of this host, not of this repository, so NO BUDGET
      // HERE CAN HOLD IT and raising the number would only move the failure.
      // The derivation and the four commands that tell a degraded host from an
      // undersized budget are in `tests/unit/_setup/subprocess-timeouts.ts`.
      reason:
        'no integration describe: the real taskkill spawn is incidental to the skip/order assertions'
    },
    { dim: 'render', reason: 'returns a structured ServiceKillResult, no text surface' },
    { dim: 'a11y', reason: 'no user-visible text or exit code' }
  ]
);

import { killRegisteredServices } from '~/src/services/dispatch/service-shutdown';

describe('Scenario: behavior — kill shape', () => {
  it('when invoked, should returns an empty array for an empty registration list', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(killRegisteredServices({ registrations: [] })).toEqual([]);
  });

  it(
    'when invoked, should returns skipped: not-running when a pid that does not exist is given on win32',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: the test setup
      // when:  the function under test is invoked
      // then:  the result matches the expectation
      const out = killRegisteredServices({
        registrations: [{ pid: 99999, name: 'mock' }],
        platform: 'win32'
      });
      expect(out).toEqual([{ pid: 99999, name: 'mock', skipped: true, reason: 'not-running' }]);
    }
  );

  it('when invoked, should treats pid 0 as not-running without invoking kill', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = killRegisteredServices({
      registrations: [{ pid: 0, name: 'self' }],
      platform: 'linux'
    });
    expect(out[0]).toEqual({ pid: 0, name: 'self', skipped: true, reason: 'not-running' });
  });

  it(
    'when invoked, should preserves the order of registrations',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: the test setup
      // when:  the function under test is invoked
      // then:  the result matches the expectation
      const out = killRegisteredServices({
        registrations: [
          { pid: 99998, name: 'a' },
          { pid: 99997, name: 'b' }
        ],
        platform: 'win32'
      });
      expect(out.map((r) => r.name)).toEqual(['a', 'b']);
    }
  );
});

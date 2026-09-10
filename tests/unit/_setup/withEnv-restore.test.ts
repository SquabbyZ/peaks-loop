// tests/unit/_setup/withEnv-restore.test.ts
//
// Focused regression test for the C7 defect in `./io`.
//
// `withEnv` is documented as restoring `process.env[name]` when the current
// test ends. Before the fix it did not: it registered its restore hook with
// `afterEach` from inside the test body, so the mutation outlived the test
// and the next test in the file inherited it. That is a false-pass class —
// a test could pass only because a previous test had leaked the env var it
// depended on.
//
// These tests are deliberately ordered and share one synthetic name, so a
// leaked mutation in test N is observed by test N+1.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withEnv } from './io.js';

const LEAK = 'PEAKS_C7_WITHENV_LEAK_PROBE';
const SEEDED = 'PEAKS_C7_WITHENV_SEEDED_PROBE';

describe('Scenario: withEnv — an env mutation must not outlive its test', () => {
  it('when withEnv sets a var, should expose that value to the current test', () => {
    // given: a synthetic env var that no other test in this file touches
    // when:  withEnv sets it for the duration of this test
    // then:  the current test observes the value it asked for
    withEnv(LEAK, 'set-by-the-first-test');
    expect(process.env[LEAK]).toBe('set-by-the-first-test');
  });

  it('when the previous test used withEnv, should not inherit its leaked value', () => {
    // given: the previous test set the probe var via withEnv and has finished
    // when:  this test reads the probe var
    // then:  the mutation was rolled back at the end of the previous test
    expect(process.env[LEAK]).toBeUndefined();
  });
});

describe('Scenario: withEnv — stacking the same name twice', () => {
  beforeAll(() => {
    process.env[SEEDED] = 'pre-existing';
  });

  afterAll(() => {
    delete process.env[SEEDED];
  });

  it('when the same name is wrapped twice, should expose the innermost value', () => {
    // given: the name already holds a pre-existing value seeded outside withEnv
    // when:  withEnv wraps the same name twice inside one test
    // then:  the innermost assignment is the value visible while the test runs
    withEnv(SEEDED, 'outer');
    withEnv(SEEDED, 'inner');
    expect(process.env[SEEDED]).toBe('inner');
  });

  it('when the stacked wraps unwind, should restore the pre-existing value', () => {
    // given: the previous test wrapped the seeded name twice, then finished
    // when:  this test reads the seeded name
    // then:  each wrap unwound to the value it shadowed, not to a missing entry
    expect(process.env[SEEDED]).toBe('pre-existing');
  });
});

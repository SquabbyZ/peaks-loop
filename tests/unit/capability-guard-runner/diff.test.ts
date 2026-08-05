import { describe, expect, it } from 'vitest';
import { formatHumanReadableDiff } from '~/src/services/capability-guard-runner/diff';

describe("Scenario: formatHumanReadableDiff", () => {
  it("when invoked, should produces a multi-line report naming the broken invariant", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = formatHumanReadableDiff({ before: 'a == 1', after: 'a == 2', reason: 'J03#2 broken' });
    expect(out).toContain('J03#2 broken');
    expect(out).toContain('- a == 1');
    expect(out).toContain('+ a == 2');
  });
});
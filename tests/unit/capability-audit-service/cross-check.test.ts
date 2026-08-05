import { describe, expect, it } from 'vitest';
import { crossCheck } from '~/src/services/capability-audit-service/cross-check';

describe("Scenario: crossCheck", () => {
  it("when invoked, should returns agree when guard and independent agree", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const r = crossCheck({ guardPass: 5, guardFail: 0, independentPass: 5, independentFail: 0, karpathy: 'pass' });
    expect(r.guardVsAudit).toBe('agree');
    expect(r.karpathyVsAudit).toBe('agree');
  });
  it("when invoked, should returns diverge when one says pass and the other says fail", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const r = crossCheck({ guardPass: 3, guardFail: 2, independentPass: 5, independentFail: 0, karpathy: 'pass' });
    expect(r.guardVsAudit).toBe('diverge');
  });
  it("when invoked, should returns partial when sources only partially agree", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    // guardVerdict=fail (guardFail=2>0), indepVerdict=pass (indepFail=0),
    // |guardPass-indepPass|=|2-1|=1 <= 1 => partial
    const r = crossCheck({ guardPass: 2, guardFail: 2, independentPass: 1, independentFail: 0, karpathy: 'warn' });
    expect(r.guardVsAudit).toBe('partial');
  });
});

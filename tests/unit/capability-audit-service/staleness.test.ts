import { describe, expect, it } from 'vitest';
import { isStale } from '~/src/services/capability-audit-service/staleness';

describe("Scenario: isStale", () => {
  it("when invoked, should returns true when auditedAt > 24h ago", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const now = Date.parse('2026-08-04T00:00:00.000Z');
    const auditedAt = '2026-08-02T00:00:00.000Z';
    expect(isStale(auditedAt, now)).toBe(true);
  });
  it("when invoked, should returns false when auditedAt is within 24h", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const now = Date.parse('2026-08-04T00:00:00.000Z');
    const auditedAt = '2026-08-03T12:00:00.000Z';
    expect(isStale(auditedAt, now)).toBe(false);
  });
});

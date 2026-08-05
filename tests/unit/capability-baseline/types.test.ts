import { describe, expect, it } from 'vitest';
import { P0_JOURNEY_IDS, type JourneyId } from '~/src/services/capability-baseline/types';

describe("Scenario: capability-baseline/types", () => {
  it("when invoked, should exposes exactly 15 P0 journey ids", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(P0_JOURNEY_IDS).toHaveLength(15);
  });
  it("when invoked, should P0_JOURNEY_IDS contains every J01..J15 once and only once", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const expected: ReadonlyArray<JourneyId> = [
      'J01', 'J02', 'J03', 'J04', 'J05',
      'J06', 'J07', 'J08', 'J09', 'J10',
      'J11', 'J12', 'J13', 'J14', 'J15'
    ];
    expect([...P0_JOURNEY_IDS].sort()).toEqual([...expected].sort());
    expect(new Set(P0_JOURNEY_IDS).size).toBe(15);
  });
});

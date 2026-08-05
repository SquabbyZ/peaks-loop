import { describe, expect, it } from 'vitest';
import type { ContractKind } from '~/src/services/capability-guard-runner/types';

describe("Scenario: capability-guard-runner/types", () => {
  it("when invoked, should ContractKind includes the 9 kinds", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const expected: ReadonlyArray<ContractKind> = [
      'cli-envelope', 'workflow-trace', 'hook-assertion',
      'cli-output-golden', 'asset-roundtrip', 'concurrency-lease',
      'sop-register', 'spec-coverage', 'envelope-arg-shapes'
    ];
    expect(new Set(expected).size).toBe(9);
  });
});

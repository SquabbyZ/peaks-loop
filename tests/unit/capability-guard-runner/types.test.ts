import { describe, expect, it } from 'vitest';
import type { ContractKind } from '~/src/services/capability-guard-runner/types';

describe('capability-guard-runner/types', () => {
  it('ContractKind includes the 9 kinds', () => {
    const expected: ReadonlyArray<ContractKind> = [
      'cli-envelope', 'workflow-trace', 'hook-assertion',
      'cli-output-golden', 'asset-roundtrip', 'concurrency-lease',
      'sop-register', 'spec-coverage', 'envelope-arg-shapes'
    ];
    expect(new Set(expected).size).toBe(9);
  });
});

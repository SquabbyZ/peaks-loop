import { describe, it, expect, vi } from 'vitest';
import { runMutation } from '../../../src/services/mut/mut-runner.js';

describe('runMutation', () => {
  it('invokes Stryker with locked test files and parses result', async () => {
    const invokeStryker = vi.fn().mockResolvedValue({
      mutantsTotal: 50,
      mutantsKilled: 40,
      mutantsSurvived: 10,
      mutantsTimeout: 0,
      perFile: [
        {
          file: 'src/A.ts',
          killRate: 0.8,
          survived: [{ line: 12, mutation: '>= -> >', survivedBecause: 'shouldX' }],
        },
      ],
    });
    const result = await runMutation({
      project: '/tmp/repo',
      testFiles: ['src/A.test.ts'],
      invokeStryker,
    });
    expect(result.mutation.tool).toBe('stryker');
    expect(result.mutation.killRate).toBe(0.8);
    expect(result.mutation.byFile[0]?.survived[0]).toMatchObject({ line: 12 });
  });

  it('throws when Stryker fails (does not silently swallow)', async () => {
    const invokeStryker = vi.fn().mockRejectedValue(new Error('stryker crashed'));
    await expect(
      runMutation({
        project: '/tmp/repo',
        testFiles: ['src/A.test.ts'],
        invokeStryker,
      })
    ).rejects.toThrow(/stryker/i);
  });
});

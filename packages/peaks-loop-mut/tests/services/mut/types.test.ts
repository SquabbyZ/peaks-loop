import { describe, it, expect } from 'vitest';
import { MutReportSchema } from '../../../src/services/mut/types.js';

describe('MutReportSchema', () => {
  it('accepts a valid mut-report.json', () => {
    const result = MutReportSchema.safeParse({
      version: '1.0',
      sha256: 'a'.repeat(64),
      generatedAt: '2026-06-21T12:00:00Z',
      inputSig: 'b'.repeat(64),
      mutation: {
        tool: 'stryker',
        mutantsTotal: 50, mutantsKilled: 40, mutantsSurvived: 10, mutantsTimeout: 0,
        killRate: 0.8,
        byFile: [],
      },
      assertions: {
        totalAssertions: 100, weakAssertions: 4, weakRate: 0.04,
        weakPatterns: [],
      },
      thresholds: {
        mutationKillRateMin: 0.8, weakAssertionRateMax: 0.05, passed: true,
      },
      followups: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects sha256 with wrong length', () => {
    const result = MutReportSchema.safeParse({
      version: '1.0', sha256: 'short', generatedAt: '2026-06-21T12:00:00Z', inputSig: 'b'.repeat(64),
      mutation: { tool: 'stryker', mutantsTotal: 0, mutantsKilled: 0, mutantsSurvived: 0, mutantsTimeout: 0, killRate: 0, byFile: [] },
      assertions: { totalAssertions: 0, weakAssertions: 0, weakRate: 0, weakPatterns: [] },
      thresholds: { mutationKillRateMin: 0.8, weakAssertionRateMax: 0.05, passed: false },
      followups: [],
    });
    expect(result.success).toBe(false);
  });
});

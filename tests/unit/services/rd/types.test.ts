import { describe, it, expect } from 'vitest';
import { StrategyOutputSchema, ImplOutputSchema } from '../../../../src/services/rd/types.js';

describe('StrategyOutputSchema', () => {
  it('accepts valid strategy.md output', () => {
    const r = StrategyOutputSchema.safeParse({
      version: '1.0', sha256: 'a'.repeat(64),
      generatedAt: '2026-06-21T12:00:00Z',
      goal: 'add OAuth', rootCauseAnalysis: 'callback URL unknown',
      impactSurface: ['LoginForm.tsx'], designRationale: 'option B',
      askUserQuestion: { question: 'callback URL?', options: ['query', 'redirect'] },
    });
    expect(r.success).toBe(true);
  });

  // R2-W5: pin that sha256 length is exactly 64 hex chars (was round-1 N4 mutation escape).
  it.each([
    ['63-char sha256', 'a'.repeat(63)],
    ['65-char sha256', 'a'.repeat(65)],
    ['non-hex char', 'g'.repeat(64)],
    ['uppercase hex', 'A'.repeat(64)],
    ['empty string', ''],
  ])('rejects sha256 — %s', (_label, badSha) => {
    const r = StrategyOutputSchema.safeParse({
      version: '1.0', sha256: badSha,
      generatedAt: '2026-06-21T12:00:00Z',
      goal: 'x', rootCauseAnalysis: 'x', impactSurface: [], designRationale: 'x',
    });
    expect(r.success).toBe(false);
  });
});

describe('ImplOutputSchema', () => {
  it('accepts valid impl.json', () => {
    const r = ImplOutputSchema.safeParse({
      version: '1.0', sha256: 'a'.repeat(64),
      generatedAt: '2026-06-21T12:00:00Z',
      inputSig: 'b'.repeat(64),
      changedFiles: ['src/oauth.ts'],
      externalApiCalls: [{ file: 'src/oauth.ts', line: 10, api: 'oauthClient.handle', version: '2.4.0' }],
      astGateResult: { passed: true, violations: [] },
    });
    expect(r.success).toBe(true);
  });

  it.each([
    ['63-char inputSig', 'a'.repeat(64), 'b'.repeat(63)],
    ['65-char inputSig', 'a'.repeat(64), 'b'.repeat(65)],
    ['63-char self sha256', 'a'.repeat(63), 'b'.repeat(64)],
  ])('rejects impl — %s', (_label, sha, inputSig) => {
    const r = ImplOutputSchema.safeParse({
      version: '1.0', sha256: sha,
      generatedAt: '2026-06-21T12:00:00Z',
      inputSig,
      changedFiles: [],
      externalApiCalls: [],
      astGateResult: { passed: true, violations: [] },
    });
    expect(r.success).toBe(false);
  });
});
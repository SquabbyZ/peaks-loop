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
});
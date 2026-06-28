/**
 * v2.15.0 follow-up — G6 tests: slice cross-integration verifier.
 */
import { describe, it, expect } from 'vitest';
import { integrateSlices } from '../../../../src/services/slice/slice-integration.js';
import type { SliceContract } from '../../../../src/services/dispatch/contract-store.js';

function contract(sliceId: string, exports: string[], types: string[] = [], signatures: string[] = []): SliceContract {
  return {
    sliceId,
    sessionId: 'sid',
    completedAt: '2026-06-28T10:00:00Z',
    exports,
    types,
    publicSignatures: signatures,
    contractHash: 'h-' + sliceId
  };
}

describe('integrateSlices — happy path', () => {
  it('returns ok when no contracts', () => {
    const r = integrateSlices({ contracts: [] });
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
  });
  it('returns ok with info finding for non-overlapping exports', () => {
    const r = integrateSlices({ contracts: [contract('A', ['alpha']), contract('B', ['beta'])] });
    expect(r.ok).toBe(true);
    expect(r.summary.info).toBe(1);
  });
});

describe('integrateSlices — duplicate exports', () => {
  it('flags an error when two slices declare the same export', () => {
    const r = integrateSlices({ contracts: [contract('A', ['shared']), contract('B', ['shared'])] });
    expect(r.ok).toBe(false);
    expect(r.summary.errors).toBe(1);
    expect(r.findings[0]?.kind).toBe('duplicate-export');
  });
});

describe('integrateSlices — signature drift', () => {
  it('flags a warning when the same export has 2 different signatures', () => {
    const r = integrateSlices({
      contracts: [
        contract('A', ['foo'], [], ['foo:() => void']),
        contract('B', ['foo'], [], ['foo:(x: number) => void'])
      ]
    });
    expect(r.summary.warnings).toBe(1);
    expect(r.findings.find((f) => f.kind === 'signature-drift')).toBeDefined();
  });
});

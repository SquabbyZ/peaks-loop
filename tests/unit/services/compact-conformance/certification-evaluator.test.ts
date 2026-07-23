/**
 * certification-evaluator.test.ts — Phase 3 Task 3.4.
 *
 * Maps case results to maximum certification level; verifies the
 * strong-case → certified-strong, single failure → safe-handoff,
 * skipped → native-only, and any strong failure combination
 * does not promote to certified-strong.
 */
import { strict as assert } from 'node:assert';
import { describe, expect, it } from 'vitest';
import { evaluateCertification } from '../../../../src/services/compact-conformance/certification-evaluator.js';
import type { CompactConformanceCaseResult } from '../../../../src/services/compact-conformance/conformance-types.js';

function mkResult(
  caseId: string,
  status: CompactConformanceCaseResult['status'],
  failureCode?: string
): CompactConformanceCaseResult {
  return {
    caseId,
    status,
    startedAt: '2026-07-24T00:00:00.000Z',
    completedAt: '2026-07-24T00:00:01.000Z',
    evidence: [],
    ...(failureCode !== undefined ? { failureCode } : {})
  };
}

describe('certification evaluator level mapping', () => {
  it('promotes to certified-strong when all strong cases pass', () => {
    const ev = evaluateCertification([
      mkResult('CAP-001', 'passed'),
      mkResult('ATTACH-001', 'passed'),
      mkResult('NATIVE-001', 'passed'),
      mkResult('EVENT-001', 'passed'),
      mkResult('PROGRESS-001', 'passed'),
      mkResult('UI-001', 'passed'),
      mkResult('FALLBACK-001', 'passed'),
      mkResult('ROLLBACK-001', 'passed'),
      mkResult('MEASURE-001', 'passed'),
      mkResult('RESUME-001', 'passed'),
      mkResult('IDEMPOTENCY-001', 'passed'),
      mkResult('STALE-001', 'passed'),
      mkResult('GENERATION-001', 'passed'),
      mkResult('PRIVACY-001', 'passed'),
      mkResult('CIRCUIT-001', 'passed')
    ]);
    expect(ev.level.kind).toBe('certified-strong');
  });

  it('drops to safe-handoff when a strong case fails', () => {
    const ev = evaluateCertification([
      mkResult('FALLBACK-001', 'failed', 'REPLACE'),
      mkResult('CAP-001', 'passed')
    ]);
    expect(ev.level.kind).toBe('safe-handoff');
    expect(ev.failedStrongCases).toContain('FALLBACK-001');
  });

  it('drops to native-only when a strong case is skipped', () => {
    const ev = evaluateCertification([
      mkResult('PRIVACY-001', 'skipped')
    ]);
    expect(ev.level.kind).toBe('native-only');
    expect(ev.skippedStrongCases).toContain('PRIVACY-001');
  });

  it('drops to native-only when a strong case is missing entirely', () => {
    const ev = evaluateCertification([mkResult('CAP-001', 'passed')]);
    expect(ev.level.kind).toBe('native-only');
  });

  it('failed-strong does not promote to certified-strong even with all others passed', () => {
    const results: CompactConformanceCaseResult[] = [];
    const allIds = [
      'CAP-001', 'ATTACH-001', 'NATIVE-001', 'EVENT-001', 'PROGRESS-001',
      'UI-001', 'FALLBACK-001', 'ROLLBACK-001', 'MEASURE-001', 'RESUME-001',
      'IDEMPOTENCY-001', 'STALE-001', 'GENERATION-001', 'PRIVACY-001', 'CIRCUIT-001'
    ];
    for (const id of allIds) {
      results.push(mkResult(id, id === 'MEASURE-001' ? 'failed' : 'passed', id === 'MEASURE-001' ? 'M' : undefined));
    }
    const ev = evaluateCertification(results);
    expect(ev.level.kind).not.toBe('certified-strong');
  });
});

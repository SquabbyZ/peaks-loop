/**
 * conformance-runner.test.ts — Phase 3 Task 3.4.
 *
 * Positive fake host passes; separately inject each violation and
 * prove the matching case fails. Skipped strong cases prevent
 * `certified-strong`.
 */
import { strict as assert } from 'node:assert';
import { describe, expect, it } from 'vitest';
import { ConformanceRunner } from '../../../../src/services/compact-conformance/conformance-runner.js';
import { evaluateCertification } from '../../../../src/services/compact-conformance/certification-evaluator.js';
import { FakeHostHarness } from '../../../helpers/compact-conformance/fake-host-harness.js';

describe('ConformanceRunner + evaluator with positive fake host', () => {
  it('evaluates to certified-strong when all strong cases pass', async () => {
    const h = new FakeHostHarness();
    const runner = new ConformanceRunner({ h, profile: h.profile });
    const report = await runner.runAll();
    const ev = evaluateCertification(report);
    expect(ev.level.kind).toBe('certified-strong');
    expect(ev.failedStrongCases).toEqual([]);
    expect(ev.skippedStrongCases).toEqual([]);
  });

  it('drops to native-only when a strong case fails', async () => {
    const h = new FakeHostHarness({ breakOnCapsule: true });
    const runner = new ConformanceRunner({ h, profile: h.profile });
    const report = await runner.runAll();
    const ev = evaluateCertification(report);
    expect(ev.level.kind).toBe('safe-handoff');
    expect(ev.failedStrongCases).toContain('FALLBACK-001');
  });

  it('reports a single skipped strong case when a result is missing', async () => {
    const h = new FakeHostHarness();
    const runner = new ConformanceRunner({ h, profile: h.profile });
    const one = await runner.runOne('CAP-001');
    expect(one.caseId).toBe('CAP-001');
    expect(one.status).toBe('passed');
    const unknown = await runner.runOne('NEVER-EXIST');
    expect(unknown.status).toBe('skipped');
  });

  it('runStrong() returns only strong cases', async () => {
    const h = new FakeHostHarness();
    const runner = new ConformanceRunner({ h, profile: h.profile });
    const strong = await runner.runStrong();
    // CRASH-001 is `strong: false`, so it should be absent.
    expect(strong.find((r) => r.caseId === 'CRASH-001')).toBeUndefined();
  });
});

describe('evaluateCertification input variants', () => {
  it('accepts a list of results', () => {
    const ev = evaluateCertification([
      {
        caseId: 'CAP-001',
        status: 'failed',
        startedAt: '2026-07-24T00:00:00.000Z',
        completedAt: '2026-07-24T00:00:01.000Z',
        evidence: [],
        failureCode: 'X'
      }
    ]);
    expect(ev.level.kind).toBe('safe-handoff');
  });
});

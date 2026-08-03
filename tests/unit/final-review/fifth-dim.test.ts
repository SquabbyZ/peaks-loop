import { describe, expect, it } from 'vitest';
// addFifthDim is exported by re-export from final-review-service.ts.
// If your tsconfig path alias differs, use a relative import.
import { decideFifthDimension } from '~/src/services/final-review/final-review-service';
import { isStale } from '~/src/services/capability-audit-service/staleness';

describe('decideFifthDimension', () => {
  it('returns inconclusive when audit is missing', () => {
    const v = decideFifthDimension({ audit: null, nowMs: Date.parse('2026-08-04T00:00:00.000Z') });
    expect(v.verdict).toBe('inconclusive');
  });
  it('returns inconclusive when audit is stale', () => {
    const v = decideFifthDimension({
      audit: { auditId: 'a', auditedAt: '2026-08-01T00:00:00.000Z', verdict: 'consistent', dimensions: [], crossCheck: { guardVsAudit: 'agree', karpathyVsAudit: 'agree' }, requiresUserDecision: false },
      nowMs: Date.parse('2026-08-04T00:00:00.000Z')
    });
    expect(v.verdict).toBe('inconclusive');
  });
  it('returns pass on consistent', () => {
    const v = decideFifthDimension({
      audit: { auditId: 'a', auditedAt: '2026-08-03T23:00:00.000Z', verdict: 'consistent', dimensions: [], crossCheck: { guardVsAudit: 'agree', karpathyVsAudit: 'agree' }, requiresUserDecision: false },
      nowMs: Date.parse('2026-08-04T00:00:00.000Z')
    });
    expect(v.verdict).toBe('pass');
  });
  it('returns fail on drifted', () => {
    const v = decideFifthDimension({
      audit: { auditId: 'a', auditedAt: '2026-08-03T23:00:00.000Z', verdict: 'drifted', dimensions: [], crossCheck: { guardVsAudit: 'agree', karpathyVsAudit: 'agree' }, requiresUserDecision: true },
      nowMs: Date.parse('2026-08-04T00:00:00.000Z')
    });
    expect(v.verdict).toBe('fail');
  });
  it('returns inconclusive on cross-check diverge', () => {
    const v = decideFifthDimension({
      audit: { auditId: 'a', auditedAt: '2026-08-03T23:00:00.000Z', verdict: 'consistent', dimensions: [], crossCheck: { guardVsAudit: 'diverge', karpathyVsAudit: 'agree' }, requiresUserDecision: true },
      nowMs: Date.parse('2026-08-04T00:00:00.000Z')
    });
    expect(v.verdict).toBe('inconclusive');
  });
  it('isStale is exposed for cross-check', () => {
    expect(isStale('2026-08-02T00:00:00.000Z', Date.parse('2026-08-04T00:00:00.000Z'))).toBe(true);
  });
});

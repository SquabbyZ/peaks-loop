import { describe, expect, it } from 'vitest';
import { isStale } from '~/src/services/capability-audit-service/staleness';

describe('isStale', () => {
  it('returns true when auditedAt > 24h ago', () => {
    const now = Date.parse('2026-08-04T00:00:00.000Z');
    const auditedAt = '2026-08-02T00:00:00.000Z';
    expect(isStale(auditedAt, now)).toBe(true);
  });
  it('returns false when auditedAt is within 24h', () => {
    const now = Date.parse('2026-08-04T00:00:00.000Z');
    const auditedAt = '2026-08-03T12:00:00.000Z';
    expect(isStale(auditedAt, now)).toBe(false);
  });
});

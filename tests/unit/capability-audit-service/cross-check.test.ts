import { describe, expect, it } from 'vitest';
import { crossCheck } from '~/src/services/capability-audit-service/cross-check';

describe('crossCheck', () => {
  it('returns agree when guard and independent agree', () => {
    const r = crossCheck({ guardPass: 5, guardFail: 0, independentPass: 5, independentFail: 0, karpathy: 'pass' });
    expect(r.guardVsAudit).toBe('agree');
    expect(r.karpathyVsAudit).toBe('agree');
  });
  it('returns diverge when one says pass and the other says fail', () => {
    const r = crossCheck({ guardPass: 3, guardFail: 2, independentPass: 5, independentFail: 0, karpathy: 'pass' });
    expect(r.guardVsAudit).toBe('diverge');
  });
  it('returns partial when sources only partially agree', () => {
    const r = crossCheck({ guardPass: 4, guardFail: 1, independentPass: 3, independentFail: 2, karpathy: 'warn' });
    expect(r.guardVsAudit).toBe('partial');
  });
});

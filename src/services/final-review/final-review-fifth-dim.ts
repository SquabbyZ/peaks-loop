// src/services/final-review/final-review-fifth-dim.ts
//
// The fifth (capability-consistency) dimension: a pure deterministic
// verdict rule over the guard audit result. Hoisted verbatim from
// final-review-service.ts (C wave 7 file-size split); the service module
// re-exports it so the import path is unchanged.

import { isStale } from '../capability-audit-service/staleness.js';
import type { CapabilityAuditResult } from '../capability-audit-service/types.js';

export function decideFifthDimension(input: {
  readonly audit: CapabilityAuditResult | null;
  readonly nowMs: number;
}): {
  readonly verdict: 'pass' | 'fail' | 'inconclusive';
  readonly reason: string;
} {
  if (input.audit === null) return { verdict: 'inconclusive', reason: 'AUDIT_GUARD_NOT_RUN' };
  if (isStale(input.audit.auditedAt, input.nowMs))
    return { verdict: 'inconclusive', reason: 'AUDIT_STALE' };
  if (input.audit.crossCheck.guardVsAudit === 'diverge')
    return { verdict: 'inconclusive', reason: 'AUDIT_CROSS_CHECK_DIVERGE' };
  if (input.audit.verdict === 'consistent') return { verdict: 'pass', reason: 'audit consistent' };
  if (input.audit.verdict === 'drifted') return { verdict: 'fail', reason: 'audit drifted' };
  return { verdict: 'inconclusive', reason: 'audit inconclusive' };
}

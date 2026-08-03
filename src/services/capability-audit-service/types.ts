import type { JourneyId } from '../capability-baseline/types.js';

export type AuditVerdict = 'consistent' | 'drifted' | 'inconclusive';

export type AuditEvidenceKind = 'guard-run' | 'independent-eval' | 'karpathy-cross-check';

export interface AuditDimension {
  readonly journeyId: JourneyId;
  readonly consistencyScore: number;
  readonly evidence: ReadonlyArray<{ readonly kind: AuditEvidenceKind; readonly ref: string; readonly summary: string }>;
}

export interface CrossCheck {
  readonly guardVsAudit: 'agree' | 'diverge' | 'partial';
  readonly karpathyVsAudit: 'agree' | 'diverge' | 'partial';
}

export interface CapabilityAuditResult {
  readonly auditId: string;
  readonly auditedAt: string;
  readonly verdict: AuditVerdict;
  readonly dimensions: ReadonlyArray<AuditDimension>;
  readonly crossCheck: CrossCheck;
  readonly requiresUserDecision: boolean;
}

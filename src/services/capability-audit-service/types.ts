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

/**
 * Why an independent verdict came out `drifted`. Each code names a concrete,
 * inspectable deviation rather than a summary judgement.
 */
export type AuditFindingCode =
  /** The observed journey set is not the frozen P0 set. */
  | 'OBSERVATION_INCOMPLETE'
  /** The frozen baseline's own row set is not the P0 set. */
  | 'BASELINE_ROW_SET_INVALID'
  /** A frozen `sourceFiles` entry no longer exists on disk. */
  | 'SOURCE_FILE_MISSING';

export interface AuditFinding {
  readonly code: AuditFindingCode;
  readonly journeyId: JourneyId;
  readonly detail: string;
}

/**
 * How wide the audit's claim actually is. Reported alongside the verdict so
 * `consistent` is never read as broader than it is: the check verifies the
 * frozen row set, the observation set and the file bindings — it does not
 * evaluate `forbiddenChanges` prose, and it judges no behaviour beyond what
 * the guard contracts already exercise.
 */
export interface AuditCoverage {
  readonly observations: number;
  readonly observationsExpected: number;
  readonly invariantsFrozen: number;
  readonly invariantsArmed: number;
  readonly forbiddenChangesUnverified: number;
}

export interface IndependentCheckResult {
  readonly verdict: 'consistent' | 'drifted';
  readonly findings: ReadonlyArray<AuditFinding>;
  readonly coverage: AuditCoverage;
}

export interface CapabilityAuditResult {
  readonly auditId: string;
  readonly auditedAt: string;
  readonly verdict: AuditVerdict;
  readonly dimensions: ReadonlyArray<AuditDimension>;
  readonly crossCheck: CrossCheck;
  readonly requiresUserDecision: boolean;
  /**
   * True when no separate-context evaluation ran at all — i.e. the scorer was
   * the stub, not the deterministic independent checker. A degraded audit can
   * never be `consistent`.
   */
  readonly degraded: boolean;
  /**
   * The independent checker's findings, in the order it produced them. Empty
   * on a `consistent` live run; `null` on a degraded run, where no check ran.
   */
  readonly findings: ReadonlyArray<AuditFinding> | null;
  /** How wide this audit's claim is; `null` on a degraded run. */
  readonly coverage: AuditCoverage | null;
}

/**
 * Type contracts for the `auditGoal()` primitive.
 *
 * The audit-goal primitive sits between a human's expressed need and any
 * autonomous LLM execution. It forces the LLM to:
 *   1. Summarize the need.
 *   2. Audit across 6 dimensions (correctness, completeness, scope, risks,
 *      alternatives, constraints) — each with a severity.
 *   3. Propose a goal, success criteria, rough effort, and confidence.
 *
 * The 6-dimension contract is the unit of validation; the service
 * rejects any LLM response that omits a dimension so downstream
 * autonomous work cannot proceed on a partial audit.
 */

export type AuditDimensionKind =
  | 'correctness'
  | 'completeness'
  | 'scope'
  | 'risks'
  | 'alternatives'
  | 'constraints';

export type AuditSeverity = 'info' | 'concern' | 'blocker';

export type AuditEffort = 'small' | 'medium' | 'large' | 'epic';

export type AuditConfidence = 'high' | 'medium' | 'low';

export interface AuditGoalInput {
  readonly need: string;
  readonly context?: {
    readonly projectRoot?: string;
    readonly sessionMemory?: readonly string[];
    readonly relevantMemories?: readonly string[];
  };
}

export interface AuditDimension {
  readonly dimension: AuditDimensionKind;
  readonly finding: string;
  readonly severity: AuditSeverity;
}

export interface AuditGoalOutput {
  readonly summary: string;
  readonly audit: readonly AuditDimension[];
  readonly proposedGoal: string;
  readonly successCriteria: readonly string[];
  readonly roughEffort: AuditEffort;
  readonly confidence: AuditConfidence;
  readonly rationale: string;
}

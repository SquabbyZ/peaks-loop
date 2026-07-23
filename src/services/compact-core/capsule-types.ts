/**
 * Phase 2 Task 2.1 — convergence capsule schemas.
 *
 * The `ConvergenceCapsule` is the deterministic receipt that the Phase 2
 * fallback engine will hand to a fresh post-compact session. It has 16
 * payload fields (per design §7.1) plus a SHA-256 `digest` field that
 * locks the payload. The schema is `.strict()`: any extra field is
 * rejected at the boundary so downstream consumers can rely on a closed
 * shape.
 *
 * Vendor-neutrality: this module imports only `node:crypto` and `zod`.
 * No host names, no binaries, no slash commands, no vendor conditionals.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Capsule schema version. Bump on any breaking shape change. */
export const SCHEMA_VERSION = 1 as const;

/** SHA-256 hex regex: 64 lowercase hex characters. */
export const DIGEST_HEX_PATTERN = /^[a-f0-9]{64}$/;

/** Workflow modes from design §7.1. */
export const WORKFLOW_MODES = ['full-auto', 'assisted', 'strict', 'swarm'] as const;

export const WorkflowModeSchema = z.enum(WORKFLOW_MODES);

/** Context-window kinds. */
export const ContextWindowKindSchema = z.enum(['200k', '1m']);

// ── Sub-type schemas ─────────────────────────────────────────────────────────

export const ApprovedGoalSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    approvedAt: z.string().datetime(),
    approvedBy: z.string()
  })
  .strict();
/** Typo-guard alias for `ApprovedGoalSchema`. */
export const ApprovalGoalSchema = ApprovedGoalSchema;

export const JobCursorSchema = z
  .object({
    jobId: z.string(),
    lane: z.string(),
    phase: z.string(),
    updatedAt: z.string().datetime()
  })
  .strict();

export const RequestCursorSchema = z
  .object({
    requestId: z.string(),
    sliceId: z.string(),
    status: z.string(),
    updatedAt: z.string().datetime()
  })
  .strict();

export const GateReceiptSchema = z
  .object({
    gateId: z.string(),
    status: z.string(),
    completedAt: z.string().datetime(),
    receipt: z.string()
  })
  .strict();

export const TaskSnapshotSchema = z
  .object({
    taskId: z.string(),
    status: z.string(),
    summary: z.string(),
    startedAt: z.string().datetime()
  })
  .strict();

export const DecisionRecordSchema = z
  .object({
    id: z.string(),
    decision: z.string(),
    rationale: z.string(),
    madeAt: z.string().datetime()
  })
  .strict();

export const OpenQuestionSchema = z
  .object({
    id: z.string(),
    question: z.string(),
    blocking: z.boolean(),
    askedAt: z.string().datetime()
  })
  .strict();

export const FailureRecordSchema = z
  .object({
    code: z.string(),
    summary: z.string(),
    retryCount: z.number().int().nonnegative(),
    lastFailureAt: z.string().datetime()
  })
  .strict();

export const ArtifactPointerSchema = z
  .object({
    path: z.string(),
    sha256: z.string().regex(DIGEST_HEX_PATTERN),
    summary: z.string(),
    kind: z.string().optional()
  })
  .strict();

export const NextActionSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    summary: z.string(),
    sideEffect: z.boolean().optional()
  })
  .strict();

export const IdempotencyEnvelopeSchema = z
  .object({
    scope: z.string(),
    sealedKeys: z.array(z.string()).min(1)
  })
  .strict();

export const ContextMeasurementSchema = z
  .object({
    promptBytes: z.number().int().nonnegative(),
    capacityBytes: z.number().int().positive(),
    ratio: z.number().min(0).max(1),
    computedAt: z.string().datetime(),
    windowKind: ContextWindowKindSchema
  })
  .strict();

// ── ConvergenceCapsule ────────────────────────────────────────────────────────

export const ConvergenceCapsuleSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    capsuleId: z.string().regex(DIGEST_HEX_PATTERN),
    compactAttemptId: z.string(),
    sourceSessionId: z.string(),
    goal: ApprovedGoalSchema,
    mode: WorkflowModeSchema,
    activeJob: JobCursorSchema.nullable(),
    activeRequest: RequestCursorSchema.nullable(),
    completedGates: z.array(GateReceiptSchema),
    activeTasks: z.array(TaskSnapshotSchema),
    decisions: z.array(DecisionRecordSchema),
    openQuestions: z.array(OpenQuestionSchema),
    failureHistory: z.array(FailureRecordSchema),
    artifactIndex: z.array(ArtifactPointerSchema),
    nextAction: NextActionSchema,
    idempotency: IdempotencyEnvelopeSchema,
    sourceContextMeasurement: ContextMeasurementSchema,
    digest: z.string().regex(DIGEST_HEX_PATTERN)
  })
  .strict();

export type ConvergenceCapsule = z.infer<typeof ConvergenceCapsuleSchema>;
export type ConvergenceCapsuleInput = ConvergenceCapsule;

// ── Field types ──────────────────────────────────────────────────────────────

export type WorkflowMode = z.infer<typeof WorkflowModeSchema>;
export type ApprovedGoal = z.infer<typeof ApprovedGoalSchema>;
export type JobCursor = z.infer<typeof JobCursorSchema>;
export type RequestCursor = z.infer<typeof RequestCursorSchema>;
export type GateReceipt = z.infer<typeof GateReceiptSchema>;
export type TaskSnapshot = z.infer<typeof TaskSnapshotSchema>;
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;
export type FailureRecord = z.infer<typeof FailureRecordSchema>;
export type ArtifactPointer = z.infer<typeof ArtifactPointerSchema>;
export type NextAction = z.infer<typeof NextActionSchema>;
export type IdempotencyEnvelope = z.infer<typeof IdempotencyEnvelopeSchema>;
export type ContextMeasurement = z.infer<typeof ContextMeasurementSchema>;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive a deterministic 64-hex `capsuleId` from the attempt, session,
 * and first payload (the canonical material before the digest is
 * computed). The id is stable across restarts and is bound to the
 * payload so swapping the payload changes the id.
 */
export function deriveCapsuleId(input: {
  readonly compactAttemptId: string;
  readonly sourceSessionId: string;
  readonly firstPayload: string;
}): string {
  const material = `${input.compactAttemptId}:${input.sourceSessionId}:${input.firstPayload}`;
  return createHash('sha256').update(material).digest('hex');
}

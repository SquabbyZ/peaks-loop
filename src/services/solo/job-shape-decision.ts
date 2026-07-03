/**
 * v3.1.1 Step 0.8 — Job-shape decision recorder.
 *
 * The CLI is a *recorder and gate*, not a judge. The LLM makes the
 * semantic call ("is this a Job?") and writes the verdict via
 * `peaks solo detect-job`; this service persists the verdict to
 * `.peaks/_runtime/<sessionId>/job-shape.json` and refuses downstream
 * steps that need a decision when the file is missing.
 *
 * Karpathy §2 (Simplicity First): ~100 lines, pure validation + fs
 * writes, NO keyword regex, NO LLM call inside. The LLM is the
 * source of truth for whether the request is Job-shaped; this file
 * just enforces that a decision was made at all.
 *
 * Decision file lives at `.peaks/_runtime/<sessionId>/job-shape.json`
 * (sibling of `session.json`, NOT under `job/<jid>/` because no jid
 * exists yet at the moment of Step 0.8).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

export type JobStrategy = 'single' | 'rotating';
export type JobConfidence = 'high' | 'medium' | 'low';

export interface JobShapeDecision {
  readonly isJob: boolean;
  readonly rationale: string;
  readonly suggestedJobId: string;
  readonly suggestedStrategy: JobStrategy;
  readonly confidence: JobConfidence;
  /** ISO 8601; stamped server-side in `writeJobShapeDecision`. */
  readonly decidedAt: string;
}

export interface JobShapeRecord {
  readonly sessionId: string;
  /** sha1 of the user prompt (first 16 hex). */
  readonly promptHash: string;
  readonly decision: JobShapeDecision;
  readonly schemaVersion: 1;
}

export const JOB_SHAPE_SCHEMA_VERSION = 1 as const;
export const JOB_SHAPE_FILE_NAME = 'job-shape.json';
export const JOB_SHAPE_ALREADY_DECIDED = 'JOB_SHAPE_ALREADY_DECIDED' as const;
export const JOB_SHAPE_NOT_DECIDED = 'JOB_SHAPE_NOT_DECIDED' as const;
export const JOB_SHAPE_INVALID = 'JOB_SHAPE_INVALID' as const;

const SUGGESTED_JID_RE = /^[a-z0-9][a-z0-9-]{2,40}$/;

const JobShapeDecisionSchema = z.object({
  isJob: z.boolean(),
  rationale: z.string().min(1).max(2000),
  suggestedJobId: z.string().regex(SUGGESTED_JID_RE, 'suggestedJobId must match /^[a-z0-9][a-z0-9-]{2,40}$/'),
  suggestedStrategy: z.enum(['single', 'rotating']),
  confidence: z.enum(['high', 'medium', 'low']),
  decidedAt: z.string().datetime()
});

const JobShapeRecordSchema = z.object({
  sessionId: z.string().min(1),
  promptHash: z.string().regex(/^[a-f0-9]{16}$/, 'promptHash must be 16 hex chars'),
  decision: JobShapeDecisionSchema,
  schemaVersion: z.literal(JOB_SHAPE_SCHEMA_VERSION)
});

export class JobShapeDecisionError extends Error {
  public readonly code: typeof JOB_SHAPE_NOT_DECIDED | typeof JOB_SHAPE_ALREADY_DECIDED | typeof JOB_SHAPE_INVALID;
  public readonly details?: unknown;
  public constructor(opts: { code: typeof JobShapeDecisionError.prototype.code; message: string; details?: unknown }) {
    super(opts.message);
    this.name = 'JobShapeDecisionError';
    this.code = opts.code;
    if (opts.details !== undefined) this.details = opts.details;
  }
}

function runtimeDir(projectRoot: string, sessionId: string): string {
  return join(projectRoot, '.peaks', '_runtime', sessionId);
}

function decisionPath(projectRoot: string, sessionId: string): string {
  return join(runtimeDir(projectRoot, sessionId), JOB_SHAPE_FILE_NAME);
}

function sha1Prefix16(input: string): string {
  return createHash('sha1').update(input, 'utf8').digest('hex').slice(0, 16);
}

/** Pure validator; throws on bad input. No fs IO. */
export function validateJobShapeDecision(input: unknown): JobShapeDecision {
  return JobShapeDecisionSchema.parse(input);
}

function validateRecord(input: unknown): JobShapeRecord {
  return JobShapeRecordSchema.parse(input);
}

/** Read the canonical record; throws JOB_SHAPE_NOT_DECIDED if absent or malformed. */
export function readJobShapeDecision(projectRoot: string, sessionId: string): JobShapeRecord {
  const path = decisionPath(projectRoot, sessionId);
  if (!existsSync(path)) {
    throw new JobShapeDecisionError({
      code: JOB_SHAPE_NOT_DECIDED,
      message: `No Job-shape decision recorded for session ${sessionId}. Run \`peaks solo detect-job\` to record a decision.`,
      details: { path }
    });
  }
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new JobShapeDecisionError({
      code: JOB_SHAPE_NOT_DECIDED,
      message: `Job-shape decision file is unreadable for session ${sessionId}. Run \`peaks solo detect-job\` to re-record.`,
      details: { path, cause: err instanceof Error ? err.message : String(err) }
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new JobShapeDecisionError({
      code: JOB_SHAPE_NOT_DECIDED,
      message: `Job-shape decision file is malformed JSON for session ${sessionId}. Run \`peaks solo detect-job --force\` to overwrite.`,
      details: { path, cause: err instanceof Error ? err.message : String(err) }
    });
  }
  try {
    return validateRecord(parsed);
  } catch (err) {
    throw new JobShapeDecisionError({
      code: JOB_SHAPE_NOT_DECIDED,
      message: `Job-shape decision file is schema-invalid for session ${sessionId}. Run \`peaks solo detect-job --force\` to overwrite.`,
      details: { path, cause: err instanceof Error ? err.message : String(err) }
    });
  }
}

export interface WriteJobShapeDecisionInput {
  readonly isJob: boolean;
  readonly rationale: string;
  readonly suggestedJobId: string;
  readonly suggestedStrategy: JobStrategy;
  readonly confidence: JobConfidence;
  readonly prompt: string;
}

/**
 * Persist a new decision; refuses overwrite unless `force: true`.
 * Stamps `decidedAt` server-side via `now` (defaults to `new Date()`)
 * so the LLM cannot back-date.
 */
export function writeJobShapeDecision(
  projectRoot: string,
  sessionId: string,
  decision: WriteJobShapeDecisionInput,
  opts: { force?: boolean; now?: () => Date } = {}
): JobShapeRecord {
  const path = decisionPath(projectRoot, sessionId);
  if (existsSync(path) && opts.force !== true) {
    throw new JobShapeDecisionError({
      code: JOB_SHAPE_ALREADY_DECIDED,
      message: `Job-shape decision already exists for session ${sessionId}. Re-run with --force to overwrite.`,
      details: { path }
    });
  }
  // Validate the LLM-supplied fields first so a bad call fails loud
  // before we touch the filesystem.
  const partial: Omit<JobShapeDecision, 'decidedAt'> = {
    isJob: decision.isJob,
    rationale: decision.rationale,
    suggestedJobId: decision.suggestedJobId,
    suggestedStrategy: decision.suggestedStrategy,
    confidence: decision.confidence
  };
  // Validate the LLM-supplied shape (decidedAt is server-stamped).
  JobShapeDecisionSchema.omit({ decidedAt: true }).parse(partial);
  const now = opts.now ?? ((): Date => new Date());
  const stamped: JobShapeDecision = { ...partial, decidedAt: now().toISOString() };
  const promptHash = sha1Prefix16(decision.prompt);
  const record: JobShapeRecord = {
    sessionId,
    promptHash,
    decision: stamped,
    schemaVersion: JOB_SHAPE_SCHEMA_VERSION
  };
  const dir = runtimeDir(projectRoot, sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return record;
}

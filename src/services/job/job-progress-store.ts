/**
 * v3.1.2 — On-disk slice progress mirror.
 *
 * After each `peaks job checkpoint --state done`, the orchestrator writes
 * `.peaks/_runtime/<sessionId>/job/<jid>/progress.json` so the next LLM
 * turn (after compact or resume) can read it before any Bash call lands.
 *
 * Shape (schemaVersion 1):
 *   {
 *     jobId, done, total, currentSlice, lastCommitSha, updatedAt
 *   }
 *
 * The `peaks solo gate-step-08` hook reads this file in its case-1 path
 * (job-shape.json says isJob=true) and surfaces `Next: slice #N+1 of M
 * (<currentSlice>)` to stdout. The LLM cannot "wake up cold" — the
 * next-slice context is mechanically injected on every Bash call.
 *
 * Karpathy §2 (Simplicity First): ~50 lines, single-purpose writer +
 * reader. Schema is zod-validated on read so a stale on-disk copy
 * from an earlier peaks-loop release fails loud (no silent fallback).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const JOB_PROGRESS_SCHEMA_VERSION = 1 as const;

export const JobProgressSchema = z.object({
  schemaVersion: z.literal(JOB_PROGRESS_SCHEMA_VERSION),
  jobId: z.string(),
  done: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  currentSlice: z.string(),
  lastCommitSha: z.string().nullable(),
  updatedAt: z.string().datetime()
});

export type JobProgress = z.infer<typeof JobProgressSchema>;

export interface WriteProgressInput {
  readonly jobId: string;
  readonly done: number;
  readonly total: number;
  readonly currentSlice: string;
  readonly lastCommitSha: string | null;
  readonly updatedAt?: string;
}

export function writeJobProgress(
  projectRoot: string,
  sessionId: string,
  input: WriteProgressInput
): JobProgress {
  const dir = join(projectRoot, '.peaks', '_runtime', sessionId, 'job', input.jobId);
  mkdirSync(dir, { recursive: true });
  const record: JobProgress = {
    schemaVersion: JOB_PROGRESS_SCHEMA_VERSION,
    jobId: input.jobId,
    done: input.done,
    total: input.total,
    currentSlice: input.currentSlice,
    lastCommitSha: input.lastCommitSha,
    updatedAt: input.updatedAt ?? new Date().toISOString()
  };
  const path = join(dir, 'progress.json');
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return record;
}

export function readJobProgress(projectRoot: string, sessionId: string, jobId: string): JobProgress {
  const path = join(projectRoot, '.peaks', '_runtime', sessionId, 'job', jobId, 'progress.json');
  if (!existsSync(path)) {
    throw new Error(`JobProgressStore: no progress for ${jobId} at ${path}`);
  }
  const raw = readFileSync(path, 'utf8');
  return JobProgressSchema.parse(JSON.parse(raw));
}

export function tryReadJobProgress(projectRoot: string, sessionId: string, jobId: string): JobProgress | null {
  const path = join(projectRoot, '.peaks', '_runtime', sessionId, 'job', jobId, 'progress.json');
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    return JobProgressSchema.parse(JSON.parse(raw));
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}
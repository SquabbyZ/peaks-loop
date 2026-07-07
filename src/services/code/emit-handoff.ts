/**
 * v3.1.2 Step 11 / final handoff — Size-fear ban.
 *
 * Refuses to emit a final handoff while a Job has remaining slices.
 * Closes the v3.1.0 incident pattern: LLM writes a fake-completion
 * message at high context-fill before Job mode kicks in.
 *
 * Decision tree:
 *   - job-shape.json missing OR isJob === false  → ALLOW (normal handoff)
 *   - isJob === true, no state.json              → JOB_NOT_INITIALIZED (LLM
 *     skipped `peaks job init`)
 *   - isJob === true, state.json, remaining > 0,
 *     no --force-under-job                        → JOB_REMAINING_BLOCKED
 *   - isJob === true, state.json, remaining === 0 → ALLOW (Job done)
 *   - isJob === true, state.json, remaining > 0,
 *     --force-under-job                            → ALLOW (override path)
 *
 * Karpathy §2 (Simplicity First): ~70 lines, no LLM call, no regex.
 * Pure read + arithmetic. The CLI wrapper in code-commands.ts
 * translates the verdict into exit code + JSON envelope.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  readJobShapeDecision,
  JobShapeDecisionError,
  JOB_SHAPE_NOT_DECIDED
} from './job-shape-decision.js';

export const JOB_NOT_INITIALIZED = 'JOB_NOT_INITIALIZED' as const;
export const JOB_REMAINING_BLOCKED = 'JOB_REMAINING_BLOCKED' as const;

export type EmitHandoffVerdict =
  | { readonly kind: 'allow-not-job' }
  | { readonly kind: 'allow-done'; readonly remaining: number }
  | { readonly kind: 'allow-force-override'; readonly remaining: number }
  | { readonly kind: 'block-not-initialized'; readonly code: typeof JOB_NOT_INITIALIZED; readonly jobId: string }
  | { readonly kind: 'block-remaining'; readonly code: typeof JOB_REMAINING_BLOCKED; readonly jobId: string; readonly remaining: number };

export interface EvaluateEmitHandoffInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  /** Suggested job id — read from job-shape.json when omitted. */
  readonly jobId?: string;
  readonly forceUnderJob?: boolean;
}

function countRemaining(statePath: string): number {
  let raw: string;
  try {
    raw = readFileSync(statePath, 'utf8');
  } catch {
    return Number.NaN;
  }
  let parsed: { slices?: Array<{ status?: string }> };
  try {
    parsed = JSON.parse(raw) as { slices?: Array<{ status?: string }> };
  } catch {
    return Number.NaN;
  }
  if (!Array.isArray(parsed.slices)) return Number.NaN;
  return parsed.slices.filter((sl) => sl.status !== 'done' && sl.status !== 'skipped').length;
}

function statePath(projectRoot: string, sessionId: string, jobId: string): string {
  return join(projectRoot, '.peaks', '_runtime', sessionId, 'job', jobId, 'state.json');
}

export function evaluateEmitHandoff(input: EvaluateEmitHandoffInput): EmitHandoffVerdict {
  let decision: import('./job-shape-decision.js').JobShapeDecision | null = null;
  try {
    const record = readJobShapeDecision(input.projectRoot, input.sessionId);
    decision = record.decision;
  } catch (err) {
    if (err instanceof JobShapeDecisionError && err.code === JOB_SHAPE_NOT_DECIDED) {
      return { kind: 'allow-not-job' };
    }
    throw err;
  }
  if (!decision.isJob) return { kind: 'allow-not-job' };

  const jobId = input.jobId ?? decision.suggestedJobId;
  const path = statePath(input.projectRoot, input.sessionId, jobId);
  if (!existsSync(path)) {
    return { kind: 'block-not-initialized', code: JOB_NOT_INITIALIZED, jobId };
  }
  const remaining = countRemaining(path);
  if (!Number.isFinite(remaining)) {
    return { kind: 'block-not-initialized', code: JOB_NOT_INITIALIZED, jobId };
  }
  if (remaining === 0) {
    return { kind: 'allow-done', remaining };
  }
  if (input.forceUnderJob === true) {
    return { kind: 'allow-force-override', remaining };
  }
  return { kind: 'block-remaining', code: JOB_REMAINING_BLOCKED, jobId, remaining };
}
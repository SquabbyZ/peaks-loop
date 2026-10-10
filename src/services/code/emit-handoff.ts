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
 *   - isJob === true, state.json, remaining > 0,
 *     --force-under-job                            → ALLOW (override path)
 *   - isJob === true, state.json, remaining === 0,
 *     no session sediment, no --force-no-sediment → JOB_COMPLETED_NO_SEDIMENT
 *   - isJob === true, state.json, remaining === 0,
 *     session sediment OR --force-no-sediment     → ALLOW (Job done)
 *
 * The sediment arm is the refusal point for Step 11: a completed Job whose
 * session put nothing into `.peaks/memory/` is refused, and an unanswerable
 * sediment question is refused too (fail closed).
 *
 * Karpathy §2 (Simplicity First): ~70 lines, no LLM call, no regex.
 * Pure read + arithmetic. The CLI wrapper in code-commands.ts
 * translates the verdict into exit code + JSON envelope.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isExpectedFsMiss } from '../../shared/fs-utils.js';
import {
  readJobShapeDecision,
  JobShapeDecisionError,
  JOB_SHAPE_NOT_DECIDED
} from './job-shape-decision.js';

export const JOB_NOT_INITIALIZED = 'JOB_NOT_INITIALIZED' as const;
export const JOB_REMAINING_BLOCKED = 'JOB_REMAINING_BLOCKED' as const;
export const JOB_COMPLETED_NO_SEDIMENT = 'JOB_COMPLETED_NO_SEDIMENT' as const;

/**
 * What the memory index says about this session.
 *
 * `unknown` is a first-class answer, not an error code: it means the question
 * could not be put to peaks' own store at all, and the handoff refuses on it
 * rather than assuming the session sedimented nothing.
 */
export type SessionSedimentState = 'sedimented' | 'none' | 'unknown';

export type EmitHandoffVerdict =
  | { readonly kind: 'allow-not-job' }
  | { readonly kind: 'allow-done'; readonly remaining: number }
  | { readonly kind: 'allow-force-override'; readonly remaining: number }
  | {
      readonly kind: 'block-not-initialized';
      readonly code: typeof JOB_NOT_INITIALIZED;
      readonly jobId: string;
    }
  | {
      readonly kind: 'block-remaining';
      readonly code: typeof JOB_REMAINING_BLOCKED;
      readonly jobId: string;
      readonly remaining: number;
    }
  | {
      readonly kind: 'block-no-sediment';
      readonly code: typeof JOB_COMPLETED_NO_SEDIMENT;
      readonly jobId: string;
      /** `none` = the index was read and holds no entry for this session. */
      readonly sedimentState: Exclude<SessionSedimentState, 'sedimented'>;
    }
  | {
      readonly kind: 'allow-forced-no-sediment';
      readonly remaining: number;
      /** The reason the user approved a no-sediment outcome. Never blank. */
      readonly reason: string;
      readonly sedimentState: Exclude<SessionSedimentState, 'sedimented'>;
    };

export interface EvaluateEmitHandoffInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  /** Suggested job id — read from job-shape.json when omitted. */
  readonly jobId?: string;
  readonly forceUnderJob?: boolean;
  /**
   * The reason the user approved a no-sediment outcome. Present and non-blank
   * overrides the completed-Job no-sediment block; blank is treated as absent,
   * so an override nobody justified does not open the gate.
   */
  readonly forceNoSedimentReason?: string;
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

/**
 * Which session a memory came from, as the memory index records it.
 *
 * The runtime directory is the link: `peaks memory extract` stamps each
 * extracted memory with the `sourceArtifact` it read, and every artifact a
 * session can sediment from lives under its own runtime directory, so an
 * index entry naming this session's runtime directory IS this session's
 * sediment. Nothing here reads a modification time.
 */
function sourceArtifactNamesSession(sourceArtifact: unknown, sessionId: string): boolean {
  if (typeof sourceArtifact !== 'string') return false;
  return sourceArtifact.replaceAll('\\', '/').includes(`_runtime/${sessionId}/`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One `hot` / `warm` bucket flattened to its entries, or null when the bucket
 * is not the shape this reader knows. A bucket whose kind maps to something
 * other than a list is a shape deviation, and a shape deviation has to read as
 * "cannot tell" rather than as "no entries": the two answers disagree about
 * whether the handoff may proceed.
 */
function bucketEntries(bucket: unknown): unknown[] | null {
  if (!isPlainRecord(bucket)) return null;
  const entries: unknown[] = [];
  for (const list of Object.values(bucket)) {
    if (!Array.isArray(list)) return null;
    for (const entry of list as unknown[]) entries.push(entry);
  }
  return entries;
}

/** Every index entry, or null when the file is not the shape this reader knows. */
function readIndexEntries(parsed: unknown): unknown[] | null {
  if (!isPlainRecord(parsed)) return null;
  const hot = bucketEntries(parsed.hot);
  const warm = bucketEntries(parsed.warm);
  if (hot === null || warm === null) return null;
  return [...hot, ...warm];
}

/**
 * Did this session sediment anything into the project memory store?
 *
 * The basis is peaks' own memory index, which both `peaks memory extract
 * --apply` paths rebuild after writing, so it is a peaks-owned projection of
 * the store rather than a guess about timestamps.
 */
function readSessionSedimentState(projectRoot: string, sessionId: string): SessionSedimentState {
  const indexPath = join(projectRoot, '.peaks', 'memory', 'index.json');
  if (!existsSync(indexPath)) return 'unknown';
  let raw: string;
  try {
    raw = readFileSync(indexPath, 'utf8');
  } catch (err) {
    if (!isExpectedFsMiss(err)) throw err;
    return 'unknown';
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'unknown';
  }
  const entries = readIndexEntries(parsed);
  if (entries === null) return 'unknown';
  for (const entry of entries) {
    if (!isPlainRecord(entry)) return 'unknown';
    if (sourceArtifactNamesSession(entry.sourceArtifact, sessionId)) return 'sedimented';
  }
  return 'none';
}

/** A blank override reason is the same as no override at all. */
function approvedNoSedimentReason(reason: string | undefined): string | null {
  if (reason === undefined) return null;
  const trimmed = reason.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * The verdict for a Job with no slices left. This is the moment Step 11 is
 * owed: the workflow is about to be declared complete, so the session must
 * have sedimented something, or have been granted an explicit no-sediment
 * outcome. `unknown` refuses too — cannot tell is not a pass.
 */
function decideCompletedJob(input: EvaluateEmitHandoffInput, jobId: string): EmitHandoffVerdict {
  const sedimentState = readSessionSedimentState(input.projectRoot, input.sessionId);
  if (sedimentState === 'sedimented') {
    return { kind: 'allow-done', remaining: 0 };
  }
  const approvedReason = approvedNoSedimentReason(input.forceNoSedimentReason);
  if (approvedReason !== null) {
    return {
      kind: 'allow-forced-no-sediment',
      remaining: 0,
      reason: approvedReason,
      sedimentState
    };
  }
  return { kind: 'block-no-sediment', code: JOB_COMPLETED_NO_SEDIMENT, jobId, sedimentState };
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
  if (remaining > 0) {
    return input.forceUnderJob === true
      ? { kind: 'allow-force-override', remaining }
      : { kind: 'block-remaining', code: JOB_REMAINING_BLOCKED, jobId, remaining };
  }
  return decideCompletedJob(input, jobId);
}

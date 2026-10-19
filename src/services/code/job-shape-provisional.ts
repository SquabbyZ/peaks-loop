/**
 * Backlog §17.1 fix (3) — the provisional Job-shape decision `peaks job init`
 * leaves behind.
 *
 * WHY. `peaks job init` writes `job/<jid>/state.json`, and the Step 0.8 gate
 * reads that ledger with no `job-shape.json` as "`peaks code detect-job` was
 * skipped" — every Bash call in the session is then refused, and the printed
 * remedy is itself a Bash call. The gate cannot tell "the LLM forgot" from
 * "the tooling created a ledger first", so `job init` records the one decision
 * its own ledger implies: isJob=true for this job, at medium confidence,
 * labelled provisional so a reader knows nobody judged the prompt.
 *
 * ORDER: ledger first, decision second (the PRD's chosen order). A decision
 * with no ledger would point at a job that does not exist; a ledger with no
 * decision is exactly the state a later `detect-job` corrects.
 *
 * NEVER OVERWRITES. An existing `job-shape.json` — `isJob: true` or `false`,
 * written by the LLM or by an earlier `job init`, parseable or not — is left
 * byte-identical. Any other failure (an id the decision schema refuses, a
 * read-only runtime dir) is RETURNED rather than thrown: the ledger is already
 * on disk, so the caller must report both facts accurately.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  JobShapeDecisionError,
  JOB_SHAPE_ALREADY_DECIDED,
  JOB_SHAPE_FILE_NAME,
  readJobShapeDecision,
  writeJobShapeDecision,
  type JobStrategy
} from './job-shape-decision.js';

export interface ProvisionalDecisionInput {
  readonly jobId: string;
  readonly strategy: JobStrategy;
}

export type ProvisionalDecisionOutcome =
  | { readonly written: true; readonly path: string }
  | { readonly written: false; readonly path: string; readonly reason: 'already-decided' }
  | {
      readonly written: false;
      readonly path: string;
      readonly reason: 'invalid-existing' | 'write-failed';
      readonly error: string;
    };

function provisionalRationale(jobId: string): string {
  return (
    `Provisional decision written by \`peaks job init\` when it created the Job ledger for ` +
    `"${jobId}": a ledger existed before any Job-shape decision was recorded. The job is ` +
    `treated as Job-shaped so the Step 0.8 gate can allow. Re-record it with ` +
    `\`peaks code detect-job --is-job true --suggested-job-id ${jobId} --force\` once the shape is known.`
  );
}

/**
 * Ensure `.peaks/_runtime/<sessionId>/job-shape.json` exists, writing a
 * provisional decision only when the path is empty.
 *
 * An existing file is classified by reading it, never by overwriting it: a
 * readable decision is `already-decided`, and an unreadable one is
 * `invalid-existing` so the caller can surface the corruption and the
 * `--force` remedy. The writer's own `JOB_SHAPE_ALREADY_DECIDED` on a race is
 * folded into `already-decided` — the winner's decision stands.
 */
export function ensureProvisionalJobShapeDecision(
  projectRoot: string,
  sessionId: string,
  input: ProvisionalDecisionInput
): ProvisionalDecisionOutcome {
  const path = join(projectRoot, '.peaks', '_runtime', sessionId, JOB_SHAPE_FILE_NAME);
  if (existsSync(path)) {
    try {
      readJobShapeDecision(projectRoot, sessionId);
      return { written: false, path, reason: 'already-decided' };
    } catch (err) {
      if (err instanceof JobShapeDecisionError) {
        return { written: false, path, reason: 'invalid-existing', error: err.message };
      }
      throw err;
    }
  }
  try {
    writeJobShapeDecision(projectRoot, sessionId, {
      isJob: true,
      rationale: provisionalRationale(input.jobId),
      suggestedJobId: input.jobId,
      suggestedStrategy: input.strategy,
      confidence: 'medium',
      prompt: `provisional:peaks job init:${input.jobId}`
    });
    return { written: true, path };
  } catch (err) {
    // A concurrent writer won the race after the check above; its decision is
    // the one that stands, so this is the same outcome as "already decided".
    if (err instanceof JobShapeDecisionError && err.code === JOB_SHAPE_ALREADY_DECIDED) {
      return { written: false, path, reason: 'already-decided' };
    }
    return {
      written: false,
      path,
      reason: 'write-failed',
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

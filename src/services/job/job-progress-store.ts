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
 * The `peaks code gate-step-08` hook reads this file in its case-1 path
 * (job-shape.json says isJob=true) and surfaces the next-slice sentence built by
 * {@link describeNextSlice} — `Next: slice #N of M (<label>)` only while the
 * ledger has a slice pending — to stdout. The LLM cannot "wake up cold" — the
 * next-slice context is mechanically injected on every Bash call.
 *
 * Karpathy §2 (Simplicity First): one small file — write the mirror, read the
 * mirror, and put the mirror into words (describeNextSlice).
 * Schema is zod-validated on read so a stale on-disk copy
 * from an earlier peaks-loop release fails loud (no silent fallback).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import { guardRuntimeSegment, runtimeRoot } from '../../shared/runtime-root.js';

/**
 * The single place a job-progress directory is built, and therefore the single
 * place the two ids that reach it are guarded.
 *
 * Slice 2026-09-15 (runtime-path-unrepresentable): this join used to be written
 * at three sites, none of them guarded, and the shipped text rule could not see
 * them — they sit in the service layer, outside the command layer it scans.
 * Both ids are caller-supplied (`peaks job checkpoint` takes them from flags).
 * The seam now requires `GuardedSegment`, so dropping either guard is a compile
 * error rather than a finding someone has to notice.
 */
function jobProgressDir(projectRoot: string, sessionId: string, jobId: string): string {
  return runtimeRoot(projectRoot).join(
    guardRuntimeSegment(sessionId, 'session id'),
    guardRuntimeSegment('job', 'role'),
    guardRuntimeSegment(jobId, 'job id')
  );
}

export const JOB_PROGRESS_SCHEMA_VERSION = 1 as const;

/**
 * D3 (rid 2026-10-03-job-ledger-truthfulness) — what the mirror says when the
 * ledger has no pending slice.
 *
 * `currentSlice` is required by the schema below (it is a `string`, and readers
 * such as `src/services/code/step-08-gate.ts` and
 * `src/services/context/post-compact-reinjection.ts` print it inside the
 * next-slice sentence), so a job with nothing left still has
 * to put SOMETHING in the field. Until this slice the CLI invented an identity
 * for it — `slice-${state.done + 1}` — and §2.38 caught the result:
 * `currentSlice: "slice-2"` on a job whose only registered slice was
 * `slice-001`, already done. A label that describes no slice in the ledger is not
 * a placeholder, it is a false claim about the work.
 *
 * So the value is a sentence about the state, not a name: it matches no
 * `sliceId`, no `label`, and no `slice-<digits>` shape a caller could mistake for
 * one. Changing the FIELD (or making it optional) is out of scope — readers
 * already consume it — this only decides what honest text goes in when there is
 * no next slice. {@link describeNextSlice} is what turns that field into the line
 * a reader sees; it recognises this value rather than printing it.
 */
export const NO_PENDING_SLICE_LABEL = 'no slice pending';

export const JobProgressSchema = z.object({
  schemaVersion: z.literal(JOB_PROGRESS_SCHEMA_VERSION),
  jobId: z.string(),
  done: z.number().int().gte(0),
  total: z.number().int().gt(0),
  currentSlice: z.string(),
  lastCommitSha: z.string().nullable(),
  updatedAt: z.string().datetime()
});

export type JobProgress = z.infer<typeof JobProgressSchema>;

export interface WriteProgressInput {
  readonly jobId: string;
  readonly done: number;
  readonly total: number;
  /**
   * The next slice to work on, as the ledger names it.
   *
   * D3: `undefined` means the ledger has no pending slice — the writer then
   * records `NO_PENDING_SLICE_LABEL`. It is deliberately NOT the caller's job to
   * supply a stand-in: every caller that had to invent one invented a slice id.
   */
  readonly currentSlice: string | undefined;
  readonly lastCommitSha: string | null;
  readonly updatedAt?: string;
}

export function writeJobProgress(
  projectRoot: string,
  sessionId: string,
  input: WriteProgressInput
): JobProgress {
  const dir = jobProgressDir(projectRoot, sessionId, input.jobId);
  mkdirSync(dir, { recursive: true });
  const record: JobProgress = {
    schemaVersion: JOB_PROGRESS_SCHEMA_VERSION,
    jobId: input.jobId,
    done: input.done,
    total: input.total,
    currentSlice: input.currentSlice ?? NO_PENDING_SLICE_LABEL,
    lastCommitSha: input.lastCommitSha,
    updatedAt: input.updatedAt ?? new Date().toISOString()
  };
  const path = join(dir, 'progress.json');
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return record;
}

export function readJobProgress(
  projectRoot: string,
  sessionId: string,
  jobId: string
): JobProgress {
  const path = join(jobProgressDir(projectRoot, sessionId, jobId), 'progress.json');
  if (!existsSync(path)) {
    throw new Error(`JobProgressStore: no progress for ${jobId} at ${path}`);
  }
  const raw = readFileSync(path, 'utf8');
  return JobProgressSchema.parse(JSON.parse(raw));
}

export function tryReadJobProgress(
  projectRoot: string,
  sessionId: string,
  jobId: string
): JobProgress | null {
  const path = join(jobProgressDir(projectRoot, sessionId, jobId), 'progress.json');
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    return JobProgressSchema.parse(JSON.parse(raw));
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

/** What the next-slice sentence is allowed to reason about. */
export interface NextSliceFacts {
  readonly done: number;
  readonly total: number;
  readonly currentSlice: string;
}

/** The advice command's label slot: a shape to fill in, never a made-up slice name. */
const ADD_SLICE_LABEL_SLOT = '"<label>"';

function addSliceAdvice(jobId: string | null | undefined): string {
  return `peaks job add-slice --job-id ${jobId ?? '<job-id>'} --slice-label ${ADD_SLICE_LABEL_SLOT}`;
}

/**
 * criterion (c) (rid 2026-10-03-job-ledger-repair1) — the one sentence the reader
 * acts on, built from the mirror instead of guessed at.
 *
 * WHY THIS EXISTS. The parent slice made `currentSlice` honest (§2.38: it used to
 * carry `slice-2` on a job whose only slice was `slice-001`), and left every reader
 * of the mirror interpolating it into `slice #${done + 1} of ${total}`. Measured on
 * the built tree, a finished two-slice job printed
 *
 *   next: Next: slice #3 of 2 (no slice pending)
 *
 * So the field said the truth and the line said something the ledger cannot
 * support: an index for a slice that does not exist, in the one line a human or a
 * resumed LLM actually reads. `done + 1` is only ever entitled to be an index when
 * the ledger still has a slice pending, which is exactly the state
 * {@link NO_PENDING_SLICE_LABEL} records.
 *
 * THE RULE, in the order the branches are taken:
 * - nothing pending and every registered slice done → say none is registered left,
 *   and name the command that changes that (`add-slice`), with the job id filled in;
 * - nothing pending but registered slices unfinished (blocked / failed / skipped)
 *   → say none is PENDING; claiming `slice #N` there would promote the index of a
 *   slice the ledger has stopped queueing;
 * - pending, and `done` has not yet consumed `total` → the ordinary
 *   `slice #N of M`, and this is the only branch that may print an index;
 * - pending, but the mirror already records `total` done → the mirror contradicts
 *   itself (it is a file another process writes). Print no index, name the slice,
 *   and send the reader to the authority — `peaks job status`.
 *
 * All three shipped readers call this, so the sentence and the command it advises
 * cannot drift apart again.
 */
export function describeNextSlice(progress: NextSliceFacts, jobId?: string | null): string {
  const id = jobId ?? '<job-id>';
  if (progress.currentSlice === NO_PENDING_SLICE_LABEL) {
    return progress.done >= progress.total
      ? `no further slice is registered — add one with: ${addSliceAdvice(id)}`
      : `no slice is pending — ${progress.done} of ${progress.total} registered slices are ` +
          `done and the rest are not pending; add one with: ${addSliceAdvice(id)}`;
  }
  if (progress.done >= progress.total) {
    return (
      `the progress mirror names pending slice "${progress.currentSlice}" while recording ` +
      `${progress.done} of ${progress.total} slices done — trust the ledger: ` +
      `peaks job status --job-id ${id}`
    );
  }
  return `slice #${progress.done + 1} of ${progress.total} (${progress.currentSlice})`;
}

import { JobStateStore, type JobInitInput } from './job-state-store.js';
import { type JobState, type JobStatusSummary, type SliceState } from './job-types.js';

export interface CheckpointDoneInput {
  jobId: string;
  sliceId: string;
  commitSha?: string;
}
export interface CheckpointSkipInput {
  jobId: string;
  sliceId: string;
  reason: string;
}
export interface BlockInput {
  jobId: string;
  sliceId: string;
  reason: string;
}

/** `peaks job add-slice` input, after the command has trimmed and checked shape. */
export interface AddSliceInput {
  readonly jobId: string;
  readonly label: string;
}

/**
 * What `addSlice` did. `added: false` is a SUCCESSFUL outcome — the label was
 * already a slice of this job, so the honest answer is the slice that exists and
 * a state file that was not written.
 */
export interface AddSliceOutcome {
  readonly added: boolean;
  readonly sliceId: string;
  readonly label: string;
  readonly total: number;
}

/**
 * `3` = the zero-padding width of the CLI's own `slice-NNN` id, the same width
 * `JobStateStore.init` writes. Named because the pad is a convention, not a
 * number to repeat.
 */
const SLICE_ID_PAD_WIDTH = 3;

/**
 * The next free `slice-NNN` id: one past the highest number already in use, not
 * `length + 1`. Two jobs whose slices were added out of order therefore cannot
 * collide, and a list that somehow holds 12 slices still gets `slice-012`.
 */
function nextSliceId(slices: readonly SliceState[]): string {
  let highest = 0;
  for (const sl of slices) {
    const digits = /^slice-(\d+)$/.exec(sl.sliceId);
    if (digits !== null) highest = Math.max(highest, Number(digits[1]));
  }
  return `slice-${String(highest + 1).padStart(SLICE_ID_PAD_WIDTH, '0')}`;
}

export class JobOrchestrator {
  constructor(private readonly store: JobStateStore) {}

  init(input: JobInitInput): JobState {
    return this.store.init(input);
  }

  /**
   * D1 (rid 2026-10-03-job-ledger-truthfulness) — register one more slice on an
   * existing job.
   *
   * WHY THIS EXISTS. The slice list was decided once, at `peaks job init
   * --slice-list`, and nothing could add to it. A wave that discovers its slices
   * one at a time — which is how every split wave in this repository actually
   * runs — could not record the slices it found: `checkpoint --slice-id
   * <new-work>` answered `SLICE_NOT_FOUND` and `progress` kept reporting the
   * `total` `init` wrote, so the ledger recorded the tooling's limitation instead
   * of the work.
   *
   * THE CONTRACT, and the parts of it that are the point:
   * - **idempotent and honest** — a label already registered on this job is
   *   reported as itself with `added: false`, and `state.json` is never opened
   *   for writing. Re-running the command cannot grow the job.
   * - **never a silent duplicate** — an empty or whitespace-only label throws;
   *   the command turns that into a structured refusal before it gets here.
   * - **`total` follows** — the count every reader derives from `slices.length`
   *   (`status`, `progress`, `continue`), so nothing has to be re-initialised.
   *
   * The label is the caller's string; `sliceId` stays the CLI's own
   * `slice-NNN`, so `checkpoint`/`block` resolve the new slice by either name
   * through the existing D7 resolution in `job-commands.ts`.
   */
  addSlice(input: AddSliceInput): AddSliceOutcome {
    const label = input.label.trim();
    if (label.length === 0) {
      throw new Error('addSlice: slice label must not be empty');
    }
    const before = this.store.load(input.jobId);
    const already = before.slices.find((sl) => sl.label === label);
    if (already !== undefined) {
      return {
        added: false,
        sliceId: already.sliceId,
        label: already.label,
        total: before.slices.length
      };
    }
    const after = this.mutate(input.jobId, (s) => {
      if (s.slices.some((sl) => sl.label === label)) return s;
      const appended: SliceState = {
        sliceId: nextSliceId(s.slices),
        label,
        status: 'pending',
        repairCycles: 0
      };
      return { ...s, slices: [...s.slices, appended] };
    });
    const registered = after.slices.find((sl) => sl.label === label);
    if (registered === undefined) {
      throw new Error(
        `addSlice: internal — "${label}" is not registered in the saved state for ${input.jobId}`
      );
    }
    return {
      added: after.slices.length > before.slices.length,
      sliceId: registered.sliceId,
      label: registered.label,
      total: after.slices.length
    };
  }

  /**
   * Atomically apply a mutation to a job's state under a single-process lock.
   *
   * Uses the M2.1 single-process lock model (lock file checked with `existsSync`).
   * State is loaded before lock acquisition, so `fn` receives a consistent snapshot;
   * if `tryAcquireLock` throws because the job is already locked, `fn` is never called
   * and the error bubbles to the caller. Concurrent `mutate` calls in the same process
   * will collide, so callers MUST serialize externally or wrap calls in a higher-level
   * mutex if multi-process support is added later.
   *
   * @param jobId - The job identifier whose state will be mutated.
   * @param fn - Pure transform applied to the loaded state to produce the next state.
   * @returns The new state after the mutation is persisted.
   */
  private mutate(jobId: string, fn: (s: JobState) => JobState): JobState {
    const state = this.store.load(jobId);
    const lock = this.store.tryAcquireLock(jobId);
    try {
      const next = fn(state);
      this.store.save(next);
      return next;
    } finally {
      this.store.releaseLock(lock);
    }
  }

  async checkpointDone(input: CheckpointDoneInput): Promise<JobState> {
    return this.mutate(input.jobId, (s) => {
      if (!input.commitSha || input.commitSha.length < 7) {
        throw new Error('checkpointDone: commitSha required (≥7 hex)');
      }
      return {
        ...s,
        lastCheckpointAt: new Date().toISOString(),
        slices: s.slices.map((sl) =>
          sl.sliceId === input.sliceId
            ? {
                ...sl,
                status: 'done',
                commitSha: input.commitSha,
                finishedAt: new Date().toISOString()
              }
            : sl
        )
      };
    });
  }

  async checkpointSkipped(input: CheckpointSkipInput): Promise<JobState> {
    return this.mutate(input.jobId, (s) => ({
      ...s,
      lastCheckpointAt: new Date().toISOString(),
      slices: s.slices.map((sl) =>
        sl.sliceId === input.sliceId ? { ...sl, status: 'skipped' } : sl
      )
    }));
  }

  async checkpointFailed(input: {
    jobId: string;
    sliceId: string;
    reason: string;
  }): Promise<JobState> {
    return this.mutate(input.jobId, (s) => ({
      ...s,
      lastCheckpointAt: new Date().toISOString(),
      slices: s.slices.map((sl) =>
        sl.sliceId === input.sliceId
          ? {
              ...sl,
              status: 'failed',
              failureReason: input.reason,
              finishedAt: new Date().toISOString()
            }
          : sl
      )
    }));
  }

  async blockSlice(input: BlockInput): Promise<JobState> {
    return this.mutate(input.jobId, (s) => ({
      ...s,
      lastCheckpointAt: new Date().toISOString(),
      slices: s.slices.map((sl) =>
        sl.sliceId === input.sliceId
          ? {
              ...sl,
              status: 'blocked',
              blockedReason: input.reason,
              finishedAt: new Date().toISOString()
            }
          : sl
      )
    }));
  }

  status(jobId: string): JobStatusSummary {
    const s = this.store.load(jobId);
    const counts = { done: 0, failed: 0, blocked: 0, skipped: 0 };
    for (const sl of s.slices) {
      if (sl.status === 'done') counts.done++;
      else if (sl.status === 'failed') counts.failed++;
      else if (sl.status === 'blocked') counts.blocked++;
      else if (sl.status === 'skipped') counts.skipped++;
    }
    const pendingIdx = s.slices.findIndex(
      (sl) => sl.status === 'pending' || sl.status === 'in-progress'
    );
    return {
      total: s.slices.length,
      done: counts.done,
      failed: counts.failed,
      blocked: counts.blocked,
      skipped: counts.skipped,
      currentSlice: pendingIdx >= 0 ? s.slices[pendingIdx]!.label : undefined,
      lastCheckpoint: s.lastCheckpointAt,
      mainLoopStrategy: s.mainLoopStrategy,
      mainSessionCycle: s.mainSessionCycle
    };
  }

  continueNow(jobId: string): { remaining: number; next: string | undefined } {
    const summary = this.status(jobId);
    return {
      remaining: summary.total - summary.done - summary.skipped - summary.blocked - summary.failed,
      next: summary.currentSlice
    };
  }
}

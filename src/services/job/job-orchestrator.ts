import { JobStateStore, type JobInitInput } from './job-state-store.js';
import {
  type JobState,
  type JobStatusSummary,
} from './job-types.js';

export interface CheckpointDoneInput { jobId: string; sliceId: string; commitSha?: string; }
export interface CheckpointSkipInput { jobId: string; sliceId: string; reason: string; }
export interface BlockInput { jobId: string; sliceId: string; reason: string; }

export class JobOrchestrator {
  constructor(private readonly store: JobStateStore) {}

  init(input: JobInitInput): JobState {
    return this.store.init(input);
  }

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
            ? { ...sl, status: 'done', commitSha: input.commitSha, finishedAt: new Date().toISOString() }
            : sl,
        ),
      };
    });
  }

  async checkpointSkipped(input: CheckpointSkipInput): Promise<JobState> {
    return this.mutate(input.jobId, (s) => ({
      ...s,
      lastCheckpointAt: new Date().toISOString(),
      slices: s.slices.map((sl) =>
        sl.sliceId === input.sliceId ? { ...sl, status: 'skipped' } : sl,
      ),
    }));
  }

  async checkpointFailed(input: { jobId: string; sliceId: string; reason: string }): Promise<JobState> {
    return this.mutate(input.jobId, (s) => ({
      ...s,
      lastCheckpointAt: new Date().toISOString(),
      slices: s.slices.map((sl) =>
        sl.sliceId === input.sliceId
          ? { ...sl, status: 'failed', failureReason: input.reason, finishedAt: new Date().toISOString() }
          : sl,
      ),
    }));
  }

  async blockSlice(input: BlockInput): Promise<JobState> {
    return this.mutate(input.jobId, (s) => ({
      ...s,
      lastCheckpointAt: new Date().toISOString(),
      slices: s.slices.map((sl) =>
        sl.sliceId === input.sliceId
          ? { ...sl, status: 'blocked', blockedReason: input.reason, finishedAt: new Date().toISOString() }
          : sl,
      ),
    }));
  }

  status(jobId: string): JobStatusSummary {
    const s = this.store.load(jobId);
    const counts = { done: 0, failed: 0, blocked: 0, skipped: 0 } as const;
    for (const sl of s.slices) {
      if (sl.status === 'done') counts.done++;
      else if (sl.status === 'failed') counts.failed++;
      else if (sl.status === 'blocked') counts.blocked++;
      else if (sl.status === 'skipped') counts.skipped++;
    }
    const pendingIdx = s.slices.findIndex(sl => sl.status === 'pending' || sl.status === 'in-progress');
    return {
      total: s.slices.length,
      done: counts.done,
      failed: counts.failed,
      blocked: counts.blocked,
      skipped: counts.skipped,
      currentSlice: pendingIdx >= 0 ? s.slices[pendingIdx]!.label : undefined,
      lastCheckpoint: s.lastCheckpointAt,
      mainLoopStrategy: s.mainLoopStrategy,
      mainSessionCycle: s.mainSessionCycle,
    };
  }

  continueNow(jobId: string): { remaining: number; next: string | undefined } {
    const summary = this.status(jobId);
    return { remaining: summary.total - summary.done - summary.skipped - summary.blocked - summary.failed, next: summary.currentSlice };
  }
}

import { JobStateStore } from './job-state-store.js';

export interface WrapInput {
  jobId: string;
  role: 'prd' | 'rd' | 'qa' | 'ui' | 'txt' | 'sc' | 'agent';
  prompt: string;
  budgetMb?: number;                  // default 512 per spec §6.3 red line #6
}

export interface DispatchResult { batchId: string; }

export interface DispatchOpts { budgetMb: number; jobScope: true; batchId: string; }

export type DispatchFn = (role: string, prompt: string, opts: DispatchOpts) => Promise<DispatchResult>;

export interface WrapOutput { batchId: string; requiresCleanup: true; }

export class SubAgentJobWrapper {
  private readonly dispatchedBatches = new Map<string, Set<string>>(); // jobId -> set of batchIds pending cleanup

  constructor(
    private readonly store: JobStateStore,
    private readonly dispatch: DispatchFn,
  ) {}

  async wrap(input: WrapInput): Promise<WrapOutput> {
    const budgetMb = input.budgetMb ?? 512;
    const candidateBatchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await this.dispatch(input.role, input.prompt, { budgetMb, jobScope: true, batchId: candidateBatchId });
    const batchId = result.batchId;
    if (!this.dispatchedBatches.has(input.jobId)) this.dispatchedBatches.set(input.jobId, new Set());
    this.dispatchedBatches.get(input.jobId)!.add(batchId);
    return { batchId, requiresCleanup: true };
  }

  canCheckpointDone(jobId: string, batchId: string): boolean {
    const set = this.dispatchedBatches.get(jobId);
    return !set?.has(batchId);
  }

  async cleanup(input: { jobId: string; batchId: string; force: boolean }): Promise<{ cleaned: boolean }> {
    const set = this.dispatchedBatches.get(input.jobId);
    if (!set?.has(input.batchId)) return { cleaned: true };
    set.delete(input.batchId);
    return { cleaned: true };
  }
}
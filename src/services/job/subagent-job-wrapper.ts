import { getErrorMessage } from 'peaks-loop-shared/result';

import type { JobStateStore } from './job-state-store.js';
import { readActiveDispatchIndex } from '../dispatch/active-dispatch-index.js';
import { markCompleted } from '../dispatch/dispatch-record-writer.js';

export interface WrapInput {
  jobId: string;
  role: 'prd' | 'rd' | 'qa' | 'ui' | 'txt' | 'sc' | 'agent';
  prompt: string;
  budgetMb?: number; // default 512 per spec §6.3 red line #6
}

export interface DispatchResult {
  batchId: string;
}

export interface DispatchOpts {
  budgetMb: number;
  jobScope: true;
  batchId: string;
}

export type DispatchFn = (
  role: string,
  prompt: string,
  opts: DispatchOpts
) => Promise<DispatchResult>;

export interface WrapOutput {
  batchId: string;
  requiresCleanup: true;
}

export class SubAgentJobWrapper {
  private readonly dispatchedBatches = new Map<string, Set<string>>(); // jobId -> set of batchIds pending cleanup

  constructor(
    private readonly store: JobStateStore,
    private readonly dispatch: DispatchFn
  ) {}

  async wrap(input: WrapInput): Promise<WrapOutput> {
    const budgetMb = input.budgetMb ?? 512;
    const candidateBatchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await this.dispatch(input.role, input.prompt, {
      budgetMb,
      jobScope: true,
      batchId: candidateBatchId
    });
    const batchId = result.batchId;
    if (!this.dispatchedBatches.has(input.jobId))
      this.dispatchedBatches.set(input.jobId, new Set());
    this.dispatchedBatches.get(input.jobId)!.add(batchId);
    return { batchId, requiresCleanup: true };
  }

  canCheckpointDone(jobId: string, batchId: string): boolean {
    const set = this.dispatchedBatches.get(jobId);
    return !set?.has(batchId);
  }

  async cleanup(input: CleanupInput): Promise<CleanupResult> {
    this.dispatchedBatches.get(input.jobId)?.delete(input.batchId);
    if (input.projectRoot === undefined || input.sessionId === undefined) {
      return { cleaned: true, cleanedRecords: [], skipped: [] };
    }
    return cleanLedgerBatch({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
      batchId: input.batchId,
      force: input.force
    });
  }
}

export interface CleanupInput {
  jobId: string;
  batchId: string;
  force: boolean;
  /**
   * On-disk ledger context, supplied by the CLI. Omitted by same-process
   * callers, which keep the in-memory map above as their pending set.
   */
  projectRoot?: string;
  sessionId?: string;
}

export interface CleanupResult {
  cleaned: boolean;
  cleanedRecords: string[];
  skipped: { recordPath: string; reason: string }[];
}

/**
 * Clean a batch by its rows in `.peaks/_sub_agents/<sessionId>/active-dispatches.json`
 * — the ledger the dispatching process wrote, not a set a fresh CLI process
 * cannot have populated.
 *
 * A row is finalized (`status: 'done'` on the record, row removed from the
 * index) when it is `queued`, the same rows `sub-agent finalize --batch` acts
 * on. `--force` extends that to rows in any other status. An absent batch
 * cleans nothing and reports `cleaned: false`: "nothing to clean" must not
 * read as "cleaned it".
 */
function cleanLedgerBatch(input: {
  projectRoot: string;
  sessionId: string;
  batchId: string;
  force: boolean;
}): CleanupResult {
  const result: CleanupResult = { cleaned: false, cleanedRecords: [], skipped: [] };
  const rows = Object.values(readActiveDispatchIndex(input.projectRoot, input.sessionId));
  for (const entry of rows) {
    if (entry.batchId !== input.batchId) continue;
    if (entry.status !== 'queued' && !input.force) {
      result.skipped.push({
        recordPath: entry.recordPath,
        reason: `status is ${entry.status}; pass --force to clean it anyway`
      });
      continue;
    }
    try {
      markCompleted({
        recordPath: entry.recordPath,
        projectRoot: input.projectRoot,
        status: 'done',
        outcome: 'success'
      });
      result.cleanedRecords.push(entry.recordPath);
    } catch (error: unknown) {
      result.skipped.push({ recordPath: entry.recordPath, reason: getErrorMessage(error) });
    }
  }
  result.cleaned = result.cleanedRecords.length > 0;
  return result;
}

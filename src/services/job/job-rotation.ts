import { JobStateStore } from './job-state-store.js';

export interface CycleOutcome { rotated: boolean; reason?: string; }

export interface CycleSummary { jobId: string; cycle: number; }

export class JobRotation {
  constructor(
    private readonly store: JobStateStore,
    private readonly sessionRotateImpl: (jobId: string) => Promise<CycleOutcome>,
    private readonly sessionCycleSummaryImpl: (jobId: string) => Promise<CycleSummary>,
  ) {}

  async cycleIfDue(jobId: string, slicesJustCompleted: number): Promise<CycleOutcome> {
    const state = this.store.load(jobId);
    if (state.mainLoopStrategy !== 'rotating') return { rotated: false, reason: 'single-mode' };
    if (slicesJustCompleted <= 0) return { rotated: false, reason: 'no-progress' };
    if (slicesJustCompleted % state.rotateEvery !== 0) return { rotated: false, reason: 'not-on-cadence' };
    return this.rotateNow(jobId);
  }

  async rotateNow(jobId: string): Promise<CycleOutcome> {
    const state = this.store.load(jobId);
    const summary = await this.sessionCycleSummaryImpl(jobId);
    const outcome = await this.sessionRotateImpl(jobId);
    if (!outcome.rotated) return { rotated: false, reason: 'session-rotate-refused' };
    const nextCycle = state.mainSessionCycle + 1;
    this.store.save({ ...state, mainSessionCycle: nextCycle, lastCheckpointAt: new Date().toISOString() });
    return { rotated: true, reason: `cycle-${nextCycle} (${summary.cycle})` };
  }
}

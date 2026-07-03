import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { JobStateSchema, type JobState } from './job-types.js';

export interface JobInitInput {
  jobId: string;
  sessionId: string;
  sliceList: string[];
  parallelismHint: 'serial' | 'llm-decides';
  exitPolicy: 'strict' | 'best-effort';
  mainLoopStrategy: 'single' | 'rotating';
  rotateEvery: number;
}

export interface JobLock {
  jobId: string;
  path: string;
}

export class JobStateStore {
  constructor(private readonly rootDir: string) {}

  private jobDir(jobId: string): string {
    return join(this.rootDir, jobId);
  }

  init(input: JobInitInput): JobState {
    const state: JobState = JobStateSchema.parse({
      jobId: input.jobId,
      sessionId: input.sessionId,
      startedAt: new Date().toISOString(),
      lastCheckpointAt: new Date().toISOString(),
      parallelismHint: input.parallelismHint,
      exitPolicy: input.exitPolicy,
      mainLoopStrategy: input.mainLoopStrategy,
      rotateEvery: input.rotateEvery,
      mainSessionCycle: 0,
      slices: input.sliceList.map((label, i) => ({
        sliceId: `slice-${String(i + 1).padStart(3, '0')}`,
        label,
        status: 'pending',
        repairCycles: 0,
      })),
    });
    this.save(state);
    return state;
  }

  load(jobId: string): JobState {
    const p = join(this.jobDir(jobId), 'state.json');
    if (!existsSync(p)) throw new Error(`JobStateStore.load: no state for ${jobId} at ${p}`);
    return JobStateSchema.parse(JSON.parse(readFileSync(p, 'utf8')));
  }

  save(state: JobState): void {
    // Re-parse to fail loudly on schema regression (M2 unit-test expects this).
    const valid = JobStateSchema.parse(state);
    const dir = this.jobDir(valid.jobId);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'state.json');
    writeFileSync(path, JSON.stringify(valid, null, 2) + '\n', 'utf8');
  }

  tryAcquireLock(jobId: string): JobLock {
    const lockPath = join(this.jobDir(jobId), 'state.lock');
    mkdirSync(dirname(lockPath), { recursive: true });
    if (existsSync(lockPath)) throw new Error(`JobStateStore: state already locked at ${lockPath}`);
    writeFileSync(lockPath, `${process.pid}@${new Date().toISOString()}\n`, 'utf8');
    return { jobId, path: lockPath };
  }

  releaseLock(lock: JobLock): void {
    if (existsSync(lock.path)) {
      unlinkSync(lock.path);
    }
  }
}

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobStateStore } from '../../../../src/services/job/job-state-store.js';
import { JobStateSchema, type JobState } from '../../../../src/services/job/job-types.js';

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'job-state-store-'));
});

describe('JobStateStore — init + load + save', () => {
  it('init writes state.json with validated schema', () => {
    const store = new JobStateStore(workdir);
    const state = store.init({
      jobId: 'ut-app-2026-07-03',
      sessionId: 'sess-1',
      sliceList: ['api/users', 'api/orders'],
      parallelismHint: 'llm-decides',
      exitPolicy: 'strict',
      mainLoopStrategy: 'rotating',
      rotateEvery: 3,
    });
    expect(state.mainLoopStrategy).toBe('rotating');
    expect(state.slices).toHaveLength(2);
    expect(existsSync(join(workdir, 'ut-app-2026-07-03/state.json'))).toBe(true);
    const raw = readFileSync(join(workdir, 'ut-app-2026-07-03/state.json'), 'utf8');
    expect(() => JobStateSchema.parse(JSON.parse(raw))).not.toThrow();
  });

  it('load returns the in-file state', () => {
    const store = new JobStateStore(workdir);
    store.init({ jobId: 'j1', sessionId: 's', sliceList: ['a'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });
    const reloaded = store.load('j1');
    expect(reloaded.jobId).toBe('j1');
  });

  it('save rejects an invalid state (zod fails)', () => {
    const store = new JobStateStore(workdir);
    store.init({ jobId: 'j2', sessionId: 's', sliceList: ['a'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });
    const broken = { ...store.load('j2'), mainSessionCycle: -1 } as unknown as JobState;
    expect(() => store.save(broken)).toThrow();
  });
});

describe('JobStateStore — lock', () => {
  it('tryAcquireLock returns a lock; second call throws', () => {
    const store = new JobStateStore(workdir);
    store.init({ jobId: 'j3', sessionId: 's', sliceList: ['a'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });
    const lock1 = store.tryAcquireLock('j3');
    expect(() => store.tryAcquireLock('j3')).toThrow(/locked/);
    store.releaseLock(lock1);
    const lock2 = store.tryAcquireLock('j3');
    expect(lock2).toBeTruthy();
  });
});

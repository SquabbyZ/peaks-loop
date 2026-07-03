import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobStateStore } from '../../../../src/services/job/job-state-store.js';
import { JobOrchestrator } from '../../../../src/services/job/job-orchestrator.js';
import { JobRotation } from '../../../../src/services/job/job-rotation.js';

let workdir: string;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), 'job-rot-')); });

describe('JobRotation (single mode)', () => {
  it('never rotates when strategy=single', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j', sessionId: 's', sliceList: ['a','b','c','d'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });
    const rot = new JobRotation(store, async () => ({ rotated: false }), async () => ({} as any));
    const r = await rot.cycleIfDue('j', 4);
    expect(r.rotated).toBe(false);
  });
});

describe('JobRotation (rotating mode)', () => {
  it('rotates when slicesJustCompleted % rotateEvery === 0', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j', sessionId: 's', sliceList: ['a','b','c','d','e','f'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'rotating', rotateEvery: 3 });
    let rotateCalls = 0;
    const rot = new JobRotation(store, async () => { rotateCalls++; return { rotated: true }; }, async (jobId) => ({ jobId, cycle: 1 }));
    const r = await rot.cycleIfDue('j', 3);
    expect(r.rotated).toBe(true);
    expect(rotateCalls).toBe(1);
    const reloaded = store.load('j');
    expect(reloaded.mainSessionCycle).toBe(1);
  });

  it('does NOT rotate mid-cadence (e.g. 2 slices in)', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j', sessionId: 's', sliceList: ['a','b','c','d'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'rotating', rotateEvery: 3 });
    const rot = new JobRotation(store, async () => ({ rotated: true }), async () => ({} as any));
    const r = await rot.cycleIfDue('j', 2);
    expect(r.rotated).toBe(false);
  });
});

describe('JobRotation — rotateNow (out-of-cadence)', () => {
  it('forces rotation regardless of cadence', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j', sessionId: 's', sliceList: ['a','b'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'rotating', rotateEvery: 3 });
    let rotateCalls = 0;
    const rot = new JobRotation(store, async () => { rotateCalls++; return { rotated: true }; }, async () => ({} as any));
    const r = await rot.rotateNow('j');
    expect(r.rotated).toBe(true);
    expect(rotateCalls).toBe(1);
  });
});

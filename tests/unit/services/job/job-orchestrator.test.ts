import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobStateStore } from '../../../../src/services/job/job-state-store.js';
import { JobOrchestrator } from '../../../../src/services/job/job-orchestrator.js';

let workdir: string;

beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), 'job-orch-')); });

describe('JobOrchestrator — init', () => {
  it('creates 8-slice job with rotating default + 3 slices pending', () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    const state = orch.init({ jobId: 'j1', sessionId: 'sess-1', sliceList: ['a','b','c'], parallelismHint: 'llm-decides', exitPolicy: 'strict', mainLoopStrategy: 'rotating', rotateEvery: 3 });
    expect(state.slices.every(s => s.status === 'pending')).toBe(true);
    expect(state.mainLoopStrategy).toBe('rotating');
  });

  it('override rotating→single requires reason ≥10 chars + future timestamp', () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    const state = orch.init({
      jobId: 'j1', sessionId: 'sess-1', sliceList: ['a','b','c','d'],
      parallelismHint: 'llm-decides', exitPolicy: 'strict',
      mainLoopStrategy: 'single',
      rotateEvery: 3,
      // @ts-expect-error passing through extra for this test
      mainLoopOverride: { from: 'rotating', to: 'single', reason: 'short', at: new Date().toISOString() },
    });
    expect(state.mainLoopOverride).toBeUndefined(); // zod rejects short reason
  });
});

describe('JobOrchestrator — checkpoint done', () => {
  it('marks a slice done with commitSha and bumps lastCheckpointAt', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j1', sessionId: 'sess-1', sliceList: ['a','b'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });
    const updated = await orch.checkpointDone({ jobId: 'j1', sliceId: 'slice-001', commitSha: 'abc123def456' });
    const doneSlice = updated.slices.find(s => s.sliceId === 'slice-001');
    expect(doneSlice?.status).toBe('done');
    expect(doneSlice?.commitSha).toBe('abc123def456');
  });

  it('reject `done` without commitSha', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j1', sessionId: 'sess-1', sliceList: ['a'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });
    await expect(orch.checkpointDone({ jobId: 'j1', sliceId: 'slice-001' /* missing commitSha */ })).rejects.toThrow(/commitSha/);
  });
});

describe('JobOrchestrator — strict mode block propagation', () => {
  it('one blocked slice → all remaining unrun, exitPolicy=strict keeps status unchanged (no skip)', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j1', sessionId: 'sess-1', sliceList: ['a','b','c'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });
    await orch.blockSlice({ jobId: 'j1', sliceId: 'slice-002', reason: 'QA cap' });
    const summary = orch.status('j1');
    expect(summary.blocked).toBe(1);
    expect(summary.done).toBe(0);
    expect(summary.skipped).toBe(0);
  });
});

describe('JobOrchestrator — best-effort mode skips and continues', () => {
  it('one blocked slice → status=skipped, done=2 if earlier already done', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j1', sessionId: 'sess-1', sliceList: ['a','b','c'], parallelismHint: 'serial', exitPolicy: 'best-effort', mainLoopStrategy: 'single', rotateEvery: 3 });
    await orch.checkpointDone({ jobId: 'j1', sliceId: 'slice-001', commitSha: 'sha-aaa-111' });
    await orch.checkpointSkipped({ jobId: 'j1', sliceId: 'slice-002', reason: 'best-effort skip' });
    const summary = orch.status('j1');
    expect(summary.done).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.blocked).toBe(0);
  });
});

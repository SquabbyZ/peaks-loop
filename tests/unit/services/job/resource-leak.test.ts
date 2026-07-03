// tests/unit/services/job/resource-leak.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobStateStore } from '../../../../src/services/job/job-state-store.js';
import { JobOrchestrator } from '../../../../src/services/job/job-orchestrator.js';
import { SubAgentJobWrapper } from '../../../../src/services/job/subagent-job-wrapper.js';

let workdir: string;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), 'leak-')); });

describe('resource leak detection (AC-13)', () => {
  it('5-slice job with cleanup gate keeps tracked batches empty', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j', sessionId: 's', sliceList: ['a','b','c','d','e'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });

    const dispatched: string[] = [];
    const wrapper = new SubAgentJobWrapper(store, async (_role, _p, { batchId }) => { dispatched.push(batchId); return { batchId }; });

    for (const sl of ['slice-001','slice-002','slice-003','slice-004','slice-005']) {
      const r = await wrapper.wrap({ jobId: 'j', role: 'rd', prompt: 'x' });
      // Simulate each slice running, committing, and cleanup firing.
      await orch.checkpointDone({ jobId: 'j', sliceId: sl, commitSha: 'sha-' + sl.replace('slice-','') });
      await wrapper.cleanup({ jobId: 'j', batchId: r.batchId, force: true });
    }

    // No dispatched batches remain tracked.
    expect(dispatched.length).toBe(5);
    for (const batchId of dispatched) {
      expect(wrapper.canCheckpointDone('j', batchId)).toBe(true);
    }
  });

  it('refuses slice done when cleanup missing (gate triggers)', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j', sessionId: 's', sliceList: ['a'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });
    const wrapper = new SubAgentJobWrapper(store, async () => ({ batchId: 'b-noCleanup' }));
    const r = await wrapper.wrap({ jobId: 'j', role: 'rd', prompt: 'x' });
    // Without cleanup, canCheckpointDone returns false — gate prevents the mark-done.
    expect(wrapper.canCheckpointDone('j', r.batchId)).toBe(false);
  });
});
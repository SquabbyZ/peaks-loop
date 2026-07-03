import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SubAgentJobWrapper } from '../../../../src/services/job/subagent-job-wrapper.js';
import { JobStateStore } from '../../../../src/services/job/job-state-store.js';
import { JobOrchestrator } from '../../../../src/services/job/job-orchestrator.js';

let workdir: string;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), 'subag-')); });

describe('SubAgentJobWrapper — budget + cleanup gate', () => {
  it('injects default --budget-mb 512 when caller omits it', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j', sessionId: 's', sliceList: ['a'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });
    const dispatched: any[] = [];
    const wrapper = new SubAgentJobWrapper(store, async (role, prompt, opts) => {
      dispatched.push({ role, opts });
      return { batchId: 'bid-' + dispatched.length };
    });
    const r = await wrapper.wrap({ jobId: 'j', role: 'rd', prompt: 'do X' });
    expect(dispatched[0].opts.budgetMb).toBe(512);
    expect(r.batchId).toBe('bid-1');
    expect(r.requiresCleanup).toBe(true);
  });

  it('keeps caller-supplied --budget-mb', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j', sessionId: 's', sliceList: ['a'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });
    const dispatched: any[] = [];
    const wrapper = new SubAgentJobWrapper(store, async (role, prompt, opts) => {
      dispatched.push({ role, opts });
      return { batchId: 'b2' };
    });
    await wrapper.wrap({ jobId: 'j', role: 'qa', prompt: 'check', budgetMb: 256 });
    expect(dispatched[0].opts.budgetMb).toBe(256);
  });

  it('requires cleanup before allowing slice done checkpoint', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j', sessionId: 's', sliceList: ['a'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });
    const wrapper = new SubAgentJobWrapper(store, async () => ({ batchId: 'b3' }));
    const r = await wrapper.wrap({ jobId: 'j', role: 'rd', prompt: 'x' });
    expect(wrapper.canCheckpointDone('j', r.batchId)).toBe(false);
    await wrapper.cleanup({ jobId: 'j', batchId: r.batchId, force: true });
    expect(wrapper.canCheckpointDone('j', r.batchId)).toBe(true);
  });
});
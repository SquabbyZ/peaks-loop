import { describe, expect, it } from 'vitest';
import { planMergeBack } from '~/src/services/dispatch/post-merge';

describe('planMergeBack', () => {
  it('returns fast-forward when caller has nothing ahead', () => {
    const plan = planMergeBack({ callerBranch: 'main', agentBranch: 'feat/x', commitsBehind: 0, conflictingFiles: [] });
    expect(plan.kind).toBe('fast-forward');
  });
  it('returns no-ff when caller is a feature branch', () => {
    const plan = planMergeBack({ callerBranch: 'feat/y', agentBranch: 'feat/x', commitsBehind: 0, conflictingFiles: [] });
    expect(plan.kind).toBe('no-ff');
  });
  it('returns conflict when both sides touched files', () => {
    const plan = planMergeBack({ callerBranch: 'main', agentBranch: 'feat/x', commitsBehind: 0, conflictingFiles: ['src/foo.ts'] });
    expect(plan.kind).toBe('conflict');
  });
  it('returns noop when branches are the same', () => {
    const plan = planMergeBack({ callerBranch: 'main', agentBranch: 'main', commitsBehind: 0, conflictingFiles: [] });
    expect(plan.kind).toBe('noop');
  });
  it('returns missing when an empty branch name is given', () => {
    const plan = planMergeBack({ callerBranch: 'main', agentBranch: '', commitsBehind: 0, conflictingFiles: [] });
    expect(plan.kind).toBe('missing');
  });
});
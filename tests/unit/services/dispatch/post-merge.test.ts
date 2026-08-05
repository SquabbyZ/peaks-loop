import { describe, expect, it } from 'vitest';
import { planMergeBack } from '~/src/services/dispatch/post-merge';

describe("Scenario: planMergeBack", () => {
  it("when invoked, should returns fast-forward when caller has nothing ahead", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const plan = planMergeBack({ callerBranch: 'main', agentBranch: 'feat/x', commitsBehind: 0, conflictingFiles: [] });
    expect(plan.kind).toBe('fast-forward');
  });
  it("when invoked, should returns no-ff when caller is a feature branch", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const plan = planMergeBack({ callerBranch: 'feat/y', agentBranch: 'feat/x', commitsBehind: 0, conflictingFiles: [] });
    expect(plan.kind).toBe('no-ff');
  });
  it("when invoked, should returns conflict when both sides touched files", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const plan = planMergeBack({ callerBranch: 'main', agentBranch: 'feat/x', commitsBehind: 0, conflictingFiles: ['src/foo.ts'] });
    expect(plan.kind).toBe('conflict');
  });
  it("when invoked, should returns noop when branches are the same", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const plan = planMergeBack({ callerBranch: 'main', agentBranch: 'main', commitsBehind: 0, conflictingFiles: [] });
    expect(plan.kind).toBe('noop');
  });
  it("when invoked, should returns missing when an empty branch name is given", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const plan = planMergeBack({ callerBranch: 'main', agentBranch: '', commitsBehind: 0, conflictingFiles: [] });
    expect(plan.kind).toBe('missing');
  });
});
// tests/unit/services/context/build-dispatch-system-prompt.test.ts
//
// 4-dimension unit test for the v3.2 lifecycle-rule injection in
// src/services/context/build-dispatch-system-prompt.ts. Three new
// instructions are appended to every dispatched sub-agent's system
// prompt:
//   - register long-lived services with `peaks sub-agent shutdown register`
//   - do NOT run E2E (parent owns it)
//   - do NOT call `git merge / pull / rebase / peaks worktree release`
//
// Dimensions covered:
//   - behavior: prompt contains the new instructions
//   - render:   not applicable (returns a string)
//   - integration: not applicable (pure)
//   - a11y:     not applicable (no exit code)

import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/context/build-dispatch-system-prompt.test.ts',
  ['behavior'],
  [
    { dim: 'integration', reason: 'pure function, no fs / subprocess boundary' },
    { dim: 'render', reason: 'returns a string, no structured output surface' },
    { dim: 'a11y', reason: 'no user-visible text or exit code' },
  ],
);

import { buildDispatchSystemPrompt } from '~/src/services/context/build-dispatch-system-prompt';

describe("Scenario: behavior — lifecycle-rule injection", () => {
  it("when invoked, should mentions sub-agent shutdown register for long-lived services", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = buildDispatchSystemPrompt({
      taskTitle: 'add a button',
      taskBody: 'add a button',
      memoryBlock: { available: false, block: null },
    });
    expect(out).toMatch(/sub-agent shutdown register/i);
  });

  it("when invoked, should forbids the sub-agent from running E2E", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = buildDispatchSystemPrompt({
      taskTitle: 'add a button',
      taskBody: 'add a button',
      memoryBlock: { available: false, block: null },
    });
    expect(out).toMatch(/do NOT run E2E/i);
  });

  it("when invoked, should forbids the sub-agent from calling git merge / pull / rebase", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = buildDispatchSystemPrompt({
      taskTitle: 'add a button',
      taskBody: 'add a button',
      memoryBlock: { available: false, block: null },
    });
    expect(out).toMatch(/do NOT call `git merge`, `git pull`, `git rebase`/i);
  });
});
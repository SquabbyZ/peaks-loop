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

describe('Scenario: behavior — codegraph structure block (2026-09-03-codegraph-preread)', () => {
  const COGRAPH_BLOCK = '## Codegraph structure\n\n- `src/services/context/` — 12 files\n';

  it("when a codegraph structure payload is provided, should render the codegraph block into the prompt", () => {
    // given: a dispatch input with a codegraph structure block from a live index read
    const input = {
      taskTitle: 'rd',
      taskBody: 'plan the slice',
      memoryBlock: { available: false, block: null },
      codegraphBlock: COGRAPH_BLOCK,
    };
    // when: the composer is invoked
    const out = buildDispatchSystemPrompt(input);
    // then: the codegraph block content is present and the unavailable note is absent
    expect(out).toContain('## Codegraph structure');
    expect(out).toContain('`src/services/context/` — 12 files');
    expect(out).not.toContain('codegraph unavailable');
  });

  it("when the codegraph payload is null, should render the codegraph-unavailable note (fail-soft)", () => {
    // given: a dispatch input where the codegraph preflight returned unavailable (null)
    const input = {
      taskTitle: 'rd',
      taskBody: 'plan the slice',
      memoryBlock: { available: false, block: null },
      codegraphBlock: null,
    };
    // when: the composer is invoked
    const out = buildDispatchSystemPrompt(input);
    // then: the fixed unavailable note is rendered so the RD proceeds on project-scan only
    expect(out).toContain('## Codegraph structure');
    expect(out).toContain('codegraph unavailable — proceeding on project-scan only');
  });

  it("when the codegraph field is omitted, should keep the legacy prompt byte-identical (no codegraph text)", () => {
    // given: a legacy dispatch input that never opts into the codegraph preflight
    const input = {
      taskTitle: 'qa',
      taskBody: 'verify the slice',
      memoryBlock: { available: false, block: null },
    };
    // when: the composer is invoked
    const out = buildDispatchSystemPrompt(input);
    // then: no codegraph header or note is injected
    expect(out).not.toContain('## Codegraph structure');
    expect(out).not.toContain('codegraph unavailable');
  });

  it("when memory + codegraph are both available, should keep stable order context → codegraph → memory → task", () => {
    // given: a dispatch with a live codegraph block, an available memory block, and a context probe
    const input = {
      taskTitle: 'rd',
      taskBody: 'TASK_BODY_SENTINEL',
      memoryBlock: {
        available: true,
        block: '## Project memory relevant to this task\n- * 2026-06-22-cc-connect-removal-publish\n',
      },
      contextProbe: { ratio: 0.28, source: 'transcript-estimate', ide: 'claude-code' },
      codegraphBlock: COGRAPH_BLOCK,
    };
    // when: the composer is invoked
    const out = buildDispatchSystemPrompt(input);
    // then: codegraph sits after the context window and before project memory / the task brief
    const contextIdx = out.indexOf('## Context window');
    const codegraphIdx = out.indexOf('## Codegraph structure');
    const memoryIdx = out.indexOf('## Project memory relevant to this task');
    const taskIdx = out.indexOf('## Task');
    expect(contextIdx).toBeGreaterThanOrEqual(0);
    expect(codegraphIdx).toBeGreaterThan(contextIdx);
    expect(memoryIdx).toBeGreaterThan(codegraphIdx);
    expect(taskIdx).toBeGreaterThan(memoryIdx);
  });

  it("when memory is unavailable but codegraph is provided, should place the codegraph block before the task body", () => {
    // given: a dispatch with a codegraph block and no memory block
    const input = {
      taskTitle: 'rd',
      taskBody: 'TASK_BODY_SENTINEL',
      memoryBlock: { available: false, block: null },
      codegraphBlock: COGRAPH_BLOCK,
    };
    // when: the composer is invoked
    const out = buildDispatchSystemPrompt(input);
    // then: the codegraph header appears before the task body text
    const codegraphIdx = out.indexOf('## Codegraph structure');
    const bodyIdx = out.indexOf('TASK_BODY_SENTINEL');
    expect(codegraphIdx).toBeGreaterThanOrEqual(0);
    expect(bodyIdx).toBeGreaterThan(codegraphIdx);
  });
});
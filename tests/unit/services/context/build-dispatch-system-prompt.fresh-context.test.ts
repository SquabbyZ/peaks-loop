// tests/unit/services/context/build-dispatch-system-prompt.fresh-context.test.ts
//
// 4-dimension unit test for the fresh-context block injection in
// src/services/context/build-dispatch-system-prompt.ts (slice
// 2026-09-07-search-first-preflight). The composer gains an optional
// `freshContextBlock` that renders the `## Fresh context` section between
// the project-stack block and the memory/task content.
//
// Dimensions covered:
//   - behavior: prompt contains / omits the fresh-context block
//   - render:    not applicable (returns a string)
//   - integration: not applicable (pure)
//   - a11y:     not applicable (no exit code)

import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/context/build-dispatch-system-prompt.fresh-context.test.ts',
  ['behavior'],
  [
    { dim: 'integration', reason: 'pure function, no fs / subprocess boundary' },
    { dim: 'render', reason: 'returns a string, no structured output surface' },
    { dim: 'a11y', reason: 'no user-visible text or exit code' },
  ],
);

import { buildDispatchSystemPrompt } from '~/src/services/context/build-dispatch-system-prompt';

const FRESH_CONTEXT_BLOCK = '## Fresh context\n\n以下信息优先于训练知识，冲突时以此为准。\n\n1. 用 React 19（因为 18 已过时）\n';

describe('Scenario: behavior — fresh-context block injection (2026-09-07-search-first-preflight)', () => {
  it("when a fresh-context block is provided, should render it into the prompt", () => {
    // given: a dispatch input carrying the synthesized fresh-context block
    const input = {
      taskTitle: 'rd',
      taskBody: 'TASK_BODY_SENTINEL',
      memoryBlock: { available: false, block: null },
      freshContextBlock: FRESH_CONTEXT_BLOCK,
    };
    // when: the composer is invoked
    const out = buildDispatchSystemPrompt(input);
    // then: the fresh-context heading + framing line + directive are present
    expect(out).toContain('## Fresh context');
    expect(out).toContain('以下信息优先于训练知识，冲突时以此为准');
    expect(out).toContain('用 React 19');
  });

  it("when the fresh-context field is omitted, should keep the legacy prompt byte-identical", () => {
    // given: the legacy dispatch input (no fresh-context field)
    const legacy = buildDispatchSystemPrompt({
      taskTitle: 'rd',
      taskBody: 'TASK_BODY_SENTINEL',
      memoryBlock: { available: false, block: null },
    });
    // when: the composer is invoked with no fresh-context field
    const out = buildDispatchSystemPrompt({
      taskTitle: 'rd',
      taskBody: 'TASK_BODY_SENTINEL',
      memoryBlock: { available: false, block: null },
    });
    // then: output equals the legacy shape and carries no fresh-context heading
    expect(out).toBe(legacy);
    expect(out).not.toContain('## Fresh context');
  });

  it("when the fresh-context field is null, should keep the legacy prompt byte-identical", () => {
    // given: the legacy dispatch input
    const legacy = buildDispatchSystemPrompt({
      taskTitle: 'rd',
      taskBody: 'TASK_BODY_SENTINEL',
      memoryBlock: { available: false, block: null },
    });
    // when: the composer is invoked with an explicit null block (what the dispatch site passes on a miss)
    const out = buildDispatchSystemPrompt({
      taskTitle: 'rd',
      taskBody: 'TASK_BODY_SENTINEL',
      memoryBlock: { available: false, block: null },
      freshContextBlock: null,
    });
    // then: output is byte-identical to legacy (renderFreshContextBlock → '')
    expect(out).toBe(legacy);
    expect(out).not.toContain('## Fresh context');
  });

  it("when memory + codegraph + project stack + fresh context are all available, should place fresh-context after project-stack and before memory/task", () => {
    // given: a dispatch with codegraph, project-stack, memory, and fresh-context blocks
    const input = {
      taskTitle: 'rd',
      taskBody: 'TASK_BODY_SENTINEL',
      memoryBlock: {
        available: true,
        block: '## Project memory relevant to this task\n- * mem\n',
      },
      codegraphBlock: '## Codegraph structure\n\n- `src/` — 1 file\n',
      projectStackBlock: '## Project stack\n\n- Component library: Ant Design v5\n',
      freshContextBlock: FRESH_CONTEXT_BLOCK,
    };
    // when: the composer is invoked
    const out = buildDispatchSystemPrompt(input);
    // then: fresh context sits after project stack and before project memory / task
    const stackIdx = out.indexOf('## Project stack');
    const freshIdx = out.indexOf('## Fresh context');
    const memoryIdx = out.indexOf('## Project memory relevant to this task');
    const taskIdx = out.indexOf('## Task');
    expect(stackIdx).toBeGreaterThanOrEqual(0);
    expect(freshIdx).toBeGreaterThan(stackIdx);
    expect(memoryIdx).toBeGreaterThan(freshIdx);
    expect(taskIdx).toBeGreaterThan(memoryIdx);
  });
});

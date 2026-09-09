// tests/unit/services/context/dispatch-capsule-pointer.test.ts
//
// Slice 2026-09-10-dispatch-token-and-swarm §4 — session capsule pointer.
//
// QUALITY GUARD under test: the capsule is ADVISORY BACKGROUND only. When a
// capsule is present the prompt MUST render BOTH the `shared-read` pointer
// AND the precedence line saying the task spec wins on conflict. When it is
// absent, neither appears (byte-identical legacy prompt).
//
// Dimensions covered:
//   - behavior: capsule present/absent rendering
//   - render: pointer line + precedence line shape
//   - a11y: the precedence sentence is the human/LLM-visible contract
//   - integration: omitted (pure composer; the channel read is covered by
//     the shared-channel package tests)

import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/context/dispatch-capsule-pointer.test.ts',
  ['behavior', 'render', 'a11y'],
  [
    { dim: 'integration', reason: 'pure composer; channel IO lives in peaks-loop-shared-channel' },
  ],
);

import { buildDispatchSystemPrompt } from '~/src/services/context/build-dispatch-system-prompt';
import { SESSION_CAPSULE_BATCH_ID, SESSION_CAPSULE_KEY } from '~/src/services/dispatch/session-capsule';

function prompt(capsule?: { batchId: string; key: string; bytes: number } | null): string {
  return buildDispatchSystemPrompt({
    taskTitle: 'rd',
    taskBody: 'TASK_BODY_SENTINEL',
    memoryBlock: { available: false, block: null },
    ...(capsule !== undefined ? { capsule } : {}),
  });
}

const CAPSULE = { batchId: SESSION_CAPSULE_BATCH_ID, key: SESSION_CAPSULE_KEY, bytes: 412 };

describe('Scenario: behavior — capsule presence', () => {
  it('when a capsule is present, should render the shared-read pointer', () => {
    // given: an orchestrator-published session capsule
    const out = prompt(CAPSULE);
    // when:  the dispatch prompt is composed
    // then:  the pointer names the batch + key the sub-agent must read
    expect(out).toContain('peaks sub-agent shared-read');
    expect(out).toContain(`--batch ${SESSION_CAPSULE_BATCH_ID}`);
    expect(out).toContain(`--key ${SESSION_CAPSULE_KEY}`);
    expect(out).toContain('412 bytes');
  });

  it('when a capsule is present, should render the precedence line', () => {
    // given: an orchestrator-published session capsule
    const out = prompt(CAPSULE);
    // when:  the prompt is inspected
    // then:  the advisory-only + task-spec-wins contract is explicit
    expect(out).toContain('ADVISORY BACKGROUND ONLY');
    expect(out).toContain('wins on any conflict');
    expect(out).toContain('Your task spec');
  });

  it('when no capsule is present, should render neither the pointer nor the precedence line', () => {
    // given: a dispatch with no capsule (null and omitted)
    const withNull = prompt(null);
    const withUndefined = prompt();
    // when:  the prompts are composed
    // then:  neither the pointer nor the precedence line appears
    for (const out of [withNull, withUndefined]) {
      expect(out).not.toContain('shared-read');
      expect(out).not.toContain('ADVISORY BACKGROUND ONLY');
      expect(out).not.toContain('Shared session capsule');
    }
    expect(withNull).toBe(withUndefined);
  });

  it('when a capsule is present, should keep the task body and every binding rule inline', () => {
    // given: a dispatch with a capsule
    const out = prompt(CAPSULE);
    // when:  the task spec and boilerplate are checked
    // then:  the capsule did NOT replace the task spec
    expect(out).toContain('TASK_BODY_SENTINEL');
    expect(out).toContain('Do NOT run E2E');
    expect(out).toContain('Do NOT call `git merge`, `git pull`, `git rebase`');
    expect(out.indexOf('TASK_BODY_SENTINEL')).toBeGreaterThan(out.indexOf('Shared session capsule'));
  });
});

describe('Scenario: render — pointer block shape', () => {
  it('when a capsule is rendered, should use its own heading and stay before the task body', () => {
    // given: a capsule
    const out = prompt(CAPSULE);
    // when:  the heading position is compared to the task body
    const headingIdx = out.indexOf('## Shared session capsule (advisory background)');
    // then:  the block exists exactly once and precedes the task
    expect(headingIdx).toBeGreaterThanOrEqual(0);
    expect(out.split('## Shared session capsule (advisory background)').length - 1).toBe(1);
    expect(out.indexOf('TASK_BODY_SENTINEL')).toBeGreaterThan(headingIdx);
  });
});

describe('Scenario: a11y — the precedence sentence is unambiguous', () => {
  it('when a capsule is rendered, should state that anything actionable stays inline', () => {
    // given: a capsule pointer
    const out = prompt(CAPSULE);
    // when:  the guard sentence is read
    // then:  the sub-agent is told the capsule is not a task and where the
    //        authoritative instructions live
    expect(out).toContain('it is not a task');
    expect(out).toContain('authoritative');
  });
});

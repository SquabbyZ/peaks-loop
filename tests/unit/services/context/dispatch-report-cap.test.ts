// tests/unit/services/context/dispatch-report-cap.test.ts
//
// Slice 2026-09-10-context-audit-and-discipline (Slice C) — the sub-agent
// FINAL report cap in the dispatch contract.
//
// Defects this pins:
//   1. 20 sub-agent final reports cost ≈ 60 KB ≈ 15K tokens of the
//      orchestrator's window (session 2026-09-07-session-245530) — the
//      report must be an index into the artifact, not a copy of it.
//   2. the cap must reach EVERY role: it is injected by the composer, not by
//      a per-role markdown template the orchestrator may skip.
//   3. the cap must not remove information: the five mandatory report fields
//      stay in the text, and the parent is told to `Read` the artifact.
//
// Run with:
//   ./node_modules/.bin/vitest run tests/unit/services/context/dispatch-report-cap.test.ts

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  buildDispatchSystemPrompt,
  BINDING_RULE_TOKENS,
  missingRuleTokens,
  REPORT_CAP_BLOCK,
} from '~/src/services/context/build-dispatch-system-prompt';

declareDimensions(
  'tests/unit/services/context/dispatch-report-cap.test.ts',
  ['behavior', 'render', 'a11y'],
  [
    { dim: 'integration', reason: 'pure function; no fs / subprocess boundary' },
  ],
);

const ROLES = ['rd', 'qa', 'qa-business', 'qa-perf', 'qa-security', 'sc', 'prd', 'ui', 'txt'] as const;

/** The load-bearing sentence every sub-agent must see. */
const CAP_SENTENCE = 'Your FINAL report to the parent MUST be ≤ 40 lines and ≤ 2 KB.';

function promptFor(role: string, memoryAvailable: boolean): string {
  return buildDispatchSystemPrompt({
    taskTitle: role,
    taskBody: 'TASK_BODY_SENTINEL',
    memoryBlock: memoryAvailable
      ? { available: true, block: '## Project memory relevant to this task\n- * mem\n' }
      : { available: false, block: null },
  });
}

describe('behavior — the cap reaches every role and every branch', () => {
  for (const role of ROLES) {
    it(`when role=${role} is dispatched without memory, should carry the report cap`, () => {
      const out = promptFor(role, false);
      expect(out).toContain('## Final report cap (mandatory)');
      expect(out).toContain(CAP_SENTENCE);
      expect(out).toContain('TASK_BODY_SENTINEL');
    });
  }

  it('when the memory block is available, should still carry the report cap exactly once', () => {
    const out = promptFor('rd', true);
    expect(out.split(REPORT_CAP_BLOCK).length - 1).toBe(1);
    expect(out).toContain(CAP_SENTENCE);
  });

  it('when a prompt is composed, should place the cap before the task body', () => {
    const out = promptFor('rd', false);
    expect(out.indexOf('## Final report cap (mandatory)')).toBeLessThan(out.indexOf('TASK_BODY_SENTINEL'));
  });
});

describe('render — the cap block stays small and keeps the mandatory fields', () => {
  it('when the block is measured, should stay a small fraction of the prompt', () => {
    // the cap must not itself become the problem it fixes
    expect(Buffer.byteLength(REPORT_CAP_BLOCK, 'utf8')).toBeLessThan(700);
  });

  it('when the block is read, should name all five mandatory report fields', () => {
    for (const field of [
      'changed files (one line each)',
      'the exact commands you ran',
      'pass/fail counts',
      'tsc status',
      'any blocker',
    ]) {
      expect(REPORT_CAP_BLOCK).toContain(field);
    }
  });

  it('when detail is too long, should point the parent at the artifact instead of dropping it', () => {
    // quality guard: the cap redirects detail, it never deletes it
    expect(REPORT_CAP_BLOCK).toContain('Write any longer detail into the artifact file you already own');
    expect(REPORT_CAP_BLOCK).toContain('the parent can `Read` that file for the full detail');
    expect(REPORT_CAP_BLOCK).toContain('nothing is lost');
  });
});

describe('a11y — the cap is part of the binding-rule guard set', () => {
  it('when the binding tokens are checked against a composed prompt, should report no missing rule', () => {
    const out = buildDispatchSystemPrompt({
      taskTitle: 'rd',
      taskBody: 'TASK_BODY_SENTINEL',
      memoryBlock: { available: false, block: null },
      contextProbe: { ratio: 0.28, source: 'transcript-estimate', ide: 'claude-code' },
    });
    expect(missingRuleTokens(out, BINDING_RULE_TOKENS)).toEqual([]);
  });

  it('when the token set is inspected, should include the cap markers', () => {
    expect(BINDING_RULE_TOKENS).toContain('## Final report cap (mandatory)');
    expect(BINDING_RULE_TOKENS).toContain('≤ 40 lines and ≤ 2 KB');
    expect(BINDING_RULE_TOKENS).toContain('the parent can `Read` that file for the full detail');
  });
});

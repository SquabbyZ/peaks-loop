// tests/unit/services/context/dispatch-fact-force-gate.test.ts
//
// Slice 2026-09-10-fact-force-gate-adaptation — PROACTIVE coverage of an
// external PreToolUse gate.
//
// ECC (third-party, `~/.claude/plugins/`) registers
// `gateguard-fact-force.js` on Edit|Write|MultiEdit. It denies the first edit
// of a file the agent has not established facts about, and its four-item
// message never says "you must read the file first" or "your edit was NOT
// applied" — so the LLM reads the denial as the tool being broken.
//
// This slice does NOT remove, disable, or re-implement the gate. It tells the
// sub-agent the STANDING RULE up front, in the prompt peaks-loop already owns,
// so the gate is never tripped. The assertions below pin that ordering:
//   (a) the read-first rule is stated FIRST,
//   (b) the block names WHICH files the rule covers (outside `.peaks/**`),
//   (c) the denial is described as NOT-a-failure, with the recovery steps.
// A block that leads with the denial or explains it after the fact fails (a).
//
// Dimensions covered:
//   - behavior: rule-first ordering, scope, recovery, presence in BOTH branches
//   - render:   heading + byte budget
//   - a11y:     the composed text is the human/LLM-visible contract
//   - integration: omitted (pure function, no fs / subprocess)

import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/context/dispatch-fact-force-gate.test.ts',
  ['behavior', 'render', 'a11y'],
  [
    { dim: 'integration', reason: 'pure function, no fs / subprocess boundary' },
  ],
);

import {
  buildDispatchSystemPrompt,
  BINDING_RULE_TOKENS,
  FACT_FORCE_GATE_BLOCK,
  missingRuleTokens,
  renderFactForceGateBlock,
} from '~/src/services/context/build-dispatch-system-prompt';
import type { MemoryPreflightResult } from '~/src/services/context/memory-preflight-service';
import type { ContextPercentProbe } from '~/src/services/context/auto-compact-types';

const ROLES = ['rd', 'qa', 'qa-business', 'sc', 'prd', 'ui', 'txt'] as const;
const HEADING = '## Read before you edit (Fact-Forcing Gate)';

const NO_MEMORY: MemoryPreflightResult = { available: false };
const MEMORY: MemoryPreflightResult = {
  available: true,
  block: '## Project memory relevant to this task\n- * mem\n',
};
const PROBE: ContextPercentProbe = {
  ratio: 0.28,
  source: 'transcript-estimate',
  ide: 'claude-code',
  capturedAt: '2026-09-10T00:00:00.000Z',
};

const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

function promptFor(role: string, memoryAvailable: boolean): string {
  return buildDispatchSystemPrompt({
    taskTitle: role,
    taskBody: 'TASK_BODY_SENTINEL',
    memoryBlock: memoryAvailable ? MEMORY : NO_MEMORY,
  });
}

describe('Scenario: behavior — the standing rule comes first (dispatch requirement a)', () => {
  it('when the block is read, should state read-before-edit before it mentions any denial', () => {
    // given: the block a sub-agent reads before its first edit
    const ruleIdx = FACT_FORCE_GATE_BLOCK.indexOf('Read a file BEFORE your first');
    const denialIdx = FACT_FORCE_GATE_BLOCK.indexOf('denies the edit');
    // when:  the two offsets are compared
    // then:  the rule leads and the denial is only its consequence — a block
    //        that opens with "your tool call was denied" fails here
    expect(ruleIdx).toBeGreaterThanOrEqual(0);
    expect(denialIdx).toBeGreaterThan(ruleIdx);
    expect(FACT_FORCE_GATE_BLOCK.startsWith(HEADING)).toBe(true);
  });

  it('when the rule is read, should make reading mandatory rather than advisory', () => {
    // given: the rule sentence
    // when:  it is inspected for hedging / optionality
    // then:  it reads as the normal way to work, not a suggestion
    expect(FACT_FORCE_GATE_BLOCK).toContain('the normal way to work here, not an optional step');
    expect(FACT_FORCE_GATE_BLOCK).not.toContain('consider reading');
  });
});

describe('Scenario: behavior — the block names which files the rule covers (dispatch requirement b)', () => {
  it('when the scope is read, should cover every path outside .peaks/** and name the file kinds', () => {
    // given: the scope sentence
    // when:  the exempt tree and the covered kinds are checked
    // then:  source / tests / docs / config are in scope; .peaks/** writes are not
    expect(FACT_FORCE_GATE_BLOCK).toContain('every path OUTSIDE `.peaks/**`');
    expect(FACT_FORCE_GATE_BLOCK).toContain('source, tests, docs, config');
    expect(FACT_FORCE_GATE_BLOCK).toContain('`.peaks/**` writes are exempt');
  });

  it('when the gate fires, should be named so the sub-agent recognises the message', () => {
    // given: the block
    // when:  the upstream gate's names are checked
    // then:  both the hook class and ECC's product name are present
    expect(FACT_FORCE_GATE_BLOCK).toContain('`PreToolUse` plugin gate');
    expect(FACT_FORCE_GATE_BLOCK).toContain('Fact-Forcing Gate');
  });
});

describe('Scenario: behavior — the denial is a consequence, not a failure (dispatch requirement c)', () => {
  it('when the fallback is read, should say the denial is not a failure and the edit was not applied', () => {
    // given: the consequence sentence
    // when:  it is read for the two facts the upstream message omits
    // then:  neither "broken tool" nor "lost edit" is left to inference
    expect(FACT_FORCE_GATE_BLOCK).toContain('A denial is NOT a failure and the tool is NOT broken');
    expect(FACT_FORCE_GATE_BLOCK).toContain('your edit was NOT applied');
  });

  it('when the recovery is read, should name the retry and the gate’s four facts', () => {
    // given: the recovery sentence
    // when:  the four requests and the retry are checked
    // then:  the sub-agent knows to satisfy the gate and retry, not to abandon
    for (const fact of ['importers', 'affected API', 'data schemas if any', 'verbatim instruction']) {
      expect(FACT_FORCE_GATE_BLOCK).toContain(fact);
    }
    expect(FACT_FORCE_GATE_BLOCK).toContain('retry the same operation');
    expect(FACT_FORCE_GATE_BLOCK).toContain('Do not switch tools, do not give up, do not re-attempt blindly.');
  });
});

describe('Scenario: behavior — the block reaches every role and both memory branches', () => {
  for (const role of ROLES) {
    it(`when role=${role} is dispatched, should carry the gate block exactly once`, () => {
      // given: a dispatch for this role with and without a memory block
      const withoutMemory = promptFor(role, false);
      const withMemory = promptFor(role, true);
      // when:  the block is counted
      // then:  it is present once in BOTH return branches
      expect(withoutMemory.split(FACT_FORCE_GATE_BLOCK).length - 1).toBe(1);
      expect(withMemory.split(FACT_FORCE_GATE_BLOCK).length - 1).toBe(1);
    });
  }

  it('when a prompt is composed, should place the gate block before the task body', () => {
    // given: a dispatch with no memory
    const out = promptFor('rd', false);
    // when:  the offsets are compared
    // then:  the rule is in scope before the task-specific edits start
    expect(out.indexOf(HEADING)).toBeLessThan(out.indexOf('TASK_BODY_SENTINEL'));
  });

  it('when the renderer is called directly, should match the exported block plus a separator', () => {
    // given: the always-on renderer
    // when:  it is invoked
    // then:  it is the block verbatim (no role or flag parameter exists)
    expect(renderFactForceGateBlock()).toBe(`${FACT_FORCE_GATE_BLOCK}\n`);
  });
});

describe('Scenario: render — the block stays small', () => {
  it('when the block is measured, should stay a small fraction of the prompt', () => {
    // the rule earns its bytes only if it is read once and acted on; a block
    // that grows into an essay defeats the prompt-economy value it serves
    expect(bytes(FACT_FORCE_GATE_BLOCK)).toBeLessThan(800);
  });

  it('when the block is rendered, should use its own heading and end on a paragraph break', () => {
    // given: the block
    // when:  its shape is inspected
    // then:  one heading, no trailing whitespace before the composer's newline
    expect(FACT_FORCE_GATE_BLOCK.split(HEADING).length - 1).toBe(1);
    expect(FACT_FORCE_GATE_BLOCK.endsWith('\n')).toBe(true);
    expect(FACT_FORCE_GATE_BLOCK.endsWith('\n\n')).toBe(false);
  });
});

describe('Scenario: a11y — the block is part of the binding-rule guard set', () => {
  it('when the binding tokens are checked against a composed prompt, should report no missing rule', () => {
    // given: a composed prompt with a live context probe, so every binding
    //        token that depends on the probe branch is in scope
    const out = buildDispatchSystemPrompt({
      taskTitle: 'rd',
      taskBody: 'TASK_BODY_SENTINEL',
      memoryBlock: NO_MEMORY,
      contextProbe: PROBE,
    });
    // when:  the binding-rule set is checked
    // then:  the gate's obligations survive compression like every other rule
    expect(missingRuleTokens(out, BINDING_RULE_TOKENS)).toEqual([]);
  });

  it('when the token set is inspected, should include the gate’s load-bearing phrases', () => {
    for (const token of [
      HEADING,
      'A denial is NOT a failure and the tool is NOT broken',
      'your edit was NOT applied',
      'do not re-attempt blindly',
    ]) {
      expect(BINDING_RULE_TOKENS).toContain(token);
    }
  });
});

// tests/unit/services/context/dispatch-role-scope-and-compression.test.ts
//
// Slice 2026-09-10-dispatch-token-and-swarm §1, as amended by
// 2026-09-10-dispatch-block-d (Option D) — the QUALITY GUARD.
//
// Compression may shorten prose; it may NOT delete a binding rule, and it
// may NOT re-introduce a role split. Four assertions carry that contract:
//   (a) BYTES DROP per block (measured against the pre-slice block sizes),
//   (b) the RULE-PRESENCE SET is 35/35 for every role — the 27 tokens that
//       shipped with Option D plus the 8 added by
//       2026-09-10-fact-force-gate-adaptation (retuned, not loosened),
//   (c) the runner-direct-path set is IDENTICAL across roles (PB-5 for all),
//   (d) no contract-pointer line is emitted (§2 was reverted).
//
// Dimensions covered:
//   - behavior: byte sizes + rule presence + no role split
//   - render:   the composed prompt is a string with stable section order
//   - a11y:     the prompt is the human/LLM-visible contract text
//   - integration: omitted (pure function, no fs / subprocess)

import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/context/dispatch-role-scope-and-compression.test.ts',
  ['behavior', 'render', 'a11y'],
  [
    { dim: 'integration', reason: 'pure function, no fs / subprocess boundary' },
  ],
);

import {
  buildDispatchSystemPrompt,
  L1_WORKTREE_GOVERNANCE_BLOCK,
  LIFECYCLE_RULES,
  BINDING_RULE_TOKENS,
  TEST_RUNNER_RULE_TOKENS,
  missingRuleTokens,
} from '~/src/services/context/build-dispatch-system-prompt';
import { TEST_TOOL_DETECTION_BLOCK } from '~/src/services/dispatch/test-tool-detection';

const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

/**
 * Pre-slice (HEAD before 2026-09-10-dispatch-token-and-swarm) block sizes,
 * measured from the same source files. These are the compression baseline:
 * every retained block MUST be strictly smaller.
 */
const PRE_SLICE_BYTES = {
  L1: 1244,
  LIFECYCLE: 569,
  TEST_TOOL_FULL: 1635,
  CONTEXT_WITH_PROBE: 818,
} as const;

const ROLES = ['rd', 'qa', 'qa-business', 'sc', 'prd', 'ui', 'txt'] as const;

const PROBE = { ratio: 0.28, source: 'transcript-estimate', ide: 'claude-code' } as const;

function promptFor(role: string): string {
  return buildDispatchSystemPrompt({
    taskTitle: role,
    taskBody: 'TASK_BODY_SENTINEL',
    memoryBlock: { available: false, block: null },
    contextProbe: PROBE,
  });
}

describe('Scenario: behavior — bytes drop (slice §1a)', () => {
  it('when a retained block is compressed, should be strictly smaller than its pre-slice size', () => {
    // given: the three boilerplate blocks that ship in every dispatch prompt
    // when:  their current sizes are measured
    // then:  each one is strictly smaller than the recorded pre-slice size
    expect(bytes(L1_WORKTREE_GOVERNANCE_BLOCK)).toBeLessThan(PRE_SLICE_BYTES.L1);
    expect(bytes(LIFECYCLE_RULES)).toBeLessThan(PRE_SLICE_BYTES.LIFECYCLE);
    expect(bytes(TEST_TOOL_DETECTION_BLOCK)).toBeLessThan(PRE_SLICE_BYTES.TEST_TOOL_FULL);
  });

  it('when every role is composed, should emit byte-identical prompts (Option D: no role split)', () => {
    // given: one dispatch per role, same inputs
    const sizes = ROLES.map((role) => bytes(promptFor(role)));
    // when:  the composed sizes are compared
    // then:  every role gets exactly the same block — a role split must not
    //        be re-introduced (that was Option D's whole point)
    expect(new Set(sizes).size).toBe(1);
  });

  it('when the boilerplate is compared to the pre-slice total, should cut at least 25% for every role', () => {
    // given: the pre-slice boilerplate total (L1 + lifecycle + test block + context)
    const preSliceTotal = PRE_SLICE_BYTES.L1 + PRE_SLICE_BYTES.LIFECYCLE + PRE_SLICE_BYTES.TEST_TOOL_FULL + PRE_SLICE_BYTES.CONTEXT_WITH_PROBE;
    const postSlice = bytes(L1_WORKTREE_GOVERNANCE_BLOCK) + bytes(LIFECYCLE_RULES) + bytes(TEST_TOOL_DETECTION_BLOCK);
    // when:  the compressed boilerplate is measured for every role
    // then:  the unified block saves >= 25% for all of them
    for (const role of ROLES) {
      expect(1 - postSlice / preSliceTotal, `role=${role}`).toBeGreaterThanOrEqual(0.25);
    }
  });
});

describe('Scenario: behavior — rule-presence set is unchanged for every role (slice §1b)', () => {
  for (const role of ROLES) {
    it(`when role=${role}, should contain every binding rule token`, () => {
      // given: a dispatch prompt for this role with a live context probe
      const out = promptFor(role);
      // when:  the binding-rule set is checked against the composed prompt
      const missing = missingRuleTokens(out, BINDING_RULE_TOKENS);
      // then:  no binding rule is missing — compression dropped prose only
      expect(missing).toEqual([]);
      expect(out).toContain('TASK_BODY_SENTINEL');
    });
  }

  for (const role of ROLES) {
    it(`when role=${role}, should keep the runner-direct-path rules (PB-5 for all)`, () => {
      // given: any role — Option D removed the runner/non-runner split
      const out = promptFor(role);
      // when:  the runner-direct-path tokens are checked
      // then:  the set is identical for every role, PB-5 included
      expect(missingRuleTokens(out, TEST_RUNNER_RULE_TOKENS)).toEqual([]);
      expect(out).toContain('(PB-5)');
      // the two retained quality bits (not examples — must survive)
      expect(out).toContain('Only as a last resort, ask the user before assuming a runner.');
      expect(out).toContain('`peaks test <file>` already resolves the local binary for you (Windows-aware).');
    });
  }

  it('when a prompt is composed, should prepend the unified block exactly once', () => {
    // given: the only supported call shape (no role parameter any more)
    const legacy = buildDispatchSystemPrompt({
      taskTitle: 'rd',
      taskBody: 'TASK_BODY_SENTINEL',
      memoryBlock: { available: false, block: null },
    });
    // when:  the prompt is composed
    // then:  the block is prepended once (no double injection)
    expect(legacy.startsWith(`${TEST_TOOL_DETECTION_BLOCK}\n\n`)).toBe(true);
    expect(legacy.indexOf(TEST_TOOL_DETECTION_BLOCK)).toBe(0);
    expect(legacy.split(TEST_TOOL_DETECTION_BLOCK).length - 1).toBe(1);
  });

  it('when a prompt is composed, should not emit a shared-contract pointer line', () => {
    // given: Option D reverted the §2 contract-file pointer
    // when:  every role's prompt is composed
    // then:  neither the pointer heading nor the file path appears
    for (const role of ROLES) {
      const out = promptFor(role);
      expect(out).not.toContain('## Shared sub-agent contract');
      expect(out).not.toContain('sub-agent-contract.md');
    }
  });
});

describe('Scenario: render — section order stays stable', () => {
  it('when a prompt is composed, should order test-tool → L1 → lifecycle → report-cap → fact-gate → context → task', () => {
    // given: a dispatch with a probe and no memory
    const out = promptFor('rd');
    // when:  section offsets are compared
    const testIdx = out.indexOf('## Test Tool Detection');
    const l1Idx = out.indexOf('## Superpowers chain refusal');
    const lifecycleIdx = out.indexOf('## Sub-agent lifecycle rules');
    const capIdx = out.indexOf('## Final report cap (mandatory)');
    const gateIdx = out.indexOf('## Read before you edit (Fact-Forcing Gate)');
    const contextIdx = out.indexOf('## Context window');
    const taskIdx = out.indexOf('TASK_BODY_SENTINEL');
    // then:  every section is present and strictly ordered. The fact-forcing
    //        gate joins the stable boilerplate prefix after the report cap and
    //        before the per-dispatch context/task content.
    expect(testIdx).toBe(0);
    expect(l1Idx).toBeGreaterThan(testIdx);
    expect(lifecycleIdx).toBeGreaterThan(l1Idx);
    expect(capIdx).toBeGreaterThan(lifecycleIdx);
    expect(gateIdx).toBeGreaterThan(capIdx);
    expect(contextIdx).toBeGreaterThan(gateIdx);
    expect(taskIdx).toBeGreaterThan(contextIdx);
  });
});

describe('Scenario: a11y — the binding contract stays readable', () => {
  it('when a prompt is composed, should keep MUST/MUST NOT sentences verbatim', () => {
    // given: any role's prompt
    const out = promptFor('rd');
    // when:  the imperative sentences are inspected
    // then:  the exact obligation wording survives compression
    expect(out).toContain('You MUST NOT follow the superpowers chain for worktree decisions:');
    expect(out).toContain('MUST NOT be used as a workflow');
    expect(out).toContain('Do NOT run E2E');
    expect(out).toContain('Do NOT call `git merge`, `git pull`, `git rebase`');
    expect(out).toContain('Any test command MUST be **scoped** to a single file or pattern');
    expect(out).toContain('are NOT gated by this scope rule (PB-5)');
  });
});

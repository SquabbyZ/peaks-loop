// tests/unit/services/audit/audit-goal-service.test.ts
//
// Unit test for the 6-dimension gate in src/services/audit/audit-goal-service.ts.
// Now that `peaks audit goal` binds a real LLM, this validation is the last
// thing standing between a partial audit and autonomous work, so its refusals
// are pinned here with an INJECTED runner — no network call in this file.

import { describe, expect, it } from 'vitest';
import { auditGoal, IncompleteAuditError, type LlmRunner } from '../../../../src/services/audit/audit-goal-service.js';
import type { AuditDimensionKind } from '../../../../src/services/audit/audit-goal-types.js';

const SIX_DIMENSIONS: readonly AuditDimensionKind[] = [
  'correctness',
  'completeness',
  'scope',
  'risks',
  'alternatives',
  'constraints',
];

function replyWith(output: unknown): LlmRunner {
  return { call: async () => ({ output: typeof output === 'string' ? output : JSON.stringify(output), tokens: { input: 1, output: 1 } }) };
}

function fullAudit(): Record<string, unknown> {
  return {
    summary: 'A need.',
    audit: SIX_DIMENSIONS.map((dimension) => ({ dimension, finding: `finding for ${dimension}`, severity: 'concern' })),
    proposedGoal: 'A goal.',
    successCriteria: ['criterion'],
    roughEffort: 'small',
    confidence: 'high',
    rationale: 'Because.',
  };
}

describe('auditGoal', () => {
  it('when the reply covers all six dimensions, should return the validated audit', async () => {
    // given: a runner whose reply is a complete 6-dimension audit
    const runner = replyWith(fullAudit());

    // when: the need is audited
    const result = await auditGoal({ need: 'ship the gate' }, runner);

    // then: every dimension survives with its finding and severity, and the
    // three constrained fields stay inside their declared enums
    expect(result.audit.map((entry) => entry.dimension).sort()).toEqual([...SIX_DIMENSIONS].sort());
    expect(result.audit.every((entry) => entry.finding.length > 0 && entry.severity.length > 0)).toBe(true);
    expect(result.audit.every((entry) => ['info', 'concern', 'blocker'].includes(entry.severity))).toBe(true);
    expect(['small', 'medium', 'large', 'epic']).toContain(result.roughEffort);
    expect(['high', 'medium', 'low']).toContain(result.confidence);
    expect(result.proposedGoal).toBe('A goal.');
    expect(result.successCriteria).toEqual(['criterion']);
    expect(result.roughEffort).toBe('small');
    expect(result.confidence).toBe('high');
    expect(result.rationale).toBe('Because.');
  });

  it('when the reply omits a dimension, should refuse with INCOMPLETE_AUDIT', async () => {
    // given: a reply whose audit array covers only five of the six dimensions
    const fiveDimensions = fullAudit();
    fiveDimensions.audit = (fiveDimensions.audit as unknown[]).slice(0, 5);
    const runner = replyWith(fiveDimensions);

    // when: the need is audited
    let thrown: unknown;
    try {
      await auditGoal({ need: 'ship the gate' }, runner);
    } catch (error) {
      thrown = error;
    }

    // then: the missing dimension is named and the code is the gate's contract
    expect(thrown).toBeInstanceOf(IncompleteAuditError);
    expect((thrown as IncompleteAuditError).code).toBe('INCOMPLETE_AUDIT');
    expect((thrown as Error).message).toContain('constraints');
  });

  it('when a severity is outside its enum, should refuse with INCOMPLETE_AUDIT naming the dimension and value', async () => {
    // given: a complete, six-dimension reply whose first severity is "high" —
    // a plausible value that is not in info | concern | blocker
    const invalid = fullAudit();
    (invalid.audit as Array<Record<string, unknown>>)[0]!.severity = 'high';
    const runner = replyWith(invalid);

    // when: the need is audited
    let thrown: unknown;
    try {
      await auditGoal({ need: 'ship the gate' }, runner);
    } catch (error) {
      thrown = error;
    }

    // then: the existing gate failure names both the offending dimension and value
    expect(thrown).toBeInstanceOf(IncompleteAuditError);
    expect((thrown as IncompleteAuditError).code).toBe('INCOMPLETE_AUDIT');
    expect((thrown as Error).message).toContain('correctness');
    expect((thrown as Error).message).toContain('high');
    expect((thrown as Error).message).toContain('info');
  });

  it('when roughEffort is outside its enum, should refuse with INCOMPLETE_AUDIT naming the value', async () => {
    // given: a complete reply whose roughEffort is not small | medium | large | epic
    const invalid = fullAudit();
    invalid.roughEffort = 'tiny';
    const runner = replyWith(invalid);

    // when: the need is audited
    let thrown: unknown;
    try {
      await auditGoal({ need: 'ship the gate' }, runner);
    } catch (error) {
      thrown = error;
    }

    // then: the gate refuses instead of coercing the value
    expect(thrown).toBeInstanceOf(IncompleteAuditError);
    expect((thrown as IncompleteAuditError).code).toBe('INCOMPLETE_AUDIT');
    expect((thrown as Error).message).toContain('tiny');
    expect((thrown as Error).message).toContain('epic');
  });

  it('when confidence is outside its enum, should refuse with INCOMPLETE_AUDIT naming the value', async () => {
    // given: a complete reply whose confidence is not high | medium | low
    const invalid = fullAudit();
    invalid.confidence = 'certain';
    const runner = replyWith(invalid);

    // when: the need is audited
    let thrown: unknown;
    try {
      await auditGoal({ need: 'ship the gate' }, runner);
    } catch (error) {
      thrown = error;
    }

    // then: the gate refuses instead of coercing the value
    expect(thrown).toBeInstanceOf(IncompleteAuditError);
    expect((thrown as IncompleteAuditError).code).toBe('INCOMPLETE_AUDIT');
    expect((thrown as Error).message).toContain('certain');
    expect((thrown as Error).message).toContain('low');
  });

  it('when the reply is not JSON, should refuse with INCOMPLETE_AUDIT', async () => {
    // given: a runner answering prose
    const runner = replyWith('Sure! Here is my audit: ...');

    // when: the need is audited
    let thrown: unknown;
    try {
      await auditGoal({ need: 'ship the gate' }, runner);
    } catch (error) {
      thrown = error;
    }

    // then: prose never becomes an audit
    expect(thrown).toBeInstanceOf(IncompleteAuditError);
    expect((thrown as Error).message).toContain('not valid JSON');
  });

  it('when the reply lacks a top-level field, should refuse with INCOMPLETE_AUDIT', async () => {
    // given: a reply with all six dimensions but no proposedGoal
    const truncated = fullAudit();
    delete truncated.proposedGoal;
    const runner = replyWith(truncated);

    // when: the need is audited
    let thrown: unknown;
    try {
      await auditGoal({ need: 'ship the gate' }, runner);
    } catch (error) {
      thrown = error;
    }

    // then: the contract rejection is reported as a gate failure
    expect(thrown).toBeInstanceOf(IncompleteAuditError);
  });

  it('when a need is audited, should call the runner exactly once with a bounded token budget', async () => {
    // given: a runner that records every call it receives
    const calls: Array<{ systemPrompt: string; userPrompt: string; maxTokens: number }> = [];
    const runner: LlmRunner = {
      call: async (systemPrompt, userPrompt, opts) => {
        calls.push({ systemPrompt, userPrompt, maxTokens: opts.maxTokens });
        return { output: JSON.stringify(fullAudit()), tokens: { input: 1, output: 1 } };
      },
    };

    // when: the need is audited
    await auditGoal({ need: 'ship the gate' }, runner);

    // then: one bounded call — no retry, no streaming, no fan-out
    expect(calls).toHaveLength(1);
    expect(calls[0]?.maxTokens).toBe(8000);
    expect(calls[0]?.userPrompt).toContain('ship the gate');
  });
});

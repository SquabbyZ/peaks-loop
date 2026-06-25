import { describe, it, expect, vi } from 'vitest';
import {
  auditGoal,
  IncompleteAuditError,
  type LlmRunner
} from '../../../src/services/audit/audit-goal-service.js';

describe('auditGoal', () => {
  it('produces 6-dimension audit + goal', async () => {
    const llmRunner: LlmRunner = {
      call: vi.fn().mockResolvedValue({
        output: JSON.stringify({
          summary: 'Refactor config-service into 3 modules.',
          audit: [
            { dimension: 'correctness', finding: 'Problem matches recent 800-line cap refactors.', severity: 'info' },
            { dimension: 'completeness', finding: 'Need also implies test coverage.', severity: 'concern' },
            { dimension: 'scope', finding: '3 sibling modules is appropriate.', severity: 'info' },
            { dimension: 'risks', finding: 'Public API must be preserved.', severity: 'concern' },
            { dimension: 'alternatives', finding: 'Could split by domain instead of by file size.', severity: 'info' },
            { dimension: 'constraints', finding: 'Must keep backwards compat with consumers.', severity: 'concern' }
          ],
          proposedGoal: 'Split config-service.ts into 3 sibling modules with 100% test coverage.',
          successCriteria: ['All 3 modules exist and compile', 'Public API unchanged', '100% test coverage'],
          roughEffort: 'medium',
          confidence: 'high',
          rationale: 'Recent 800-line cap refactors establish a clear pattern.'
        }),
        tokens: { input: 800, output: 400 }
      })
    };
    const result = await auditGoal({ need: 'Split config-service into 3 modules' }, llmRunner);
    expect(result.audit.length).toBe(6);
    expect(result.proposedGoal).toContain('Split');
    expect(result.successCriteria.length).toBeGreaterThan(0);
    expect(llmRunner.call).toHaveBeenCalledTimes(1);
  });

  it('throws IncompleteAuditError when dimensions are missing', async () => {
    const llmRunner: LlmRunner = {
      call: vi.fn().mockResolvedValue({
        output: JSON.stringify({
          summary: '...',
          audit: [{ dimension: 'correctness', finding: '...', severity: 'info' }],
          proposedGoal: '...',
          successCriteria: [],
          roughEffort: 'medium',
          confidence: 'low',
          rationale: '...'
        }),
        tokens: { input: 100, output: 50 }
      })
    };
    await expect(auditGoal({ need: '...' }, llmRunner)).rejects.toBeInstanceOf(IncompleteAuditError);
  });

  it('throws IncompleteAuditError when LLM output is not valid JSON', async () => {
    const llmRunner: LlmRunner = {
      call: vi.fn().mockResolvedValue({
        output: 'not valid json {',
        tokens: { input: 10, output: 5 }
      })
    };
    await expect(auditGoal({ need: '...' }, llmRunner)).rejects.toBeInstanceOf(IncompleteAuditError);
  });

  it('passes the need into the user prompt', async () => {
    const callMock = vi.fn().mockResolvedValue({
      output: JSON.stringify({
        summary: 'x',
        audit: [
          { dimension: 'correctness', finding: 'x', severity: 'info' },
          { dimension: 'completeness', finding: 'x', severity: 'info' },
          { dimension: 'scope', finding: 'x', severity: 'info' },
          { dimension: 'risks', finding: 'x', severity: 'info' },
          { dimension: 'alternatives', finding: 'x', severity: 'info' },
          { dimension: 'constraints', finding: 'x', severity: 'info' }
        ],
        proposedGoal: 'x',
        successCriteria: ['x'],
        roughEffort: 'small',
        confidence: 'high',
        rationale: 'x'
      }),
      tokens: { input: 1, output: 1 }
    });
    const llmRunner: LlmRunner = { call: callMock };
    await auditGoal({ need: 'Refactor X' }, llmRunner);
    const [, userPrompt] = callMock.mock.calls[0] as [string, string, { maxTokens: number }];
    expect(userPrompt).toContain('Refactor X');
  });
});

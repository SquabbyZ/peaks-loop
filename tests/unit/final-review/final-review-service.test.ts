import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  prepareFinalReview,
  IncompleteFinalReviewError
} from '../../../src/services/final-review/final-review-service.js';
import type { LlmRunner } from '../../../src/services/audit/audit-goal-service.js';

const REQUIRED_DIMS = [
  'functional-completeness',
  'problem-resolution',
  'no-new-bugs',
  'existing-functionality-intact'
] as const;

const validLlmOutput = (dims: readonly string[] = REQUIRED_DIMS) => ({
  rid: '008-2026-06-25',
  generatedAt: '2026-06-25T10:00:00.000Z',
  dimensions: dims.map(d => ({
    dimension: d,
    verdict: 'pass' as const,
    summary: `summary for ${d}`,
    evidence: [{ kind: 'test-result' as const, description: 'all green' }],
    confidence: 'high' as const
  })),
  overallSummary: 'all four dimensions pass',
  allPass: true,
  needsAttention: []
});

describe('prepareFinalReview', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'final-review-'));
    const auditGoalDir = join(projectRoot, '.peaks', '_runtime', 'sess-1', 'audit-goal');
    require('node:fs').mkdirSync(auditGoalDir, { recursive: true });
    writeFileSync(
      join(auditGoalDir, '008-2026-06-25.json'),
      JSON.stringify({
        summary: 'Refactor config-service into 3 modules.',
        audit: [],
        proposedGoal: 'Split config-service.ts into 3 sibling modules.',
        successCriteria: [
          'All 3 modules exist and compile',
          'Public API unchanged',
          '100% test coverage'
        ],
        roughEffort: 'medium',
        confidence: 'high',
        rationale: 'r'
      })
    );
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('produces 4-dim final review with all dimensions present', async () => {
    const llmRunner: LlmRunner = {
      call: vi.fn().mockResolvedValue({
        output: JSON.stringify(validLlmOutput()),
        tokens: { input: 100, output: 200 }
      })
    };
    const result = await prepareFinalReview('008-2026-06-25', {
      projectRoot,
      sessionId: 'sess-1',
      llmRunner
    });
    expect(result.dimensions.length).toBe(4);
    for (const d of REQUIRED_DIMS) {
      expect(result.dimensions.find(x => x.dimension === d)).toBeDefined();
    }
    expect(result.allPass).toBe(true);
    expect(llmRunner.call).toHaveBeenCalledTimes(1);
  });

  it('throws IncompleteFinalReviewError when a dimension is missing', async () => {
    const llmRunner: LlmRunner = {
      call: vi.fn().mockResolvedValue({
        output: JSON.stringify(validLlmOutput(['functional-completeness', 'problem-resolution', 'no-new-bugs'])),
        tokens: { input: 100, output: 200 }
      })
    };
    await expect(
      prepareFinalReview('008-2026-06-25', { projectRoot, sessionId: 'sess-1', llmRunner })
    ).rejects.toBeInstanceOf(IncompleteFinalReviewError);
  });

  it('throws IncompleteFinalReviewError when LLM output is not valid JSON', async () => {
    const llmRunner: LlmRunner = {
      call: vi.fn().mockResolvedValue({
        output: 'not valid json {',
        tokens: { input: 10, output: 5 }
      })
    };
    await expect(
      prepareFinalReview('008-2026-06-25', { projectRoot, sessionId: 'sess-1', llmRunner })
    ).rejects.toBeInstanceOf(IncompleteFinalReviewError);
  });

  it('passes success criteria into the LLM user prompt', async () => {
    const callMock = vi.fn().mockResolvedValue({
      output: JSON.stringify(validLlmOutput()),
      tokens: { input: 1, output: 1 }
    });
    const llmRunner: LlmRunner = { call: callMock };
    await prepareFinalReview('008-2026-06-25', { projectRoot, sessionId: 'sess-1', llmRunner });
    const [, userPrompt] = callMock.mock.calls[0] as [string, string, { maxTokens: number }];
    expect(userPrompt).toContain('All 3 modules exist and compile');
    expect(userPrompt).toContain('Public API unchanged');
    expect(userPrompt).toContain('100% test coverage');
  });

  it('throws when the approved goal file does not exist', async () => {
    const llmRunner: LlmRunner = {
      call: vi.fn().mockResolvedValue({
        output: JSON.stringify(validLlmOutput()),
        tokens: { input: 1, output: 1 }
      })
    };
    await expect(
      prepareFinalReview('999-not-found', { projectRoot, sessionId: 'sess-1', llmRunner })
    ).rejects.toThrow(/Cannot read approved goal/);
    expect(llmRunner.call).not.toHaveBeenCalled();
  });
});

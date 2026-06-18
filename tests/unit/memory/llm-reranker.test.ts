/**
 * Slice Z-A (2.8.0) — LLM rerank service unit tests.
 *
 * Validates the spike's core ACs:
 *  - Prompt is built deterministically + contains query + candidate names.
 *  - JSON parse success path returns reordered topK.
 *  - Markdown code fence in LLM response is tolerated.
 *  - Parse failure falls back to original fuzzy order with warning.
 *  - Chat timeout (AbortController) falls back with warning.
 *  - Chat network error falls back with warning.
 *  - No chat function injected → fail-open (skipped-no-chat-fn).
 *  - Empty input → empty topK, no warning.
 *  - Input smaller than topK → no-op, no LLM call.
 *  - Duplicate / out-of-range indices handled defensively.
 *  - Token estimation matches `BYTES_PER_TOKEN = 4` heuristic.
 */

import { describe, expect, it } from 'vitest';
import {
  applyRerankOrder,
  estimateTokens,
  noopRerankChat,
  parseRerankResponse,
  renderRerankPrompt,
  rerank,
  type RerankChatFn,
  type RerankChatMessage
} from '../../../src/services/memory/llm-reranker.js';
import type { MemorySearchResult } from '../../../src/services/memory/memory-search-service.js';

function makeCandidate(name: string, description: string, score = 0.5): MemorySearchResult {
  return {
    name,
    kind: 'convention',
    description,
    sourcePath: `.peaks/memory/${name}.md`,
    score,
    positions: []
  };
}

const SAMPLE_CANDIDATES: MemorySearchResult[] = [
  makeCandidate('coverage-red-line', 'forbid padding tests; 80% coverage hard floor', 0.95),
  makeCandidate('sub-agent-context-minimal-occupation', 'sub-agent prompt must be minimal', 0.88),
  makeCandidate('audit-decision-record-convention', 'audit decision files land in .peaks/memory/audit-decisions/', 0.75),
  makeCandidate('workspace-underscore-convention', '.peaks/_*/ is gitignored ephemeral', 0.60),
  makeCandidate('main-branch-iteration', 'iterate on main; no worktree', 0.55),
  makeCandidate('peaks-current-directory-scope', 'peaks state is per-project, not global', 0.50)
];

describe('llm-reranker.renderRerankPrompt', () => {
  it('contains the query and every candidate name with [i] index', () => {
    const prompt = renderRerankPrompt('sub-agent context', SAMPLE_CANDIDATES);
    expect(prompt).toContain('Query: "sub-agent context"');
    expect(prompt).toContain('Rank the following 6 candidate memories');
    for (let i = 0; i < SAMPLE_CANDIDATES.length; i += 1) {
      expect(prompt).toContain(`[${i}] ${SAMPLE_CANDIDATES[i]!.name}`);
    }
  });

  it('truncates overlong descriptions with an ellipsis marker', () => {
    const longDesc = 'x'.repeat(500);
    const candidates = [makeCandidate('long-name', longDesc)];
    const prompt = renderRerankPrompt('q', candidates);
    expect(prompt).toContain('…');
    expect(prompt.length).toBeLessThan(longDesc.length);
  });
});

describe('llm-reranker.parseRerankResponse', () => {
  it('parses a pure JSON array', () => {
    expect(parseRerankResponse('[3, 0, 4, 1, 2]')).toEqual([3, 0, 4, 1, 2]);
  });

  it('tolerates a markdown code fence', () => {
    const raw = '```json\n[5, 2, 0, 3, 1]\n```';
    expect(parseRerankResponse(raw)).toEqual([5, 2, 0, 3, 1]);
  });

  it('returns null on non-JSON garbage', () => {
    expect(parseRerankResponse('I cannot rank these.')).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(parseRerankResponse('')).toBeNull();
    expect(parseRerankResponse('   ')).toBeNull();
  });

  it('returns null when the array contains non-integer items', () => {
    expect(parseRerankResponse('[0, 1.5, 2]')).toBeNull();
    expect(parseRerankResponse('[0, "1", 2]')).toBeNull();
  });

  it('returns null on negative indices', () => {
    expect(parseRerankResponse('[-1, 0, 1]')).toBeNull();
  });
});

describe('llm-reranker.applyRerankOrder', () => {
  it('reorders per the indices and caps at topK', () => {
    const order = [3, 0, 4, 1, 2];
    const result = applyRerankOrder(SAMPLE_CANDIDATES, order, 3);
    expect(result.map((c) => c.name)).toEqual([
      'workspace-underscore-convention',
      'coverage-red-line',
      'main-branch-iteration'
    ]);
  });

  it('skips out-of-range indices and falls back to fuzzy order for missing slots', () => {
    const order = [0, 999, 2];
    const result = applyRerankOrder(SAMPLE_CANDIDATES, order, 5);
    expect(result).toHaveLength(5);
    expect(result[0]!.name).toBe('coverage-red-line');
    expect(result[1]!.name).toBe('audit-decision-record-convention');
    // Remaining slots filled from fuzzy order.
    expect(result[2]!.name).toBe('sub-agent-context-minimal-occupation');
  });

  it('skips duplicate indices', () => {
    const order = [0, 0, 0, 1];
    const result = applyRerankOrder(SAMPLE_CANDIDATES, order, 3);
    expect(result.map((c) => c.name)).toEqual([
      'coverage-red-line',
      'sub-agent-context-minimal-occupation',
      'audit-decision-record-convention'
    ]);
  });
});

describe('llm-reranker.estimateTokens', () => {
  it('uses the 4-bytes-per-token heuristic (matches headroom-client.ts:60)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});

describe('llm-reranker.rerank', () => {
  it('returns empty topK with no warning when input is empty', async () => {
    const result = await rerank('q', []);
    expect(result.topK).toEqual([]);
    expect(result.degradation).toBe('noop-empty-input');
    expect(result.warning).toBeNull();
    expect(result.tokens.total).toBe(0);
  });

  it('is a no-op when input length <= topK (no LLM call)', async () => {
    let called = false;
    const chat: RerankChatFn = async () => {
      called = true;
      return '[0]';
    };
    const candidates = SAMPLE_CANDIDATES.slice(0, 3);
    const result = await rerank('q', candidates, { topK: 5, chat });
    expect(called).toBe(false);
    expect(result.topK).toHaveLength(3);
    expect(result.degradation).toBe('noop-empty-input');
  });

  it('returns the original fuzzy order with a warning when no chat fn is provided', async () => {
    const result = await rerank('sub-agent', SAMPLE_CANDIDATES, { topN: 5, topK: 3 });
    expect(result.degradation).toBe('skipped-no-chat-fn');
    expect(result.warning).toMatch(/No chat function/);
    expect(result.topK).toHaveLength(3);
    expect(result.topK[0]!.name).toBe('coverage-red-line');
    // Token usage is reported so the benchmark can attribute the saved cost.
    expect(result.tokens.promptTokens).toBeGreaterThan(0);
    expect(result.tokens.responseTokens).toBe(0);
  });

  it('reranks successfully when chat returns a valid JSON array', async () => {
    const chat: RerankChatFn = async () => '[3, 0, 4, 1, 2]';
    const result = await rerank('q', SAMPLE_CANDIDATES, { topN: 6, topK: 3, chat });
    expect(result.degradation).toBe('reranked');
    expect(result.warning).toBeNull();
    expect(result.topK.map((c) => c.name)).toEqual([
      'workspace-underscore-convention',
      'coverage-red-line',
      'main-branch-iteration'
    ]);
    expect(result.tokens.total).toBeGreaterThan(0);
  });

  it('tolerates markdown code fence in chat response', async () => {
    const chat: RerankChatFn = async () => '```json\n[5, 2, 0]\n```';
    const result = await rerank('q', SAMPLE_CANDIDATES, { topN: 6, topK: 3, chat });
    expect(result.degradation).toBe('reranked');
    expect(result.topK[0]!.name).toBe('peaks-current-directory-scope');
    expect(result.topK[1]!.name).toBe('audit-decision-record-convention');
  });

  it('falls back to fuzzy order when chat returns garbage', async () => {
    const chat: RerankChatFn = async () => 'I cannot rank these memories.';
    const result = await rerank('q', SAMPLE_CANDIDATES, { topN: 6, topK: 3, chat });
    expect(result.degradation).toBe('parse-failed-fallback');
    expect(result.warning).toMatch(/not a valid JSON/);
    expect(result.topK[0]!.name).toBe('coverage-red-line');
  });

  it('falls back when chat rejects with a non-abort error', async () => {
    const chat: RerankChatFn = async () => {
      throw new Error('network unreachable');
    };
    const result = await rerank('q', SAMPLE_CANDIDATES, { topN: 6, topK: 3, chat });
    expect(result.degradation).toBe('chat-failed-fallback');
    expect(result.warning).toMatch(/network unreachable/);
    expect(result.topK[0]!.name).toBe('coverage-red-line');
  });

  it('falls back with timeout-fallback when chat does not abort quickly', async () => {
    // Chat that ignores the AbortSignal (intentionally misbehaved). The
    // rerank layer must still fail-open after the timeout fires.
    const chat: RerankChatFn = async (_msgs: readonly RerankChatMessage[], _signal: AbortSignal) => {
      await new Promise((r) => setTimeout(r, 200));
      throw new Error('The operation was aborted');
    };
    const result = await rerank('q', SAMPLE_CANDIDATES, {
      topN: 6,
      topK: 3,
      chatTimeoutMs: 20,
      chat
    });
    // Either timeout-fallback (signal aborted before the inner throw) or
    // chat-failed-fallback (inner throw wins the race) — both are
    // acceptable fail-open behavior.
    expect(['timeout-fallback', 'chat-failed-fallback']).toContain(result.degradation);
    expect(result.warning).not.toBeNull();
    expect(result.topK[0]!.name).toBe('coverage-red-line');
  });

  it('caps candidate input at the topN option', async () => {
    let receivedPrompt = '';
    const chat: RerankChatFn = async (msgs) => {
      const first = msgs[0];
      if (first !== undefined) receivedPrompt = first.content;
      return '[0]';
    };
    await rerank('q', SAMPLE_CANDIDATES, { topN: 3, topK: 2, chat });
    // The prompt must reference only indices 0..2.
    expect(receivedPrompt).toContain('[0]');
    expect(receivedPrompt).toContain('[2]');
    expect(receivedPrompt).not.toContain('[3]');
    expect(receivedPrompt).not.toContain('[5]');
  });
});

describe('llm-reranker.noopRerankChat', () => {
  it('throws NO_CHAT_FN — the fail-open contract is enforced by the caller', async () => {
    const controller = new AbortController();
    await expect(noopRerankChat([], controller.signal)).rejects.toThrow(/NO_CHAT_FN/);
  });
});

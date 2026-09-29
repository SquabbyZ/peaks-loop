/**
 * Slice Z-A (2.8.0) — LLM rerank service (Y2 architecture, zero new deps).
 *
 * Receives a fuzzy top-N candidate list (from `searchMemory` /
 * `MemorySearchResult[]`) and asks an LLM to rerank them by relevance
 * to the query. Returns the top-K in descending relevance.
 *
 * Architecture note (locked decision — see
 * `.peaks/memory/2026-06-18-peaks-zvec-spike-proposal.md` §Y2):
 *
 *   - "Active IDE LLM" is a deliberate abstraction: peaks-loop itself
 *     has NO direct LLM API key. The chat call is performed by the
 *     active IDE (Claude Code / Trae / Cursor / Codex / ...) using
 *     its own authentication chain.
 *
 *   - The current `IdeAdapter` interface has no `chat()` method —
 *     `SubAgentDispatcher` returns IDE-private tool-call descriptors
 *     (sub-agent dispatch, not direct chat). This service therefore
 *     takes a `chat` function INJECTION at the call site. The default
 *     is a no-op that fails-open (returns the original fuzzy order).
 *
 *   - This is a SPIKE artifact for Z-A. The real chat wiring (either
 *     a new `IdeAdapter.chat()` method, or routing through
 *     `SubAgentDispatcher` with a "rerank" role) is a Z-B prerequisite
 *     and is tracked in the GO/NO-GO report at
 *     `.peaks/memory/memory-search-y2-rerank-2026-06-19-decision.md`.
 *
 * Why this is split from `memory-search-service.ts`:
 *
 *   - The fuzzy kernel is pure + synchronous + 100% testable today.
 *   - The rerank layer is async + IO-bound + 100% fallback. Keeping
 *     it separate means the existing 2800+ fuzzy tests are untouched
 *     and the new spike has its own test surface (per the Z-A
 *     proposal's "不重写 memory-search-service.ts" red line).
 *
 * Why 4-bytes-per-token:
 *
 *   - `BYTES_PER_TOKEN = 4` is the standard rough English-text
 *     approximation (1 token ≈ 4 bytes). It keeps token estimates
 *     stable and comparable in the AC-ZA-5 benchmark.
 *
 * Out of scope (YAGNI per Karpathy #2 Simplicity First):
 *
 *   - No cross-process cache (AC-ZA-6 deferred — only build if
 *     AC-ZA-5 shows a hot path).
 *   - No rerank-prompt optimization beyond the minimal JSON
 *     output format.
 *   - No integration with `memory-search-service.ts` (Z-A is a spike;
 *     the wiring into `peaks memory search` is Z-B).
 */

import type { MemorySearchResult } from './memory-search-service.js';
import {
  applyRerankOrder,
  DEFAULT_CHAT_TIMEOUT_MS,
  DEFAULT_TOP_K,
  DEFAULT_TOP_N,
  estimateTokens,
  MAX_CANDIDATES,
  renderRerankPrompt,
  type RerankChatFn,
  type RerankOptions,
  type RerankResult
} from './llm-reranker-core.js';

// The pure core (constants, public option/result types, synchronous helpers)
// now lives in `llm-reranker-core.ts`. Re-export it from this module path so
// every existing importer of `llm-reranker.js` keeps resolving the same names.
export { applyRerankOrder, estimateTokens, renderRerankPrompt } from './llm-reranker-core.js';
export type {
  RerankChatFn,
  RerankChatMessage,
  RerankOptions,
  RerankResult,
  RerankTokenUsage
} from './llm-reranker-core.js';

/**
 * Parse the LLM's raw text response into an ordered list of
 * candidate indices. Tolerates:
 *
 *   - Pure JSON arrays: `[3, 0, 4, 1, 2]`
 *   - JSON wrapped in markdown code fences:
 *       ```json
 *       [3, 0, 4, 1, 2]
 *       ```
 *   - Whitespace and surrounding prose (best-effort: looks for the
 *     first `[...]` block)
 *
 * Returns `null` on parse failure (caller falls back to original
 * fuzzy order per AC-ZA-8 L3).
 */
export function parseRerankResponse(raw: string): readonly number[] | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  // Strip markdown code fence if present.
  let body = trimmed;
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  if (fenceMatch !== null && fenceMatch[1] !== undefined) {
    body = fenceMatch[1];
  }

  // Best-effort: locate the first JSON array in the body.
  const arrayMatch = /\[[\s\S]*?\]/.exec(body);
  const candidate = arrayMatch !== null ? arrayMatch[0] : body;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const indices: number[] = [];
  for (const item of parsed) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0) {
      return null;
    }
    indices.push(item);
  }
  return indices;
}

/**
 * The no-op chat function. Used when no real chat injection is
 * available — the rerank layer fails-open and the caller gets
 * the original fuzzy order.
 */
export const noopRerankChat: RerankChatFn = async () => {
  throw new Error('NO_CHAT_FN: rerank chat function not provided (default fail-open)');
};

/**
 * Run the LLM rerank. Always returns a result — never throws.
 * The caller can use `topK` as a drop-in replacement for the
 * fuzzy top-K regardless of degradation mode.
 */
export async function rerank(
  query: string,
  candidates: readonly MemorySearchResult[],
  options: RerankOptions = {}
): Promise<RerankResult> {
  const topN = Math.min(Math.max(options.topN ?? DEFAULT_TOP_N, 1), MAX_CANDIDATES);
  const topK = Math.min(Math.max(options.topK ?? DEFAULT_TOP_K, 1), topN);
  const chatTimeoutMs = options.chatTimeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS;
  const chat = options.chat ?? noopRerankChat;

  // Edge case 1: empty input. Return empty result, no warning.
  if (candidates.length === 0) {
    return {
      topK: [],
      tokens: { promptTokens: 0, responseTokens: 0, total: 0 },
      degradation: 'noop-empty-input',
      warning: null
    };
  }

  // Edge case 2: input fits within topK already. Rerank would be
  // a no-op — return as-is without paying the LLM cost.
  if (candidates.length <= topK) {
    return {
      topK: candidates.slice(0, topK),
      tokens: { promptTokens: 0, responseTokens: 0, total: 0 },
      degradation: 'noop-empty-input',
      warning: null
    };
  }

  // Slice to topN (fuzzy already returns in score-descending order).
  const truncated = candidates.slice(0, topN);
  const prompt = renderRerankPrompt(query, truncated);
  const promptTokens = estimateTokens(prompt);

  // Edge case 3: no chat function. Fail-open per AC-ZA-8 L1.
  if (options.chat === undefined) {
    return {
      topK: truncated.slice(0, topK),
      tokens: { promptTokens, responseTokens: 0, total: promptTokens },
      degradation: 'skipped-no-chat-fn',
      warning: 'No chat function provided; returning original fuzzy order.'
    };
  }

  // Chat call with timeout (AbortController-based).
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), chatTimeoutMs);
  let raw = '';
  try {
    raw = await chat([{ role: 'user', content: prompt }], controller.signal);
  } catch (chatError) {
    clearTimeout(timeoutHandle);
    const message = chatError instanceof Error ? chatError.message : String(chatError);
    const isTimeout = controller.signal.aborted && /abort/i.test(message);
    return {
      topK: truncated.slice(0, topK),
      tokens: { promptTokens, responseTokens: 0, total: promptTokens },
      degradation: isTimeout ? 'timeout-fallback' : 'chat-failed-fallback',
      warning: isTimeout
        ? `Chat timeout after ${chatTimeoutMs}ms; returning original fuzzy order.`
        : `Chat failed: ${message}; returning original fuzzy order.`
    };
  }
  clearTimeout(timeoutHandle);

  // Parse the response.
  const order = parseRerankResponse(raw);
  const responseTokens = estimateTokens(raw);
  if (order === null) {
    return {
      topK: truncated.slice(0, topK),
      tokens: { promptTokens, responseTokens, total: promptTokens + responseTokens },
      degradation: 'parse-failed-fallback',
      warning: 'LLM response was not a valid JSON index array; returning original fuzzy order.'
    };
  }

  // Apply the order and return.
  const topKResult = applyRerankOrder(truncated, order, topK);
  return {
    topK: topKResult,
    tokens: { promptTokens, responseTokens, total: promptTokens + responseTokens },
    degradation: 'reranked',
    warning: null
  };
}

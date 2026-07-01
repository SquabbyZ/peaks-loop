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
 *   - `headroom-client.ts:60` already uses `BYTES_PER_TOKEN = 4` as
 *     its rough English-text approximation. Reusing the same constant
 *     keeps token estimates comparable across the headroom + rerank
 *     pipelines in the AC-ZA-5 benchmark.
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

// Approximate 1 token = 4 bytes for English text. Matches
// `headroom-client.ts:60` so the AC-ZA-5 benchmark can compare
// rerank input cost against headroom compressed cost directly.
const BYTES_PER_TOKEN = 4;

// Hard caps so a pathological query / 60-candidate list cannot blow
// up the LLM prompt. These are conservative defaults; Z-B may tune.
const DEFAULT_TOP_N = 10;
const DEFAULT_TOP_K = 5;
const MAX_CANDIDATES = 30;
const MAX_DESCRIPTION_CHARS = 240;
const DEFAULT_CHAT_TIMEOUT_MS = 5_000;

/**
 * One chat message in OpenAI-compatible format. The rerank layer
 * sends a single user-role message; `system` is reserved for Z-B
 * once the prompt-engineering is solid.
 */
export interface RerankChatMessage {
  readonly role: 'user' | 'system' | 'assistant';
  readonly content: string;
}

/**
 * Chat function injection. The caller is responsible for routing
 * the messages to the active IDE's LLM (or a mock for tests). The
 * function MUST resolve with the LLM's raw text response, or reject
 * on timeout / network error. Markdown code fences are tolerated by
 * `parseRerankResponse` and are NOT the chat function's job to strip.
 */
export type RerankChatFn = (
  messages: readonly RerankChatMessage[],
  signal: AbortSignal,
) => Promise<string>;

/**
 * Options for `rerank()`. All optional; defaults match the Z-A
 * proposal's AC-ZA-4 (fuzzy top-10 → rerank → top-5).
 */
export interface RerankOptions {
  /** Max candidates fed to the LLM. Default 10 (per AC-ZA-4). */
  readonly topN?: number;
  /** Max results returned to the caller. Default 5 (per AC-ZA-4). */
  readonly topK?: number;
  /** Per-call chat timeout in ms. Default 5000 (per AC-ZA-8 L2). */
  readonly chatTimeoutMs?: number;
  /** Chat function injection. Default fails-open (returns input order). */
  readonly chat?: RerankChatFn;
}

/**
 * Token accounting for a single rerank call. Exposed so the
 * AC-ZA-5 benchmark can report per-pipeline cost.
 */
export interface RerankTokenUsage {
  /** Tokens used to assemble the rerank prompt (query + candidates). */
  readonly promptTokens: number;
  /** Tokens the LLM emitted (estimated via length/4). */
  readonly responseTokens: number;
  readonly total: number;
}

/**
 * Rerank result. Always returns a `topK` array (possibly the
 * original fuzzy order if rerank failed / was skipped) and a
 * `warning` describing any degradation. Never throws — the
 * caller can always use `topK` as a safe drop-in for the
 * fuzzy top-K.
 */
export interface RerankResult {
  /** Final ordered list (length <= topK, never more than input). */
  readonly topK: readonly MemorySearchResult[];
  /** Token accounting (zeros when rerank was skipped). */
  readonly tokens: RerankTokenUsage;
  /** One of 'reranked' | 'parse-failed-fallback' | 'chat-failed-fallback'
   *  | 'timeout-fallback' | 'skipped-no-chat-fn' | 'noop-empty-input'. */
  readonly degradation: string;
  /** Human-readable detail. null when degradation === 'reranked'. */
  readonly warning: string | null;
}

/**
 * Estimate token count for a string. `1 token ≈ 4 bytes` for English
 * text — same approximation as `headroom-client.ts:60`.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / BYTES_PER_TOKEN);
}

/**
 * Truncate a string to a maximum character count, appending an
 * ellipsis marker when truncated. Used to keep the rerank prompt
 * bounded when a candidate's description is unusually long.
 */
function truncateForPrompt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

/**
 * Build the rerank prompt. Pure function — no IO, no side effects.
 * Trivially testable.
 *
 * Format (locked for Z-A; Z-B may tune):
 *
 *   Query: "<query>"
 *
 *   Rank the following <N> candidate memories by relevance to the
 *   query. Return a JSON array of the candidate indices in
 *   descending relevance. Return only the JSON — no prose, no
 *   markdown.
 *
 *   Candidates:
 *   [0] name-a — description-a…
 *   [1] name-b — description-b…
 *   ...
 *
 * The LLM is expected to return e.g. `[3, 0, 4, 1, 2]`. The
 * output is parsed by `parseRerankResponse`.
 */
export function renderRerankPrompt(
  query: string,
  candidates: readonly MemorySearchResult[],
): string {
  const blocks = candidates.map((c, i) => {
    const desc = truncateForPrompt(c.description, MAX_DESCRIPTION_CHARS);
    return `[${i}] ${c.name} — ${desc}`;
  });
  return [
    `Query: "${query}"`,
    '',
    `Rank the following ${candidates.length} candidate memories by relevance to the query. Return a JSON array of the candidate indices in descending relevance. Return only the JSON — no prose, no markdown.`,
    '',
    'Candidates:',
    ...blocks,
  ].join('\n');
}

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
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
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
 * Apply a parsed index ordering to a candidate list. Indices that
 * are out-of-range or duplicated are skipped (defensive). If the
 * ordering covers fewer candidates than `topK`, the remaining
 * slots are filled from the original fuzzy order.
 */
export function applyRerankOrder(
  candidates: readonly MemorySearchResult[],
  order: readonly number[],
  topK: number,
): MemorySearchResult[] {
  const result: MemorySearchResult[] = [];
  const seen = new Set<number>();
  for (const idx of order) {
    if (idx >= candidates.length) continue;
    if (seen.has(idx)) continue;
    seen.add(idx);
    const item = candidates[idx];
    if (item === undefined) continue;
    result.push(item);
    if (result.length >= topK) return result;
  }
  for (let i = 0; i < candidates.length && result.length < topK; i += 1) {
    if (seen.has(i)) continue;
    const item = candidates[i];
    if (item === undefined) continue;
    seen.add(i);
    result.push(item);
  }
  return result;
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
  options: RerankOptions = {},
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
      warning: null,
    };
  }

  // Edge case 2: input fits within topK already. Rerank would be
  // a no-op — return as-is without paying the LLM cost.
  if (candidates.length <= topK) {
    return {
      topK: candidates.slice(0, topK),
      tokens: { promptTokens: 0, responseTokens: 0, total: 0 },
      degradation: 'noop-empty-input',
      warning: null,
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
      warning: 'No chat function provided; returning original fuzzy order.',
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
        : `Chat failed: ${message}; returning original fuzzy order.`,
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
      warning: 'LLM response was not a valid JSON index array; returning original fuzzy order.',
    };
  }

  // Apply the order and return.
  const topKResult = applyRerankOrder(truncated, order, topK);
  return {
    topK: topKResult,
    tokens: { promptTokens, responseTokens, total: promptTokens + responseTokens },
    degradation: 'reranked',
    warning: null,
  };
}

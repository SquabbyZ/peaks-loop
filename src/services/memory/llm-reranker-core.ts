/**
 * Slice Z-A (2.8.0) — LLM rerank service: pure core.
 *
 * Extraction target for the `b1-filesplit-campaign` (wave 3, leaf
 * `b1w3-c-memory`): the finding-free top-level surface of
 * `llm-reranker.ts` (token/prompt constants, the public option/result types,
 * and the synchronous pure helpers). `llm-reranker.ts` imports and re-exports
 * everything here so its public API path is unchanged.
 */

import type { MemorySearchResult } from './memory-search-service.js';

// Approximate 1 token = 4 bytes for English text. Standard rough
// approximation used across the pipeline (AC-ZA-5 benchmark).
const BYTES_PER_TOKEN = 4;

// Hard caps so a pathological query / 60-candidate list cannot blow
// up the LLM prompt. These are conservative defaults; Z-B may tune.
// Exported so `rerank()` (which stays in `llm-reranker.ts`) can read them.
export const DEFAULT_TOP_N = 10;
export const DEFAULT_TOP_K = 5;
export const MAX_CANDIDATES = 30;
const MAX_DESCRIPTION_CHARS = 240;
export const DEFAULT_CHAT_TIMEOUT_MS = 5_000;

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
  signal: AbortSignal
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
 * text (standard rough approximation).
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
  candidates: readonly MemorySearchResult[]
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
    ...blocks
  ].join('\n');
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
  topK: number
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

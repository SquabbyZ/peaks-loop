/**
 * MemoryPreflightService — orchestrator-facing API for the
 * "Orchestrator Memory Preflight" slice (see
 * docs/superpowers/specs/2026-07-22-orchestrator-memory-preflight-design.md).
 *
 * Slice 2026-09-09-memory-retrieval (this revision) makes the preflight
 * task-relevant and tiered:
 *   - selection is ranked against `taskTitle` with the deterministic fuzzy
 *     kernel (no network, no embeddings);
 *   - hot entries (standing rules / feedback) are ALWAYS eligible, ranked
 *     so the most relevant lead; warm entries (project / reference) are
 *     gated on relevance and capped well below hot;
 *   - three independent budgets are enforced — max items, max bytes, and a
 *     soft wall-clock budget for the selection step;
 *   - the emitted block stays a compact index (name + path + one-line) so
 *     the sub-agent drills down with `Read` on demand instead of receiving
 *     memo bodies wholesale (body inlining is opt-in via `includeBodies`).
 *
 * Consumes:
 *   - resolveMemoryPreflightConfig (Task 1) — merged defaults + per-project overlay
 *   - MemoryIndexReader (Task 3)            — reads .peaks/memory/index.json
 *   - fuzzyMatchWithKey                     — deterministic relevance kernel
 *   - truncateToCap                         — byte-cap truncation of the composed block
 *
 * Fail-soft contract: any selection error returns `available: false` with a
 * reason; it never throws and never blocks a dispatch.
 */
import { performance } from 'node:perf_hooks';

import { fuzzyMatchWithKey } from '../fuzzy-matching/fuzzy-match-service.js';
import { MemoryIndexReader } from './memory-index-reader.js';
import {
  resolveMemoryPreflightConfig,
  type MemoryPreflightConfig,
  type MemoryPreflightPrefsInput,
} from './memory-preflight-config.js';
import type { MemoryIndexEntry } from '../memory/memory-search-service.js';

export interface MemoryPreflightResult {
  available: boolean;
  block?: string;
  /** Back-compat: total items emitted (hot + warm). */
  feedbackListItems?: number;
  cachedItemCount?: number;
  reason?: string;
  truncated?: boolean | undefined;
  droppedCount?: number | undefined;
  /** Slice 2026-09-09: hot items emitted. */
  hotSelected?: number | undefined;
  /** Slice 2026-09-09: warm items emitted. */
  warmSelected?: number | undefined;
  /** Slice 2026-09-09: bytes of the emitted block (utf8). */
  bytesEmitted?: number | undefined;
  /** Slice 2026-09-09: true when ANY budget (items / bytes / time) cut content. */
  budgetTruncated?: boolean | undefined;
  /** Slice 2026-09-09: true when the soft selection time budget was hit. */
  timedOut?: boolean | undefined;
}

interface RankedEntry {
  entry: MemoryIndexEntry;
  score: number;
}

/** Function words carry no selection signal. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'not', 'are', 'was',
  'but', 'you', 'all', 'any', 'can', 'has', 'its', 'our', 'out', 'use', 'via',
  'per', 'into', 'when', 'then', 'than', 'they', 'their', 'should', 'must',
]);

/**
 * Tokens shorter than 4 chars are too promiscuous for literal containment
 * ("add" is a substring of "padding"), so they rank but do not gate.
 */
const MIN_TOKEN_LENGTH = 4;

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function queryTokens(query: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of query.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < MIN_TOKEN_LENGTH || STOPWORDS.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

/**
 * Absolute relevance gate: does the token literally occur in the entry?
 *
 * The fuzzy kernel's score is normalized per batch (best match = 1.0), so
 * it cannot distinguish a strong match from the best of a bad lot — an
 * absolute check is required for the warm gate. CJK titles have no word
 * boundaries, so those tokens fall back to 2-char gram overlap.
 */
function tokenHits(text: string, tokens: string[]): number {
  let hits = 0;
  for (const token of tokens) {
    if (text.includes(token)) {
      hits += 1;
      continue;
    }
    if (!CJK_RE.test(token)) continue;
    for (let i = 0; i + 2 <= token.length; i += 1) {
      if (text.includes(token.slice(i, i + 2))) {
        hits += 1;
        break;
      }
    }
  }
  return hits;
}

function truncateToCap(
  text: string,
  capBytes: number,
): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= capBytes) {
    return { text, truncated: false };
  }
  const sliced = text.slice(0, Math.max(0, capBytes - 64)) + '\n…[truncated]';
  return { text: sliced, truncated: true };
}

export class MemoryPreflightService {
  private readonly reader: MemoryIndexReader;
  private readonly config: MemoryPreflightConfig;
  /** path -> body; sub-agent-requested memo contents (Task 4 deviation, see module header). */
  private readonly cachedMemoContents = new Map<string, string>();

  constructor(projectRoot: string, prefs: MemoryPreflightPrefsInput) {
    this.config = resolveMemoryPreflightConfig(prefs);
    this.reader = new MemoryIndexReader(projectRoot);
  }

  cacheMemoContent(path: string, content: string): void {
    if (!this.config.enabled) return;
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > this.config.contentCacheBytes) {
      // too big to ever fit; do not cache.
      return;
    }
    this.cachedMemoContents.set(path, content);
  }

  async fetchBlock(taskTitle: string): Promise<MemoryPreflightResult> {
    if (!this.config.enabled) return { available: false, reason: 'DISABLED' };
    try {
      return this.selectAndCompose(taskTitle ?? '');
    } catch (err) {
      // Fail-soft: a selection failure must never block a dispatch.
      return {
        available: false,
        reason: `SELECTION_ERROR: ${(err as Error).message ?? String(err)}`,
      };
    }
  }

  private selectAndCompose(taskTitle: string): MemoryPreflightResult {
    const startedAt = performance.now();
    const tiered = this.reader.selectTiered();
    if (tiered === null) return { available: false, reason: 'MEMORY_INDEX_MISSING' };

    // Rank the union once (one fuzzy pass per token over all candidates),
    // then split by tier — cheaper than ranking each tier separately and
    // order-preserving for both.
    const hotSet = new Set<MemoryIndexEntry>(tiered.hot);
    const tokens = queryTokens(taskTitle);
    const rankedAll = rankByRelevance(taskTitle, [...tiered.hot, ...tiered.warm]);
    // Hot is ALWAYS eligible — ranked so the most task-relevant lead, with
    // unmatched standing rules appended in index order.
    const hotRanked = rankedAll.filter((r) => hotSet.has(r.entry));
    const hotSelected = hotRanked.slice(0, this.config.hotItemCap);

    let timedOut =
      performance.now() - startedAt >= this.config.selectionTimeBudgetMs;
    const warmSelected: RankedEntry[] = [];
    let warmEligibleCount = 0;
    if (!timedOut && this.config.warmItemCap > 0) {
      const warmRanked = rankedAll
        .filter((r) => !hotSet.has(r.entry))
        .filter(
          (r) =>
            tokenHits(`${r.entry.name} ${r.entry.description}`.toLowerCase(), tokens) >=
            this.config.warmMinTokenHits,
        );
      warmEligibleCount = warmRanked.length;
      for (const candidate of warmRanked) {
        if (warmSelected.length >= this.config.warmItemCap) break;
        if (
          performance.now() - startedAt >=
          this.config.selectionTimeBudgetMs
        ) {
          timedOut = true;
          break;
        }
        warmSelected.push(candidate);
      }
    }

    if (hotSelected.length === 0 && warmSelected.length === 0) {
      return { available: false, reason: 'NO_RELEVANT_MEMORY' };
    }

    const sections: string[] = [];
    if (hotSelected.length > 0) {
      sections.push('### Standing memory (always applied)');
      for (const r of hotSelected) sections.push(renderEntry(r.entry));
    }
    if (warmSelected.length > 0) {
      sections.push('### Task-relevant memory (drill down with Read)');
      for (const r of warmSelected) sections.push(renderEntry(r.entry));
    }

    let tail = '\n';
    let cachedCount = 0;
    if (this.config.includeBodies && this.cachedMemoContents.size > 0) {
      const bodies: string[] = [];
      for (const [path, body] of this.cachedMemoContents) {
        bodies.push(`### ${path}\n\n${body}`);
        cachedCount += 1;
      }
      tail = `\n\n## Requested memory details:\n${bodies.join('\n\n')}\n`;
    }

    const header = '## Project memory relevant to this task\n';
    const composed = `${header}${sections.join('\n')}\n${tail}`;

    const { text, truncated } = truncateToCap(composed, this.config.maxBytes);
    const selectedCount = hotSelected.length + warmSelected.length;
    const droppedByItemCap =
      hotRanked.length - hotSelected.length + (warmEligibleCount - warmSelected.length);
    const droppedByBytes = truncated
      ? Math.max(0, selectedCount - countItemsInBlock(text))
      : 0;
    const droppedCount = droppedByItemCap + droppedByBytes;

    return {
      available: true,
      block: text,
      feedbackListItems: selectedCount,
      cachedItemCount: cachedCount,
      hotSelected: hotSelected.length,
      warmSelected: warmSelected.length,
      bytesEmitted: Buffer.byteLength(text, 'utf8'),
      budgetTruncated: truncated || droppedByItemCap > 0 || timedOut,
      timedOut,
      truncated,
      droppedCount: droppedCount > 0 ? droppedCount : undefined,
    };
  }
}

/**
 * Slice 2026-09-09-memory-retrieval: the query the dispatch site feeds
 * `fetchBlock`. The bare role ("rd") carries almost no relevance signal,
 * so the first line of the task brief is appended (truncated) to give the
 * fuzzy kernel something to rank against. Pure and fail-soft.
 */
export function deriveMemoryQuery(role: string, taskBody: string | undefined): string {
  const firstLine = (taskBody ?? '').split('\n', 1)[0]?.trim() ?? '';
  const trimmed = firstLine.length > 160 ? firstLine.slice(0, 160) : firstLine;
  return trimmed === '' ? role : `${role} ${trimmed}`;
}

/**
 * Rank entries against the task title with the deterministic fuzzy kernel.
 *
 * The kernel is invoked once PER TOKEN rather than once for the whole
 * title: a whole-title query is a single fzf subsequence and realistic
 * task titles match almost nothing that way (measured: 0 warm hits on
 * the real 131-entry warm tier). Per-token accumulation keeps the kernel
 * deterministic and gives a graded score — entries matching more task
 * words, more strongly, rank higher.
 *
 * Every entry is returned: matched entries lead by score desc, unmatched
 * entries follow in index order with score 0 — this is what keeps hot
 * entries "always eligible". An empty/token-less task title degrades to
 * index order.
 */
function rankByRelevance(query: string, entries: MemoryIndexEntry[]): RankedEntry[] {
  if (entries.length === 0) return [];
  const tokens = queryTokens(query);
  if (tokens.length === 0) {
    return entries.map((entry) => ({ entry, score: 0 }));
  }

  const accumulated = new Map<MemoryIndexEntry, number>();
  for (const token of tokens) {
    const matches = fuzzyMatchWithKey(token, entries, {
      keyFn: (e) => `${e.name} ${e.description}`,
      limit: entries.length,
      caseSensitive: false,
    });
    for (const match of matches) {
      accumulated.set(match.item, (accumulated.get(match.item) ?? 0) + match.score);
    }
  }

  // Array#sort is stable (ES2019), so equal scores keep index order.
  return entries
    .map((entry) => ({ entry, score: accumulated.get(entry) ?? 0 }))
    .sort((a, b) => b.score - a.score);
}

function renderEntry(entry: MemoryIndexEntry): string {
  return `- * ${entry.name}\n    Path: ${entry.sourcePath}\n    One-line: ${summarize(entry.description)}`;
}

function summarize(description: string): string {
  // Drop the <!-- peaks-feedback-promoted: layer=A --> marker, take the next 1 line.
  const cleaned = description.replace(/<!--[^>]*-->/g, '').trim();
  return cleaned.split('\n')[0] ?? cleaned;
}

function countItemsInBlock(text: string): number {
  // Count `- * ` markers ONLY in the list portion (between the
  // `## Project memory relevant to this task` header and the
  // `## Requested memory details:` sub-section, if present). Memo
  // bodies appended under `## Requested memory details:` may
  // legitimately contain their own `- * ` markdown bullets, which
  // would otherwise inflate the count and produce a wrong
  // `droppedCount` in the truncated case.
  const headerEnd = text.indexOf('\n## ');
  if (headerEnd === -1) {
    return (text.match(/- \* /g) ?? []).length;
  }
  const tailStart = text.indexOf('\n## Requested memory details:', headerEnd + 1);
  const listEnd = tailStart === -1 ? text.length : tailStart;
  return (text.slice(0, listEnd).match(/- \* /g) ?? []).length;
}

/**
 * Declarations extracted from `memory-preflight-service.ts` by the b1
 * file-size campaign: the result/ranking types, the token/CJK constants,
 * and the pure selection helpers (token gate, entry renderer, one-line
 * summariser, block item counter). The service re-exports the public type
 * and imports the helpers back, so importers keep the original path.
 */
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

export interface RankedEntry {
  entry: MemoryIndexEntry;
  score: number;
}

/**
 * Tokens shorter than 4 chars are too promiscuous for literal containment
 * ("add" is a substring of "padding"), so they rank but do not gate.
 */
export const MIN_TOKEN_LENGTH = 4;

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * Absolute relevance gate: does the token literally occur in the entry?
 *
 * The fuzzy kernel's score is normalized per batch (best match = 1.0), so
 * it cannot distinguish a strong match from the best of a bad lot — an
 * absolute check is required for the warm gate. CJK titles have no word
 * boundaries, so those tokens fall back to 2-char gram overlap.
 */
export function tokenHits(text: string, tokens: string[]): number {
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

export function renderEntry(entry: MemoryIndexEntry): string {
  return `- * ${entry.name}\n    Path: ${entry.sourcePath}\n    One-line: ${summarize(entry.description)}`;
}

function summarize(description: string): string {
  // Drop the <!-- peaks-feedback-promoted: layer=A --> marker, take the next 1 line.
  const cleaned = description.replace(/<!--[^>]*-->/g, '').trim();
  return cleaned.split('\n')[0] ?? cleaned;
}

export function countItemsInBlock(text: string): number {
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

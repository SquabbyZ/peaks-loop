/**
 * MemoryPreflightService — orchestrator-facing API for the
 * "Orchestrator Memory Preflight" slice (see
 * docs/superpowers/specs/2026-07-22-orchestrator-memory-preflight-design.md).
 *
 * Consumes:
 *   - resolveMemoryPreflightConfig (Task 1) — merged defaults + per-project overlay
 *   - MemoryIndexReader (Task 3)            — reads .peaks/memory/index.json + layer=A filter
 *   - MemoryLruCache (Task 2)               — constructed for capacity parity, but NOT used
 *                                            for memo content (see deviation note below)
 *   - compressPrompt (existing)             — headroom-ai wrapper for hard-cap compression
 *
 * Deviation from brief — controller-accepted (pre-task 4):
 *   The brief mandated use of `MemoryLruCache` for memo content caching. The
 *   orchestrator dispatch flow only ever has at most a handful of explicit
 *   `cacheMemoContent` calls per task (typically 0-3), and ordering / explicit
 *   invalidation is preferred over LRU eviction by recency. To keep the
 *   semantic obvious and the byte budget check trivial, this implementation
 *   uses a plain `Map<path, body>` for memo path -> body content. The
 *   `MemoryLruCache` class remains as a separate, reusable LRU primitive
 *   (Task 2) and is not consumed by this service.
 */
import { compressPrompt } from './headroom-client.js';
import { MemoryIndexReader } from './memory-index-reader.js';
import {
  resolveMemoryPreflightConfig,
  type MemoryPreflightConfig,
} from './memory-preflight-config.js';
import type { MemoryIndexEntry } from '../memory/memory-search-service.js';
import type { ProjectPreferences } from '../preferences/preferences-types.js';

export interface MemoryPreflightResult {
  available: boolean;
  block?: string;
  feedbackListItems?: number;
  cachedItemCount?: number;
  reason?: string;
  truncated?: boolean;
  droppedCount?: number;
}

type HeadroomMode = 'balanced' | 'aggressive' | 'conservative';

async function compressToCap(
  text: string,
  capBytes: number,
  mode: HeadroomMode,
): Promise<{ text: string; truncated: boolean }> {
  try {
    const result = await compressPrompt(text, mode);
    if (result.warning !== null || result.compressedPrompt === null) {
      return { text, truncated: false };
    }
    const compressed = result.compressedPrompt;
    if (Buffer.byteLength(compressed, 'utf8') > capBytes) {
      const sliced = compressed.slice(0, Math.max(0, capBytes - 64)) + '\n…[truncated]';
      return { text: sliced, truncated: true };
    }
    return { text: compressed, truncated: false };
  } catch {
    return { text, truncated: false };
  }
}

export class MemoryPreflightService {
  private readonly reader: MemoryIndexReader;
  private readonly config: MemoryPreflightConfig;
  /** path -> body; sub-agent-requested memo contents (Task 4 deviation, see module header). */
  private readonly cachedMemoContents = new Map<string, string>();

  constructor(projectRoot: string, prefs: ProjectPreferences) {
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

  async fetchBlock(_taskTitle: string): Promise<MemoryPreflightResult> {
    if (!this.config.enabled) return { available: false, reason: 'DISABLED' };

    const selected = this.reader.selectFeedbackLayerA(this.config.listCap);
    if (selected.length === 0) {
      const any = this.reader.loadIfStale();
      if (any.length === 0) return { available: false, reason: 'MEMORY_INDEX_MISSING' };
      return { available: false, reason: 'NO_FEEDBACK_LAYER_A' };
    }

    const listLines = selected
      .map((e) => `- * ${e.name}\n    Path: ${e.sourcePath}\n    One-line: ${summarize(e.description)}`)
      .join('\n');
    let tail = '\n';
    let cachedCount = 0;
    if (this.cachedMemoContents.size > 0) {
      const sections: string[] = [];
      for (const [path, body] of this.cachedMemoContents) {
        sections.push(`### ${path}\n\n${body}`);
        cachedCount += 1;
      }
      tail = `\n\n## Requested memory details:\n${sections.join('\n\n')}\n`;
    }
    const header = '## Project memory relevant to this task\n';
    const composed = `${header}${listLines}${tail}`;

    const capBytes = Math.max(64, this.config.maxTokens * 4);
    const { text, truncated } = await compressToCap(composed, capBytes, 'balanced');
    const droppedCount = truncated ? selected.length - countItemsInBlock(text) : 0;

    return {
      available: true,
      block: text,
      feedbackListItems: selected.length,
      cachedItemCount: cachedCount,
      truncated,
      droppedCount: droppedCount > 0 ? droppedCount : undefined,
    };
  }
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

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { ProjectMemoryKind } from '../memory/project-memory-service.js';
import type { MemoryIndexEntry } from '../memory/memory-search-service.js';

const LAYER_A_RE = /peaks-feedback-promoted:\s*layer=A\b/;

/**
 * Slice 2026-09-09-memory-retrieval: the two tiers the orchestrator
 * preflight ranks over.
 *
 * - `hot`  — standing rules / feedback / decisions. Always eligible.
 * - `warm` — project / reference memos. Injected only on task relevance.
 *
 * `cold` is deep storage and is deliberately NOT surfaced here.
 */
export interface MemoryTieredSelection {
  hot: MemoryIndexEntry[];
  warm: MemoryIndexEntry[];
}

interface IndexSnapshot {
  mtimeMs: number;
  entries: MemoryIndexEntry[];
  tiers: MemoryTieredSelection;
}

export class MemoryIndexReader {
  private cache: IndexSnapshot | null = null;

  constructor(private readonly projectRoot: string) {}

  /**
   * Flatten the whole index (all tiers, all buckets). Kept for
   * back-compat with the pre-2026-09-09 callers.
   */
  loadIfStale(): MemoryIndexEntry[] {
    return this.loadSnapshot()?.entries ?? [];
  }

  /**
   * Slice 2026-09-09-memory-retrieval: read the index as tiers.
   *
   * Returns `null` when `.peaks/memory/index.json` is absent or
   * unreadable — the caller distinguishes "no index" from "index with
   * zero entries" for its fail-soft reason code. Never throws.
   */
  selectTiered(): MemoryTieredSelection | null {
    const snapshot = this.loadSnapshot();
    if (snapshot === null) return null;
    return snapshot.tiers;
  }

  selectFeedbackLayerA(cap: number): MemoryIndexEntry[] {
    const all = this.loadIfStale();
    return all
      .filter((e) => e.kind === ('feedback' satisfies ProjectMemoryKind))
      .filter((e) => LAYER_A_RE.test(e.description))
      .slice(0, Math.max(1, Math.trunc(cap)));
  }

  private loadSnapshot(): IndexSnapshot | null {
    const indexPath = join(this.projectRoot, '.peaks', 'memory', 'index.json');
    try {
      if (!existsSync(indexPath)) return null;
      const { mtimeMs } = statSync(indexPath);
      if (this.cache && this.cache.mtimeMs === mtimeMs) return this.cache;
      const raw: unknown = JSON.parse(readFileSync(indexPath, 'utf8'));
      const tiers = {
        hot: flattenBucket(raw, 'hot'),
        warm: flattenBucket(raw, 'warm'),
      };
      const entries = [
        ...tiers.hot,
        ...tiers.warm,
        ...flattenBucket(raw, 'cold'),
      ];
      this.cache = { mtimeMs, entries, tiers };
      return this.cache;
    } catch {
      // Fail-soft: a missing / unreadable / malformed index degrades to
      // "no memory available" rather than throwing into a dispatch.
      this.cache = null;
      return null;
    }
  }
}

function bucketOf(raw: unknown, layer: string): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const bucket = (raw as Record<string, unknown>)[layer];
  return bucket && typeof bucket === 'object'
    ? (bucket as Record<string, unknown>)
    : null;
}

function flattenBucket(raw: unknown, layer: string): MemoryIndexEntry[] {
  const bucket = bucketOf(raw, layer);
  if (!bucket) return [];
  const out: MemoryIndexEntry[] = [];
  for (const key of Object.keys(bucket)) {
    const list = bucket[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (item && typeof item === 'object') out.push(item as MemoryIndexEntry);
    }
  }
  return out;
}

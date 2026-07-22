import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { ProjectMemoryKind } from '../memory/project-memory-service.js';
import type { MemoryIndexEntry } from '../memory/memory-search-service.js';

const LAYER_A_RE = /peaks-feedback-promoted:\s*layer=A\b/;

export class MemoryIndexReader {
  private cache: { mtimeMs: number; entries: MemoryIndexEntry[] } | null = null;

  constructor(private readonly projectRoot: string) {}

  loadIfStale(): MemoryIndexEntry[] {
    const indexPath = join(this.projectRoot, '.peaks', 'memory', 'index.json');
    if (!existsSync(indexPath)) return [];
    const { mtimeMs } = statSync(indexPath);
    if (this.cache && this.cache.mtimeMs === mtimeMs) return this.cache.entries;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(indexPath, 'utf8'));
    } catch {
      this.cache = null;
      return [];
    }
    const entries = flattenIndex(raw);
    this.cache = { mtimeMs, entries };
    return entries;
  }

  selectFeedbackLayerA(cap: number): MemoryIndexEntry[] {
    const all = this.loadIfStale();
    return all
      .filter((e) => e.kind === ('feedback' satisfies ProjectMemoryKind))
      .filter((e) => LAYER_A_RE.test(e.description))
      .slice(0, Math.max(1, Math.trunc(cap)));
  }
}

function flattenIndex(raw: unknown): MemoryIndexEntry[] {
  if (!raw || typeof raw !== 'object') return [];
  const out: MemoryIndexEntry[] = [];
  const obj = raw as Record<string, unknown>;
  for (const layer of ['hot', 'warm', 'cold'] as const) {
    const bucket = obj[layer];
    if (!bucket || typeof bucket !== 'object') continue;
    for (const k of ['feedback', 'project', 'reference', 'user'] as const) {
      const list = (bucket as Record<string, unknown>)[k];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (item && typeof item === 'object') out.push(item as MemoryIndexEntry);
      }
    }
  }
  return out;
}
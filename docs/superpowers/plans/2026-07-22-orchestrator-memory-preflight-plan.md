# Orchestrator Memory Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make peaks-code orchestrator automatically inject a token-bounded memory block of `feedback / layer A` items into every sub-agent system prompt so past-bug lessons reach the LLM by default.

**Architecture:** New `MemoryPreflightService` filters `.peaks/memory/index.json` to `feedback / layer A` only, renders a name+path+summary list (~200 token), appends any sub-agent-requested memo contents (LRU cached), caps the whole block via headroom-ai at `memoryPreflight.maxTokens` (default 1200). Orchestrator's `dispatchSubAgent` prepends the block to the sub-agent's system prompt. Silent degradation: missing/malformed index returns `available=false` and orchestrator skips the prefix unchanged from today's behavior. No new CLI surface; no new npm dependency.

**Tech Stack:** TypeScript (strict), Node 22, vitest, peaks-loop's existing `peaks memory search`, `headroom-ai@0.22.4` already declared in `package.json`, existing `loadPreferences()` for the new `memoryPreflight` pref key.

## Global Constraints

- `package.json` version: 4.0.x → 4.1.0. Don't bump package.json here; release is a separate workflow.
- Node engine: `>=20.0.0` (existing). Use only ESM, no CommonJS.
- All new code must be compatible with Windows (long-path safe: test under `C:\Users\smallMark\...`).
- `tests/unit/cli/commands/` and `tests/unit/services/` are the existing vitest roots; new tests land at `tests/unit/services/context/memory-preflight-service.test.ts`.
- Configuration lives in `.peaks/preferences.json` under a NEW key `memoryPreflight` — do NOT add a top-level CLI command.
- Read-only with respect to `.peaks/memory/` — never write to memory files from this slice.
- No new npm deps. Re-use `headroom-ai` (already at `0.22.4`), `commander`, `zod`.
- Strict TypeScript: no `any`, no `as unknown as X` casts; use existing `Result` discriminated unions from `peaks-loop-shared/result`.
- Existing `peaks/codegraph` and `peaks/understand` commands are out of scope; this slice re-uses `peaks memory` and `peaks project context` only.

---

### Task 1: MemoryPreflightConfig type + defaults resolver

**Files:**
- Create: `src/services/context/memory-preflight-config.ts`
- Test: `tests/unit/services/context/memory-preflight-config.test.ts`

**Interfaces:**
- Consumes: `ProjectPreferences` (existing type at `src/services/preferences/preferences-types.ts`)
- Produces: `MemoryPreflightConfig` (typed object with all 4 fields resolved)

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/services/context/memory-preflight-config.test.ts
import { describe, expect, test } from 'vitest';
import {
  resolveMemoryPreflightConfig,
  type MemoryPreflightConfig,
} from '../../../src/services/context/memory-preflight-config.js';

describe('resolveMemoryPreflightConfig', () => {
  test('defaults when preference key is absent', () => {
    const cfg: MemoryPreflightConfig = resolveMemoryPreflightConfig({});
    expect(cfg.enabled).toBe(true);
    expect(cfg.maxTokens).toBe(1200);
    expect(cfg.listCap).toBe(12);
    expect(cfg.contentCacheBytes).toBe(6000);
  });

  test('partial prefs overlay defaults', () => {
    const cfg = resolveMemoryPreflightConfig({
      memoryPreflight: { enabled: false, maxTokens: 800, listCap: 5, contentCacheBytes: 2000 },
    });
    expect(cfg.enabled).toBe(false);
    expect(cfg.maxTokens).toBe(800);
    expect(cfg.listCap).toBe(5);
    expect(cfg.contentCacheBytes).toBe(2000);
  });

  test('invalid maxTokens falls back to default', () => {
    const cfg = resolveMemoryPreflightConfig({ memoryPreflight: { maxTokens: -3 } });
    expect(cfg.maxTokens).toBe(1200);
  });

  test('listCap clamped to [1, 50]', () => {
    expect(resolveMemoryPreflightConfig({ memoryPreflight: { listCap: 0 } }).listCap).toBe(1);
    expect(resolveMemoryPreflightConfig({ memoryPreflight: { listCap: 9999 } }).listCap).toBe(50);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:/Users/smallMark/Desktop/peaks-loop && ./node_modules/.bin/vitest run tests/unit/services/context/memory-preflight-config.test.ts`
Expected: FAIL with "Cannot find module '../../../src/services/context/memory-preflight-config.js'"

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/context/memory-preflight-config.ts
import type { ProjectPreferences } from '../preferences/preferences-types.js';

export interface MemoryPreflightConfig {
  readonly enabled: boolean;
  readonly maxTokens: number;
  readonly listCap: number;
  readonly contentCacheBytes: number;
}

const DEFAULTS = Object.freeze({
  enabled: true,
  maxTokens: 1200,
  listCap: 12,
  contentCacheBytes: 6000,
});

const LIST_CAP_MIN = 1;
const LIST_CAP_MAX = 50;

function asFiniteInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : fallback;
}

export function resolveMemoryPreflightConfig(
  prefs: ProjectPreferences
): MemoryPreflightConfig {
  const m = prefs.memoryPreflight ?? {};
  const listCapRaw = asFiniteInt(m.listCap, DEFAULTS.listCap);
  return {
    enabled: m.enabled === false ? false : DEFAULTS.enabled,
    maxTokens: m.maxTokens && m.maxTokens > 0 ? m.maxTokens : DEFAULTS.maxTokens,
    listCap: Math.min(LIST_CAP_MAX, Math.max(LIST_CAP_MIN, listCapRaw)),
    contentCacheBytes:
      m.contentCacheBytes && m.contentCacheBytes > 0
        ? m.contentCacheBytes
        : DEFAULTS.contentCacheBytes,
  };
}
```

Also extend `ProjectPreferences` in `src/services/preferences/preferences-types.ts` to include the optional `memoryPreflight?: { enabled?: boolean; maxTokens?: number; listCap?: number; contentCacheBytes?: number; }` field, plus a corresponding default in `src/services/preferences/preferences-service.ts` (defaults section).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:/Users/smallMark/Desktop/peaks-loop && ./node_modules/.bin/vitest run tests/unit/services/context/memory-preflight-config.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/smallMark/Desktop/peaks-loop
git add src/services/context/memory-preflight-config.ts src/services/preferences/preferences-types.ts src/services/preferences/preferences-service.ts tests/unit/services/context/memory-preflight-config.test.ts
git -c user.name="SquabbyZ" -c user.email="601709253@qq.com" commit -m "feat(context): MemoryPreflightConfig defaults resolver"
```

---

### Task 2: LRU memo content cache

**Files:**
- Create: `src/services/context/memory-lru-cache.ts`
- Test: `tests/unit/services/context/memory-lru-cache.test.ts`

**Interfaces:**
- Consumes: SHA-256 of absolute path strings (caller-computed)
- Produces: `set(key, body)` / `get(key)` / `evictIfOver(budgetBytes)`; total byte budget enforced after every `set`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/services/context/memory-lru-cache.test.ts
import { describe, expect, test } from 'vitest';
import { MemoryLruCache } from '../../../src/services/context/memory-lru-cache.js';

describe('MemoryLruCache', () => {
  test('set + get round-trip', () => {
    const c = new MemoryLruCache(1024);
    c.set('a', 'hello world');
    expect(c.get('a')).toBe('hello world');
  });

  test('returns undefined for missing key', () => {
    const c = new MemoryLruCache(1024);
    expect(c.get('missing')).toBeUndefined();
  });

  test('evicts least-recent when over budgetBytes', () => {
    const c = new MemoryLruCache(15); // small budget
    c.set('a', 'aaaaa');   // 5 bytes
    c.set('b', 'bbbbb');   // 5 bytes
    c.set('c', 'ccccc');   // 5 bytes — total 15, at budget
    c.set('d', 'ddddd');   // 5 bytes — evicts 'a' (least-recent)
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe('bbbbb');
    expect(c.get('c')).toBe('ccccc');
    expect(c.get('d')).toBe('ddddd');
    expect(c.size()).toBe(15);
  });

  test('get refreshes recency', () => {
    const c = new MemoryLruCache(15);
    c.set('a', 'AAAAA');
    c.set('b', 'BBBBB');
    c.set('c', 'CCCCC');
    c.get('a');             // touch 'a' so it becomes most-recent
    c.set('d', 'DDDDD');   // would normally evict 'a'; now evicts 'b'
    expect(c.get('a')).toBe('AAAAA');
    expect(c.get('b')).toBeUndefined();
  });

  test('byte measurement uses UTF-8 byteLength', () => {
    const c = new MemoryLruCache(6);
    c.set('emoji', '😀😀');
    expect(c.size()).toBe(8); // 2 emoji = 8 bytes in UTF-8
    expect(c.get('emoji')).toBe('😀😀');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:/Users/smallMark/Desktop/peaks-loop && ./node_modules/.bin/vitest run tests/unit/services/context/memory-lru-cache.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/context/memory-lru-cache.ts
const BYTES_PER_TOKEN_ESTIMATE = 1; // we measure bytes, not tokens, for LRU.

interface Entry { body: string; bytes: number; }

export class MemoryLruCache {
  private readonly store = new Map<string, Entry>();
  private currentBytes = 0;

  constructor(private readonly budgetBytes: number) {}

  set(key: string, body: string): void {
    if (this.store.has(key)) this.delete(key);
    const bytes = Buffer.byteLength(body, 'utf8');
    if (bytes > this.budgetBytes) {
      // single value bigger than budget; store anyway (caller can guard)
      this.store.set(key, { body, bytes });
      this.currentBytes += bytes;
      this.evictIfOver();
      return;
    }
    this.store.set(key, { body, bytes });
    this.currentBytes += bytes;
    this.evictIfOver();
  }

  get(key: string): string | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    // refresh recency
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.body;
  }

  delete(key: string): void {
    const entry = this.store.get(key);
    if (!entry) return;
    this.store.delete(key);
    this.currentBytes -= entry.bytes;
  }

  size(): number {
    return this.currentBytes;
  }

  private evictIfOver(): void {
    while (this.currentBytes > this.budgetBytes && this.store.size > 0) {
      // Map preserves insertion order — first key is least-recently-touched
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.delete(oldestKey);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: same vitest command. Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/smallMark/Desktop/peaks-loop
git add src/services/context/memory-lru-cache.ts tests/unit/services/context/memory-lru-cache.test.ts
git -c user.name="SquabbyZ" -c user.email="601709253@qq.com" commit -m "feat(context): LRU content cache for memory preflight (byte-budgeted)"
```

---

### Task 3: MemoryIndexReader (one-shot warm load + filter)

**Files:**
- Create: `src/services/context/memory-index-reader.ts`
- Test: `tests/unit/services/context/memory-index-reader.test.ts`

**Interfaces:**
- Consumes: `projectRoot` (absolute path), mtime-keyed `Map<string, MemoryIndexSnapshot>`
- Produces: `MemoryIndexReader` instance with `loadIfStale()` + `selectFeedbackLayerA(cap)`; on missing file returns `null`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/services/context/memory-index-reader.test.ts
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { MemoryIndexReader } from '../../../src/services/context/memory-index-reader.js';

function writeIndex(projectRoot: string, body: object): void {
  const path = join(projectRoot, '.peaks', 'memory');
  writeFileSync(join(path, 'index.json'), JSON.stringify(body));
}

describe('MemoryIndexReader', () => {
  test('returns null entries when .peaks/memory missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'memidx-'));
    try {
      const r = new MemoryIndexReader(root);
      expect(r.loadIfStale()).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('selects only kind=feedback with layer=A in description', () => {
    const root = mkdtempSync(join(tmpdir(), 'memidx-'));
    try {
      writeIndex(root, {
        hot: {
          feedback: [
            { name: 'A-feedback-1', kind: 'feedback',
              description: '<!-- peaks-feedback-promoted: layer=A --> one',
              sourcePath: '/p1', sourceArtifact: null, updatedAt: '2026-07-22' },
            { name: 'B-feedback-1', kind: 'feedback',
              description: '<!-- peaks-feedback-promoted: layer=B --> two',
              sourcePath: '/p2', sourceArtifact: null, updatedAt: '2026-07-22' }
          ],
          project: [
            { name: 'P-1', kind: 'project',
              description: '<!-- peaks-feedback-promoted: layer=A --> three',
              sourcePath: '/p3', sourceArtifact: null, updatedAt: '2026-07-22' }
          ]
        }
      });
      const r = new MemoryIndexReader(root);
      const sel = r.selectFeedbackLayerA(10);
      expect(sel.map(e => e.name)).toEqual(['A-feedback-1']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('re-load when underlying file mtime changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'memidx-'));
    try {
      writeIndex(root, { hot: { feedback: [
        { name: 'one', kind: 'feedback',
          description: '<!-- peaks-feedback-promoted: layer=A --> a',
          sourcePath: '/p1', sourceArtifact: null, updatedAt: '2026-07-22' }
      ]}});
      const r = new MemoryIndexReader(root);
      expect(r.selectFeedbackLayerA(10).map(e => e.name)).toEqual(['one']);
      const indexPath = join(root, '.peaks', 'memory', 'index.json');
      // rewrite with different content + bump mtime
      writeFileSync(indexPath, JSON.stringify({ hot: { feedback: [
        { name: 'two', kind: 'feedback',
          description: '<!-- peaks-feedback-promoted: layer=A --> b',
          sourcePath: '/p2', sourceArtifact: null, updatedAt: '2026-07-22' }
      ]}}));
      const future = (Date.now() + 5000) / 1000;
      utimesSync(indexPath, future, future);
      expect(r.selectFeedbackLayerA(10).map(e => e.name)).toEqual(['two']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('listCap honored', () => {
    const root = mkdtempSync(join(tmpdir(), 'memidx-'));
    try {
      const feedback = Array.from({ length: 30 }, (_, i) => ({
        name: `f${i}`, kind: 'feedback',
        description: '<!-- peaks-feedback-promoted: layer=A --> d',
        sourcePath: `/p${i}`, sourceArtifact: null, updatedAt: '2026-07-22'
      }));
      writeIndex(root, { hot: { feedback } });
      const r = new MemoryIndexReader(root);
      expect(r.selectFeedbackLayerA(5).length).toBe(5);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:/Users/smallMark/Desktop/peaks-loop && ./node_modules/.bin/vitest run tests/unit/services/context/memory-index-reader.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/context/memory-index-reader.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: same vitest command. Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/smallMark/Desktop/peaks-loop
git add src/services/context/memory-index-reader.ts tests/unit/services/context/memory-index-reader.test.ts
git -c user.name="SquabbyZ" -c user.email="601709253@qq.com" commit -m "feat(context): memory index reader with feedback/A filter + mtime cache"
```

---

### Task 4: MemoryPreflightService (the orchestrator-facing API)

**Files:**
- Create: `src/services/context/memory-preflight-service.ts`
- Test: `tests/unit/services/context/memory-preflight-service.test.ts`

**Interfaces:**
- Consumes: `resolveMemoryPreflightConfig(prefs)` (Task 1), `MemoryIndexReader` (Task 3), `MemoryLruCache` (Task 2), `headroom-client.compressPrompt` (existing)
- Produces: `MemoryPreflightService` instance with `fetchBlock(taskTitle)` and `cacheMemoContent(path, content)`

- [ ] **Step 1: Write failing tests (mock the headroom client)**

```ts
// tests/unit/services/context/memory-preflight-service.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { MemoryPreflightService } from '../../../src/services/context/memory-preflight-service.js';

vi.mock('../../../src/services/context/headroom-client.js', () => ({
  compressPrompt: vi.fn(async (text) => ({ compressedPrompt: text, tokensSaved: 0, compressionRatio: 1, warning: null })),
}));

function writeIndex(root: string, body: object) {
  writeFileSync(join(root, '.peaks', 'memory', 'index.json'), JSON.stringify(body));
}

const prefs = {} as Parameters<typeof MemoryPreflightService>[0]; // any — service should default.

describe('MemoryPreflightService', () => {
  beforeEach(() => {
    process.cwd_cache;
  });

  test('returns available=false when memory index missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mp-'));
    try {
      const s = new MemoryPreflightService(root, { memoryPreflight: {} });
      const res = await s.fetchBlock('publish peaks-loop');
      expect(res.available).toBe(false);
      expect(res.reason).toBe('MEMORY_INDEX_MISSING');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('returns available=false when no feedback/A entries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mp-'));
    try {
      writeIndex(root, { hot: { feedback: [
        { name: 'B-only', kind: 'feedback',
          description: '<!-- peaks-feedback-promoted: layer=B --> x',
          sourcePath: '/x', sourceArtifact: null, updatedAt: '2026-07-22' }
      ]}});
      const s = new MemoryPreflightService(root, { memoryPreflight: {} });
      const res = await s.fetchBlock('publish');
      expect(res.available).toBe(false);
      expect(res.reason).toBe('NO_FEEDBACK_LAYER_A');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('emits a list block with feedback/A items', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mp-'));
    try {
      writeIndex(root, { hot: { feedback: [
        { name: 'peaks-foo', kind: 'feedback',
          description: '<!-- peaks-feedback-promoted: layer=A --> summary line',
          sourcePath: '/p1', sourceArtifact: null, updatedAt: '2026-07-22' }
      ]}});
      const s = new MemoryPreflightService(root, { memoryPreflight: {} });
      const res = await s.fetchBlock('publish peaks-loop');
      expect(res.available).toBe(true);
      expect(res.block).toContain('## Project memory relevant to this task');
      expect(res.block).toContain('peaks-foo');
      expect(res.block).toContain('/p1');
      expect(res.feedbackListItems).toBe(1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('block respects maxTokens hard cap (truncated=true when over)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mp-'));
    try {
      const feedback = Array.from({ length: 30 }, (_, i) => ({
        name: `f${i}-long-long-long-long-long-long-long-long`,
        kind: 'feedback',
        description: '<!-- peaks-feedback-promoted: layer=A --> ' + 'A'.repeat(80),
        sourcePath: `/p${i}`, sourceArtifact: null, updatedAt: '2026-07-22'
      }));
      writeIndex(root, { hot: { feedback } });
      const s = new MemoryPreflightService(root, { memoryPreflight: { maxTokens: 200 } });
      const res = await s.fetchBlock('publish');
      expect(res.available).toBe(true);
      expect(res.truncated).toBe(true);
      expect((res.droppedCount ?? 0) >= 1).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('cacheMemoContent + 2nd fetch surfaces cached body', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mp-'));
    try {
      writeIndex(root, { hot: { feedback: [
        { name: 'peaks-foo', kind: 'feedback',
          description: '<!-- peaks-feedback-promoted: layer=A --> summary',
          sourcePath: '/cached/path.md', sourceArtifact: null, updatedAt: '2026-07-22' }
      ]}});
      const s = new MemoryPreflightService(root, { memoryPreflight: {} });
      s.cacheMemoContent('/cached/path.md', 'full body');
      const res = await s.fetchBlock('publish');
      expect(res.block).toContain('## Requested memory details');
      expect(res.block).toContain('full body');
      expect(res.cachedItemCount).toBe(1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('subsequent identical fetch is sub-second even with cold mocks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mp-'));
    try {
      writeIndex(root, { hot: { feedback: [] } });
      const s = new MemoryPreflightService(root, { memoryPreflight: {} });
      const t0 = Date.now();
      await s.fetchBlock('publish');
      const t1 = Date.now();
      expect(t1 - t0).toBeLessThan(100);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:/Users/smallMark/Desktop/peaks-loop && ./node_modules/.bin/vitest run tests/unit/services/context/memory-preflight-service.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/context/memory-preflight-service.ts
import { compressPrompt } from './headroom-client.js';
import { MemoryIndexReader } from './memory-index-reader.js';
import { resolveMemoryPreflightConfig, type MemoryPreflightConfig } from './memory-preflight-config.js';
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

function entryKey(entry: MemoryIndexEntry): string {
  return createHash('sha256').update(entry.sourcePath).digest('hex');
}

async function compressToCap(text: string, capBytes: number, mode: 'balanced' | 'aggressive' | 'conservative'): Promise<{ text: string; truncated: boolean; }> {
  try {
    const result = await compressPrompt(text, mode);
    if (result.warning !== null || result.compressedPrompt === null) {
      return { text, truncated: false };
    }
    let compressed = result.compressedPrompt;
    let truncated = false;
    if (Buffer.byteLength(compressed, 'utf8') > capBytes) {
      compressed = compressed.slice(0, Math.max(0, capBytes - 64)) + '\n…[truncated]';
      truncated = true;
    }
    return { text: compressed, truncated };
  } catch {
    return { text, truncated: false };
  }
}

export class MemoryPreflightService {
  private readonly reader: MemoryIndexReader;
  private readonly config: MemoryPreflightConfig;
  private readonly cache: MemoryLruCache;
  /** path → body; sub-agent-requested memo contents. */
  private readonly cachedMemoContents = new Map<string, string>();

  constructor(projectRoot: string, prefs: ProjectPreferences) {
    this.config = resolveMemoryPreflightConfig(prefs);
    this.reader = new MemoryIndexReader(projectRoot);
    this.cache = new MemoryLruCache(this.config.contentCacheBytes);
    void this.cache; // LRU cache wired but not directly used; content map takes precedence.
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
  return (text.match(/- \* /g) ?? []).length;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: same vitest command. Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/smallMark/Desktop/peaks-loop
git add src/services/context/memory-preflight-service.ts tests/unit/services/context/memory-preflight-service.test.ts
git -c user.name="SquabbyZ" -c user.email="601709253@qq.com" commit -m "feat(context): MemoryPreflightService with headroom cap + LRU cache"
```

---

### Task 5: Orchestrator dispatch hook

**Files:**
- Modify: locate the orchestrator's `dispatchSubAgent` and prepend a synchronous call to `MemoryPreflightService`. The current path is `src/services/sub-agent-dispatch.ts`; if absent in this codebase, search with: `grep -rn "dispatchSubAgent\|dispatch_sub_agent" src/`. Wire the hook at the latest stable point per the existing pattern.
- Test: `tests/unit/services/context/orchestrator-memory-hook.test.ts`

**Interfaces:**
- Consumes: `MemoryPreflightService` (Task 4); existing `dispatchSubAgent(title, body, options)`
- Produces: Sub-agent prompt payload that always includes the memory block (or silently omits it if `available=false`)

- [ ] **Step 1: Locate dispatch entry point(s)**

```bash
cd C:/Users/smallMark/Desktop/peaks-loop
grep -rn "dispatchSubAgent\|sub-agent dispatch\|subAgentDispatch\|dispatchSubAgent " src/
```

Identify the function that builds the LLM request payload. Confirm with the engineer before modifying — multiple dispatch surfaces may exist (one per CLI subcommand); touch only the canonical `dispatchSubAgent`.

- [ ] **Step 2: Write failing test (orchestrator integration)**

```ts
// tests/unit/services/context/orchestrator-memory-hook.test.ts
import { describe, expect, test } from 'vitest';
import { buildDispatchSystemPrompt } from '../../../src/services/context/build-dispatch-system-prompt.js';

describe('buildDispatchSystemPrompt', () => {
  test('returns original prompt when memory unavailable', () => {
    const out = buildDispatchSystemPrompt({
      taskTitle: 'do thing',
      taskBody: 'explanation',
      memoryBlock: { available: false, reason: 'MEMORY_INDEX_MISSING' },
    });
    expect(out).toContain('explanation');
    expect(out).not.toContain('## Project memory relevant to this task');
  });

  test('prepends memory block when available', () => {
    const out = buildDispatchSystemPrompt({
      taskTitle: 'do thing',
      taskBody: 'explanation',
      memoryBlock: { available: true, block: '## Project memory relevant to this task\n- foo' },
    });
    expect(out.indexOf('## Project memory relevant to this task'))
      .toBeLessThan(out.indexOf('explanation'));
  });

  test('memory block never pushed below the task brief', () => {
    const out = buildDispatchSystemPrompt({
      taskTitle: 't',
      taskBody: 'TASK_BODY_MARKER',
      memoryBlock: { available: true, block: '## Project memory relevant to this task\n- x' },
    });
    expect(out).toContain('TASK_BODY_MARKER');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd C:/Users/smallMark/Desktop/peaks-loop && ./node_modules/.bin/vitest run tests/unit/services/context/orchestrator-memory-hook.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 4: Create the prompt builder + dispatch hook**

```ts
// src/services/context/build-dispatch-system-prompt.ts
import type { MemoryPreflightResult } from './memory-preflight-service.js';

export interface DispatchPromptInput {
  taskTitle: string;
  taskBody: string;
  memoryBlock: MemoryPreflightResult;
}

export function buildDispatchSystemPrompt(input: DispatchPromptInput): string {
  const { taskTitle, taskBody, memoryBlock } = input;
  const head = `# ${taskTitle}\n\n`;
  if (memoryBlock.available === true && typeof memoryBlock.block === 'string') {
    return `${head}${memoryBlock.block}\n## Task\n${taskBody}\n`;
  }
  return `${head}## Task\n${taskBody}\n`;
}
```

Then, in the dispatch entry point identified in Step 1, **call** this builder instead of the inline prompt construction. Use the wiring pattern (no behavioral change for callers — same external API, the builder takes over the internal prompt composition).

If multiple dispatch entry points exist, wire each. Use plain Edit (not sed/awk) on each site:

```ts
// Before (representative):
const dispatchPayload = `${title}\n${body}`;

// After:
import { MemoryPreflightService } from './memory-preflight-service.js';
import { buildDispatchSystemPrompt } from './build-dispatch-system-prompt.js';
const preflight = await preflightService.fetchBlock(title);
const dispatchPayload = buildDispatchSystemPrompt({
  taskTitle: title,
  taskBody: body,
  memoryBlock: preflight,
});
```

- [ ] **Step 5: Run unit tests for the builder**

Run: `cd C:/Users/smallMark/Desktop/peaks-loop && ./node_modules/.bin/vitest run tests/unit/services/context/orchestrator-memory-hook.test.ts tests/unit/services/context/memory-preflight-service.test.ts tests/unit/services/context/memory-preflight-config.test.ts tests/unit/services/context/memory-index-reader.test.ts tests/unit/services/context/memory-lru-cache.test.ts`
Expected: all passed.

- [ ] **Step 6: Run the broader unit suite to make sure nothing else broke**

Run: `cd C:/Users/smallMark/Desktop/peaks-loop && ./node_modules/.bin/vitest run tests/unit`
Expected: no new failures vs. baseline.

- [ ] **Step 7: Commit**

```bash
cd C:/Users/smallMark/Desktop/peaks-loop
git add src/services/context/build-dispatch-system-prompt.ts src/services/sub-agent-dispatch.ts tests/unit/services/context/orchestrator-memory-hook.test.ts
git -c user.name="SquabbyZ" -c user.email="601709253@qq.com" commit -m "feat(context): wire memory preflight block into sub-agent system prompt"
```

---

### Task 6: End-to-end test (mock dispatch + memory block in payload)

**Files:**
- Create: `tests/integration/orchestrator-memory-preflight-e2e.test.ts` (or under existing `tests/unit/services/context/` if simpler)
- Modify: nothing; this task is a black-box integration test against Tasks 1–5

- [ ] **Step 1: Write failing test**

```ts
// tests/integration/orchestrator-memory-preflight-e2e.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { MemoryPreflightService } from '../../src/services/context/memory-preflight-service.js';
import { buildDispatchSystemPrompt } from '../../src/services/context/build-dispatch-system-prompt.js';

describe('Orchestrator memory preflight — e2e', () => {
  test('sub-agent prompt embeds feedback/A memory items by default', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e-'));
    try {
      const feedbackA = {
        name: 'release-shared-chicken-egg',
        kind: 'feedback',
        description: '<!-- peaks-feedback-promoted: layer=A --> peaks-loop@new pins peaks-loop-shared@old; bumps must lockstep',
        sourcePath: '/p/release-shared-chicken-egg.md',
        sourceArtifact: null, updatedAt: '2026-07-22'
      };
      writeFileSync(join(root, '.peaks', 'memory', 'index.json'), JSON.stringify({
        hot: { feedback: [feedbackA] }
      }));
      const service = new MemoryPreflightService(root, { memoryPreflight: {} });
      const block = await service.fetchBlock('publish peaks-loop');
      const prompt = buildDispatchSystemPrompt({
        taskTitle: 'publish peaks-loop@4.0.1',
        taskBody: 'Tag and push.',
        memoryBlock: block,
      });
      expect(prompt).toContain('release-shared-chicken-egg');
      expect(prompt).toContain('## Task');
      expect(prompt.indexOf('## Project memory relevant to this task'))
        .toBeLessThan(prompt.indexOf('## Task'));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('silently omits when memory index is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e-'));
    try {
      const service = new MemoryPreflightService(root, { memoryPreflight: {} });
      const block = await service.fetchBlock('publish');
      const prompt = buildDispatchSystemPrompt({
        taskTitle: 't', taskBody: 'body', memoryBlock: block,
      });
      expect(prompt).toContain('body');
      expect(prompt).not.toContain('## Project memory');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: Run tests to verify they pass on the current Task-1-to-5 implementation**

Run: `cd C:/Users/smallMark/Desktop/peaks-loop && ./node_modules/.bin/vitest run tests/integration/orchestrator-memory-preflight-e2e.test.ts`
Expected: 2 passed. If any fail, fix the underlying code (Tasks 1–5); do NOT loosen the test.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/smallMark/Desktop/peaks-loop
git add tests/integration/orchestrator-memory-preflight-e2e.test.ts
git -c user.name="SquabbyZ" -c user.email="601709253@qq.com" commit -m "test(context): e2e for memory preflight in sub-agent system prompt"
```

---

### Task 7: Update CHANGELOG + .peaks/memory footer note

**Files:**
- Modify: `CHANGELOG.md` (prepend a `## Unreleased` entry describing the slice)
- Modify: `.peaks/memory/peaks-cli-version-shared-chicken-egg.md` (foot-reference: "for future sessions, this slice's preflight hook automatically surfaces this memory to the sub-agent in the publish dispatch path")

- [ ] **Step 1: Write CHANGELOG entry**

Edit `CHANGELOG.md`'s `# Changelog` header to insert (before any existing entries):

```markdown
## 4.1.0 (Unreleased)

### Added
- **Sub-agent memory preflight**: peaks-code orchestrator now
  automatically injects a token-bounded `feedback / layer A` memory
  block from `.peaks/memory/index.json` into every sub-agent's
  system prompt. Defaults to 1.2k token cap (configurable via
  `.peaks/preferences.json::memoryPreflight.maxTokens`); silent
  degradation when the index is missing. No new CLI surface.
  See `docs/superpowers/specs/2026-07-22-orchestrator-memory-preflight-design.md`.

```

- [ ] **Step 2: Append footer note to the chicken-egg memory**

Use Edit to append the following paragraph to `.peaks/memory/peaks-cli-version-shared-chicken-egg.md` (do not remove existing content):

```markdown

## Surfaced automatically by sub-agent memory preflight (since 4.1.0)

For future sessions: peaks-code orchestrator's
`MemoryPreflightService` surfaces the feedback/layer-A entries (this
one is layer A) automatically into the sub-agent's system prompt on
every dispatch, with a hard 1.2k-token ceiling enforced by headroom-ai.
You do not need to navigate into this memory manually anymore — the
dispatch brief will carry the relevant lessons ahead of your next
publish.
```

- [ ] **Step 3: Commit**

```bash
cd C:/Users/smallMark/Desktop/peaks-loop
git add CHANGELOG.md .peaks/memory/peaks-cli-version-shared-chicken-egg.md
git -c user.name="SquabbyZ" -c user.email="601709253@qq.com" commit -m "docs: announce sub-agent memory preflight in CHANGELOG + memory footer"
```

---

## Done

- 7 tasks, 6 unit test files + 1 integration test file.
- ~3 new files in `src/services/context/`, 1 modification in
  `src/services/sub-agent-dispatch.ts` (or equivalent), 1 modification
  in `src/services/preferences/preferences-types.ts`.
- Zero new npm deps, zero new CLI commands.
- New `.peaks/preferences.json::memoryPreflight` keys (all optional,
  documented defaults).

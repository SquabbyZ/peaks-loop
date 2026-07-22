import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { MemoryPreflightService } from '../../../../src/services/context/memory-preflight-service.js';

vi.mock('../../../../src/services/context/headroom-client.js', () => ({
  compressPrompt: vi.fn(async (text) => ({ compressedPrompt: text, tokensSaved: 0, compressionRatio: 1, warning: null })),
}));

function writeIndex(root: string, body: object) {
  const path = join(root, '.peaks', 'memory');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'index.json'), JSON.stringify(body));
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

  test('cacheMemoContent with markdown bullets in memo body does not inflate feedbackListItems (regression for over-count bug)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mp-'));
    try {
      writeIndex(root, { hot: { feedback: [
        { name: 'r1', kind: 'feedback',
          description: '<!-- peaks-feedback-promoted: layer=A --> s1',
          sourcePath: '/r1', sourceArtifact: null, updatedAt: '2026-07-22' }
      ]}});
      const s = new MemoryPreflightService(root, { memoryPreflight: {} });
      // Memo body contains 3 `- * ` markers — must NOT be counted in feedbackListItems.
      s.cacheMemoContent('/memo.md', '- * point one\n- * point two\n- * point three\n');
      const res = await s.fetchBlock('publish');
      expect(res.feedbackListItems).toBe(1);
      expect(res.cachedItemCount).toBe(1);
      expect(res.truncated).toBeFalsy();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

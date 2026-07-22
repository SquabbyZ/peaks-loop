import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { MemoryIndexReader } from '../../../../src/services/context/memory-index-reader.js';

function writeIndex(projectRoot: string, body: object): void {
  const path = join(projectRoot, '.peaks', 'memory');
  mkdirSync(path, { recursive: true });
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
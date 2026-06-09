import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRetrospectiveIndex } from '../../../../src/services/retrospective/retrospective-index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `peaks-retro-idx-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

function writeIndex(entries: unknown): void {
  const peaksDir = join(tmpDir, '.peaks', 'retrospective');
  mkdirSync(peaksDir, { recursive: true });
  writeFileSync(join(peaksDir, 'index.json'), JSON.stringify({ version: 1, updatedAt: '2026-06-09T00:00:00Z', entries }, null, 2));
}

function makeEntry(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: '2026-06-04-workspace-reconcile',
    sessionId: '2026-06-04-session-89f7cb',
    sliceId: '001-2026-06-04-workspace-reconcile',
    type: 'feature',
    title: 'Workspace reconcile',
    summary: 'Adds the new CLI command.',
    outcome: 'shipped',
    keyDecisions: ['Use 4-tier heuristic', 'Idempotent re-run'],
    lessonsLearned: 2,
    artifactPaths: ['.peaks/retrospective/2026-06-04-workspace-reconcile/rd/tech-doc.md'],
    updatedAt: '2026-06-04T12:00:00.000Z',
    ...overrides
  };
}

describe('loadRetrospectiveIndex', () => {
  test('returns 88 entries from fixture (TC-INDEX-1)', () => {
    const entries = Array.from({ length: 88 }, (_, i) => makeEntry({ id: `entry-${String(i).padStart(3, '0')}`, updatedAt: new Date(2026, 0, 1, 0, 0, i).toISOString() }));
    writeIndex(entries);
    const result = loadRetrospectiveIndex(tmpDir);
    expect(result.entries).toHaveLength(88);
    expect(result.source).toBe('index.json');
    expect(result.totalCount).toBe(88);
    expect(result.warning).toBeNull();
  });

  test('entries have exactly the 11 required fields (TC-INDEX-2 schema)', () => {
    writeIndex([makeEntry()]);
    const result = loadRetrospectiveIndex(tmpDir);
    const entry = result.entries[0];
    expect(entry).toBeDefined();
    const keys = Object.keys(entry as object).sort();
    expect(keys).toEqual([
      'artifactPaths', 'id', 'keyDecisions', 'lessonsLearned', 'outcome',
      'sessionId', 'sliceId', 'summary', 'title', 'type', 'updatedAt'
    ]);
  });

  test('each entry is ≤ 600 bytes (TC-INDEX-3)', () => {
    const entries = Array.from({ length: 88 }, (_, i) => makeEntry({ id: `entry-${String(i).padStart(3, '0')}` }));
    writeIndex(entries);
    const result = loadRetrospectiveIndex(tmpDir);
    for (const entry of result.entries) {
      expect(Buffer.byteLength(JSON.stringify(entry), 'utf8')).toBeLessThanOrEqual(600);
    }
  });

  test('entries are sorted by updatedAt desc (TC-INDEX-4)', () => {
    const entries = [
      makeEntry({ id: 'a', updatedAt: '2026-06-01T00:00:00.000Z' }),
      makeEntry({ id: 'b', updatedAt: '2026-06-09T00:00:00.000Z' }),
      makeEntry({ id: 'c', updatedAt: '2026-06-05T00:00:00.000Z' })
    ];
    writeIndex(entries);
    const result = loadRetrospectiveIndex(tmpDir);
    expect(result.entries.map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });

  test('missing index returns empty + warning, NOT crash (TC-INDEX-5)', () => {
    const result = loadRetrospectiveIndex(tmpDir);
    expect(result.entries).toEqual([]);
    expect(result.source).toBeNull();
    expect(result.warning).toBeTruthy();
  });

  test('malformed JSON returns empty + warning', () => {
    mkdirSync(join(tmpDir, '.peaks', 'retrospective'), { recursive: true });
    writeFileSync(join(tmpDir, '.peaks', 'retrospective', 'index.json'), 'not json{');
    const result = loadRetrospectiveIndex(tmpDir);
    expect(result.entries).toEqual([]);
    expect(result.warning).toBeTruthy();
  });

  test('entries with wrong types are filtered out', () => {
    writeIndex([
      makeEntry(),
      { id: 'bad', sessionId: 'x', type: 'unknown', title: 't', summary: 's', outcome: 'shipped', keyDecisions: [], lessonsLearned: 0, artifactPaths: [], updatedAt: '2026-06-01' },
      null,
      'not an object'
    ]);
    const result = loadRetrospectiveIndex(tmpDir);
    expect(result.entries).toHaveLength(1);
  });
});

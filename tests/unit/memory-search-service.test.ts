import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { searchMemory, loadMemoryIndex, type ProjectMemoryKind } from '../../src/services/memory/memory-search-service.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `peaks-mem-idx-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

function writeIndex(payload: unknown): void {
  const peaksDir = join(tmpDir, '.peaks', 'memory');
  mkdirSync(peaksDir, { recursive: true });
  writeFileSync(join(peaksDir, 'index.json'), JSON.stringify(payload));
}

const SAMPLE = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'memory-index-sample.json'), 'utf8')
);

describe('loadMemoryIndex', () => {
  test('reads the on-disk index.json and returns indexPath + entries', () => {
    writeIndex(SAMPLE);
    const result = loadMemoryIndex(tmpDir);
    expect(result.indexPath).toBe(join(tmpDir, '.peaks', 'memory', 'index.json'));
    expect(result.version).toBe(1);
    expect(result.entries).toHaveLength(5);
  });

  test('flattens hot[<kind>][] and cold[] into a single entries array', () => {
    writeIndex(SAMPLE);
    const result = loadMemoryIndex(tmpDir);
    const names = result.entries.map((e) => e.name).sort();
    expect(names).toEqual([
      'active-skill-cli-routing',
      'coverage-red-line',
      'main-branch-iteration',
      'peaks-current-directory-scope',
      'wechat-post-sop-dogfood'
    ]);
  });

  test('throws INDEX_MISSING when .peaks/memory/index.json is absent', () => {
    expect(() => loadMemoryIndex(tmpDir)).toThrow(/INDEX_MISSING/);
  });

  test('throws INDEX_INVALID when JSON is malformed', () => {
    const peaksDir = join(tmpDir, '.peaks', 'memory');
    mkdirSync(peaksDir, { recursive: true });
    writeFileSync(join(peaksDir, 'index.json'), '{ this is not valid json');
    expect(() => loadMemoryIndex(tmpDir)).toThrow(/INDEX_INVALID/);
  });
});

describe('searchMemory', () => {
  test('returns top-N sorted by score descending', () => {
    writeIndex(SAMPLE);
    const result = searchMemory({ query: 'wechat', projectRoot: tmpDir });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]?.name).toBe('wechat-post-sop-dogfood');
    expect(result[0]?.score).toBe(1.0);
  });

  test('--kind filter excludes non-matching kinds', () => {
    writeIndex(SAMPLE);
    const result = searchMemory({ query: 'peaks', projectRoot: tmpDir, kind: 'feedback' });
    for (const m of result) {
      expect(m.kind).toBe('feedback');
    }
  });

  test('searchable text is name + " " + description', () => {
    writeIndex(SAMPLE);
    // 'cli-routing' is unique to one rule-kind entry; verify only that
    // entry comes back.
    const result = searchMemory({ query: 'cli-routing', projectRoot: tmpDir });
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('active-skill-cli-routing');
  });

  test('sourcePath is absolute', () => {
    writeIndex(SAMPLE);
    const result = searchMemory({ query: 'wechat', projectRoot: tmpDir });
    for (const m of result) {
      expect(m.sourcePath).toMatch(/^[A-Z]:[\\/]|^[\\/]/);
    }
  });

  test('throws EMPTY_QUERY when query is empty string', () => {
    writeIndex(SAMPLE);
    expect(() => searchMemory({ query: '', projectRoot: tmpDir })).toThrow(/EMPTY_QUERY/);
  });

  test('invalid kind returns empty matches (no throw)', () => {
    writeIndex(SAMPLE);
    const result = searchMemory({
      query: 'wechat',
      projectRoot: tmpDir,
      kind: 'no-such-kind' as ProjectMemoryKind
    });
    expect(result).toEqual([]);
  });

  test('default limit is 6', () => {
    writeIndex(SAMPLE);
    // Make a fixture with 20 entries all matching the query.
    const big = {
      version: 1,
      updatedAt: '2026-06-10T00:00:00Z',
      hot: {
        feedback: Array.from({ length: 20 }, (_, i) => ({
          name: `feedback-${i}`,
          kind: 'feedback',
          description: 'this entry matches the query',
          sourcePath: `C:\\repo\\.peaks\\memory\\feedback-${i}.md`,
          sourceArtifact: null,
          updatedAt: '2026-06-01'
        }))
      },
      cold: []
    };
    writeIndex(big);
    const result = searchMemory({ query: 'matches', projectRoot: tmpDir });
    expect(result.length).toBeLessThanOrEqual(6);
  });

  test('limit honored when provided', () => {
    const big = {
      version: 1,
      updatedAt: '2026-06-10T00:00:00Z',
      hot: {
        feedback: Array.from({ length: 10 }, (_, i) => ({
          name: `feedback-${i}`,
          kind: 'feedback',
          description: 'this entry matches the query',
          sourcePath: `C:\\repo\\.peaks\\memory\\feedback-${i}.md`,
          sourceArtifact: null,
          updatedAt: '2026-06-01'
        }))
      },
      cold: []
    };
    writeIndex(big);
    const result = searchMemory({ query: 'matches', projectRoot: tmpDir, limit: 3 });
    expect(result.length).toBeLessThanOrEqual(3);
  });

  test('0 matches: returns []', () => {
    writeIndex(SAMPLE);
    const result = searchMemory({ query: 'xyzzy-no-match-zzz', projectRoot: tmpDir });
    expect(result).toEqual([]);
  });

  test('handles both hot[<kind>][] and cold[] groups', () => {
    writeIndex(SAMPLE);
    const result = searchMemory({ query: 'peaks', projectRoot: tmpDir });
    // 'peaks-current-directory-scope' is in cold, not hot — must still be reachable.
    const names = result.map((m) => m.name);
    expect(names).toContain('peaks-current-directory-scope');
  });
});

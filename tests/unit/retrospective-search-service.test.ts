import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { searchRetrospective } from '../../src/services/retrospective/retrospective-search-service.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `peaks-retro-search-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

function writeIndex(payload: unknown): void {
  const peaksDir = join(tmpDir, '.peaks', 'retrospective');
  mkdirSync(peaksDir, { recursive: true });
  writeFileSync(join(peaksDir, 'index.json'), JSON.stringify(payload));
}

const SAMPLE = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'retrospective-index-sample.json'), 'utf8')
);

describe('searchRetrospective', () => {
  test('returns top-N sorted by score descending', () => {
    writeIndex(SAMPLE);
    const result = searchRetrospective({ query: 'sub-agent', projectRoot: tmpDir });
    expect(result.length).toBeGreaterThan(0);
    // Both sub-agent entries should be present (their searchable text contains "sub-agent")
    const ids = result.map((r) => r.id);
    expect(ids).toContain('2026-06-06-session-517672-sub-agent');
    expect(ids).toContain('2026-06-06-session-517672-handoff');
    // Top hit is the one whose title+summary has the strongest match
    expect(result[0]?.score).toBe(1.0);
  });

  test('--type filter excludes non-matching types', () => {
    writeIndex(SAMPLE);
    const result = searchRetrospective({ query: 'session', projectRoot: tmpDir, type: 'refactor' });
    for (const m of result) {
      expect(m.type).toBe('refactor');
    }
  });

  test('--outcome filter excludes non-matching outcomes', () => {
    writeIndex(SAMPLE);
    const result = searchRetrospective({ query: 'session', projectRoot: tmpDir, outcome: 'shipped' });
    for (const m of result) {
      expect(m.outcome).toBe('shipped');
    }
  });

  test('--type and --outcome compose with AND', () => {
    writeIndex(SAMPLE);
    const result = searchRetrospective({
      query: 'session',
      projectRoot: tmpDir,
      type: 'refactor',
      outcome: 'shipped',
    });
    for (const m of result) {
      expect(m.type).toBe('refactor');
      expect(m.outcome).toBe('shipped');
    }
  });

  test('searchable text is title + " " + summary', () => {
    writeIndex(SAMPLE);
    // 'reconcile' is unique to one entry; the exact-match entry must be
    // the top hit (score 1.0) even if fzf's fuzzy algo also finds loose
    // matches in unrelated entries.
    const result = searchRetrospective({ query: 'reconcile', projectRoot: tmpDir });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]?.id).toBe('2026-06-04-workspace-reconcile');
    expect(result[0]?.score).toBe(1.0);
  });

  test('artifactPaths preserved in result', () => {
    writeIndex(SAMPLE);
    const result = searchRetrospective({ query: 'sub-agent', projectRoot: tmpDir });
    for (const m of result) {
      expect(Array.isArray(m.artifactPaths)).toBe(true);
    }
  });

  test('throws INDEX_MISSING when .peaks/retrospective/index.json is absent', () => {
    expect(() => searchRetrospective({ query: 'anything', projectRoot: tmpDir })).toThrow(/INDEX_MISSING/);
  });

  test('throws EMPTY_QUERY when query is empty string', () => {
    writeIndex(SAMPLE);
    expect(() => searchRetrospective({ query: '', projectRoot: tmpDir })).toThrow(/EMPTY_QUERY/);
  });

  test('default limit is 6', () => {
    writeIndex(SAMPLE);
    const result = searchRetrospective({ query: 'session', projectRoot: tmpDir });
    expect(result.length).toBeLessThanOrEqual(6);
  });

  test('limit honored when provided', () => {
    writeIndex(SAMPLE);
    const result = searchRetrospective({ query: 'session', projectRoot: tmpDir, limit: 2 });
    expect(result.length).toBeLessThanOrEqual(2);
  });

  test('0 matches: returns []', () => {
    writeIndex(SAMPLE);
    const result = searchRetrospective({ query: 'xyzzy-no-match-zzz', projectRoot: tmpDir });
    expect(result).toEqual([]);
  });
});

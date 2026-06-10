import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { fuzzyMatch, fuzzyMatchWithKey } from '../../src/services/fuzzy-matching/fuzzy-match-service.js';

interface Item {
  id: string;
  searchableText: string;
}

const ITEMS: Item[] = [
  { id: 'wechat-post-sop', searchableText: 'dogfood-2026-06-02-wechat-post-sop Real-world dogfood of the 公众号发文 SOP' },
  { id: 'sub-agent', searchableText: '2026-06-06-sub-agent-session-sharing Session sharing between sub-agents' },
  { id: 'memory-slim', searchableText: '2026-06-02-memory-slim-rewrite Compact the memory directory' },
  { id: 'retrospective-compact', searchableText: '2026-06-09-retrospective-index-and-format-compact' },
];

function hashMatches<T>(matches: { item: T; score: number; positions: number[] }[]): string {
  return createHash('sha256').update(JSON.stringify(matches)).digest('hex');
}

describe('fuzzyMatch (string[] overload)', () => {
  test('exact match: top score is 1.0 (normalized to top of batch)', () => {
    const items = ['apple', 'banana', 'apricot'];
    const result = fuzzyMatch('apple', items);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]?.score).toBe(1.0);
  });

  test('substring match: score > 0', () => {
    const result = fuzzyMatch('post', ['wechat-post-sop', 'memory-slim', 'retrospective-compact']);
    expect(result.length).toBeGreaterThan(0);
    for (const match of result) {
      expect(match.score).toBeGreaterThan(0);
    }
  });

  test('empty query: returns all items (capped at limit) with neutral score', () => {
    const result = fuzzyMatch('', ['a', 'b', 'c']);
    expect(result).toHaveLength(3);
    for (const match of result) {
      expect(match.score).toBe(0);
      expect(match.positions).toEqual([]);
    }
  });

  test('empty items: returns []', () => {
    expect(fuzzyMatch('anything', [])).toEqual([]);
  });

  test('limit caps result count', () => {
    const items = ['aaaa-1', 'aaaa-2', 'aaaa-3', 'aaaa-4', 'aaaa-5'];
    const result = fuzzyMatch('a', items, { limit: 2 });
    expect(result.length).toBeLessThanOrEqual(2);
  });

  test('default limit is 6', () => {
    const items = Array.from({ length: 20 }, (_, i) => `aaaa-${i}`);
    const result = fuzzyMatch('a', items);
    expect(result.length).toBeLessThanOrEqual(6);
  });

  test('case insensitive by default', () => {
    const lower = fuzzyMatch('wechat', ['wechat-post-sop', 'memory-slim']);
    const upper = fuzzyMatch('WECHAT', ['wechat-post-sop', 'memory-slim']);
    expect(lower[0]?.item).toBe('wechat-post-sop');
    expect(upper[0]?.item).toBe('wechat-post-sop');
  });

  test('case sensitive: caseSensitive:true only matches exact casing', () => {
    const result = fuzzyMatch('WECHAT', ['wechat-post-sop', 'memory-slim'], { caseSensitive: true });
    // With caseSensitive, 'WECHAT' must not match 'wechat-post-sop'
    expect(result.find((m) => m.item === 'wechat-post-sop')).toBeUndefined();
  });

  test('positions: char indices in the searchable text that matched', () => {
    const result = fuzzyMatch('post', ['wechat-post-sop']);
    expect(result[0]?.positions.length).toBeGreaterThan(0);
    // All positions should be valid char indices of 'wechat-post-sop'
    const text = 'wechat-post-sop';
    for (const pos of result[0]?.positions ?? []) {
      expect(pos).toBeGreaterThanOrEqual(0);
      expect(pos).toBeLessThan(text.length);
    }
  });
});

describe('fuzzyMatchWithKey (object overload with keyFn)', () => {
  test('matches against keyFn(item) searchable text', () => {
    const result = fuzzyMatchWithKey('wechat', ITEMS, { keyFn: (it) => it.searchableText });
    expect(result[0]?.item.id).toBe('wechat-post-sop');
    expect(result[0]?.score).toBe(1.0);
  });

  test('returns matches sorted by score descending', () => {
    // "2026" appears in every item's searchable text, so the result set
    // is at least 2 entries long and the score-descending invariant is
    // actually exercised.
    const result = fuzzyMatchWithKey('2026', ITEMS, { keyFn: (it) => it.searchableText });
    expect(result.length).toBeGreaterThan(1);
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1]?.score ?? 0;
      const curr = result[i]?.score ?? 0;
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  test('empty items: returns []', () => {
    expect(fuzzyMatchWithKey('q', [] as Item[], { keyFn: (it) => it.searchableText })).toEqual([]);
  });

  test('limit honored', () => {
    const result = fuzzyMatchWithKey('a', ITEMS, { keyFn: (it) => it.searchableText, limit: 2 });
    expect(result.length).toBeLessThanOrEqual(2);
  });

  test('string overload result shape matches object overload shape', () => {
    const strResult = fuzzyMatch('wechat', ['wechat-post-sop', 'memory-slim']);
    const objResult = fuzzyMatchWithKey('wechat', ITEMS, { keyFn: (it) => it.searchableText });
    expect(strResult[0]).toHaveProperty('item');
    expect(strResult[0]).toHaveProperty('score');
    expect(strResult[0]).toHaveProperty('positions');
    expect(objResult[0]).toHaveProperty('item');
    expect(objResult[0]).toHaveProperty('score');
    expect(objResult[0]).toHaveProperty('positions');
  });
});

describe('fuzzyMatch determinism contract', () => {
  test('10x same query + items → identical output hash (memory)', () => {
    const items = ['wechat-post-sop', 'sub-agent', 'memory-slim', 'retrospective-compact'];
    const hashes = new Set<string>();
    for (let i = 0; i < 10; i++) {
      hashes.add(hashMatches(fuzzyMatch('post', items)));
    }
    expect(hashes.size).toBe(1);
  });

  test('10x same query + items → identical output hash (object overload)', () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const r = fuzzyMatchWithKey('wechat', ITEMS, { keyFn: (it) => it.searchableText });
      hashes.add(hashMatches(r));
    }
    expect(hashes.size).toBe(1);
  });

  test('100x same query + items → identical output hash (stress)', () => {
    const items = Array.from({ length: 50 }, (_, i) => `item-${i}-with-some-content`);
    const first = hashMatches(fuzzyMatch('item', items));
    for (let i = 0; i < 100; i++) {
      expect(hashMatches(fuzzyMatch('item', items))).toBe(first);
    }
  });
});

describe('fuzzyMatch score normalization', () => {
  test('top match score is always exactly 1.0', () => {
    const result = fuzzyMatch('wechat', ['wechat-post-sop', 'memory-slim', 'retrospective-compact']);
    expect(result[0]?.score).toBe(1.0);
  });

  test('all scores in [0, 1]', () => {
    const result = fuzzyMatch('a', ['a', 'apple', 'banana', 'avocado', 'cherry', 'apricot', 'date']);
    for (const m of result) {
      expect(m.score).toBeGreaterThanOrEqual(0);
      expect(m.score).toBeLessThanOrEqual(1);
    }
  });

  test('items with no match at all: 0 hits, []', () => {
    const result = fuzzyMatch('xyzzy-no-match-zzz', ['apple', 'banana', 'cherry']);
    expect(result).toEqual([]);
  });
});

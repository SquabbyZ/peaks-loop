import { describe, expect, test } from 'vitest';
import { MemoryLruCache } from '../../../../src/services/context/memory-lru-cache.js';

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
    const c = new MemoryLruCache(8);
    c.set('emoji', '😀😀');
    expect(c.size()).toBe(8); // 2 emoji = 8 bytes in UTF-8
    expect(c.get('emoji')).toBe('😀😀');
  });

  test('oversized insert evicts all existing entries then stores the new one', () => {
    const c = new MemoryLruCache(10); // 10-byte budget
    c.set('small', 'hello');          // 5 bytes — fits
    // 'x'.repeat(100) is 100 bytes — exceeds the 10-byte budget
    c.set('big', 'x'.repeat(100));
    expect(c.get('small')).toBeUndefined();
    expect(c.get('big')).toBe('x'.repeat(100));
    expect(c.size()).toBe(100);
  });

  test('oversized insert into empty cache stores the single oversized entry', () => {
    // Degenerate case of the eviction contract: when the cache is empty,
    // an oversized value is still stored (the "single oversized entry
    // exception" — the caller can guard if they want different semantics).
    const c = new MemoryLruCache(10);
    c.set('only', 'x'.repeat(20));
    expect(c.size()).toBe(20);
    expect(c.get('only')).toBe('x'.repeat(20));
  });

  test('consecutive oversized inserts evict each other, leaving only the last', () => {
    const c = new MemoryLruCache(10);
    c.set('first', 'x'.repeat(20));   // exceeds budget — stored alone
    expect(c.size()).toBe(20);
    expect(c.get('first')).toBe('x'.repeat(20));

    c.set('second', 'y'.repeat(30));  // exceeds budget — evicts 'first', stores 'second'
    expect(c.size()).toBe(30);
    expect(c.get('first')).toBeUndefined();
    expect(c.get('second')).toBe('y'.repeat(30));
  });
});

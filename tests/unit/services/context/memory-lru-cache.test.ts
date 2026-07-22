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
    const c = new MemoryLruCache(6);
    c.set('emoji', '😀😀');
    expect(c.size()).toBe(8); // 2 emoji = 8 bytes in UTF-8
    expect(c.get('emoji')).toBe('😀😀');
  });
});
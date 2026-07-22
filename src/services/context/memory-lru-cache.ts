/**
 * Byte-budgeted LRU cache.
 *
 * Eviction contract:
 * - Every `set` enforces the byte budget.
 * - On a normal-size insert, least-recently-touched entries are evicted
 *   until the total byte count fits back inside `budgetBytes`.
 * - On an oversized insert (`body.bytes > budgetBytes`), ALL existing
 *   entries are evicted (LRU order) so only the newly inserted key
 *   remains. This prevents unbounded growth when oversized values are
 *   inserted consecutively; without this rule, a naive
 *   "single oversized exception" would let multiple oversized values
 *   accumulate without bound.
 */
interface Entry { body: string; bytes: number; }

export class MemoryLruCache {
  private readonly store = new Map<string, Entry>();
  private currentBytes = 0;

  constructor(private readonly budgetBytes: number) {}

  set(key: string, body: string): void {
    if (this.store.has(key)) this.delete(key);
    const bytes = Buffer.byteLength(body, 'utf8');
    if (bytes > this.budgetBytes) {
      // Oversized insert: evict ALL existing entries (LRU order) so only
      // the newly inserted key remains in the cache. This prevents the
      // unbounded growth that a naive "single oversized exception" would
      // allow when oversized values are inserted consecutively.
      this.evictAll();
      this.store.set(key, { body, bytes });
      this.currentBytes += bytes;
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

  private evictAll(): void {
    // Empty the store; called before an oversized insert so only the new
    // entry remains, per the eviction contract documented above.
    this.store.clear();
    this.currentBytes = 0;
  }
}

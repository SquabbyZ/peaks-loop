const BYTES_PER_TOKEN_ESTIMATE = 1; // we measure bytes, not tokens, for LRU.

interface Entry { body: string; bytes: number; }

export class MemoryLruCache {
  private readonly store = new Map<string, Entry>();
  private currentBytes = 0;

  constructor(private readonly budgetBytes: number) {}

  set(key: string, body: string): void {
    if (this.store.has(key)) this.delete(key);
    const bytes = Buffer.byteLength(body, 'utf8');
    this.store.set(key, { body, bytes });
    this.currentBytes += bytes;
    if (bytes <= this.budgetBytes) {
      // only evict when the new entry fits the budget on its own;
      // otherwise a too-large single entry would just evict itself
      this.evictIfOver();
    }
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
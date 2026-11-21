/**
 * Bounded in-memory cache: least-recently-used eviction under three budgets (entry count, total bytes,
 * time-to-live). All operations are O(1) amortised: a Map keeps insertion order, so re-inserting on
 * access moves an entry to the most-recent end and the oldest entry is always `keys().next()`.
 * TTL is sliding (refreshed on access), so map order is also expiry order: expired entries are dropped
 * lazily on access and swept from the old end on every insert.
 */
export type LruOptions = { maxEntries: number; maxBytes: number; ttlMs: number; now?: () => number };
type Entry<V> = { value: V; bytes: number; expiresAt: number };

export class LruCache<V> {
  private readonly map = new Map<string, Entry<V>>();
  private bytes = 0;
  private readonly now: () => number;
  constructor(private readonly options: LruOptions) { this.now = options.now ?? Date.now; }

  get size(): number { return this.map.size; }
  get totalBytes(): number { return this.bytes; }

  /** Stores a value. Values larger than the whole byte budget are rejected (returns false). */
  set(key: string, value: V, bytes: number): boolean {
    if (bytes > this.options.maxBytes) return false;
    this.delete(key);
    const expiresAt = this.now() + this.options.ttlMs;
    this.map.set(key, { value, bytes, expiresAt });
    this.bytes += bytes;
    this.sweep();
    return true;
  }

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) { this.delete(key); return undefined; }
    entry.expiresAt = this.now() + this.options.ttlMs; // sliding expiry
    this.map.delete(key); this.map.set(key, entry); // mark as most recently used
    return entry.value;
  }

  expiresAt(key: string): number | undefined { return this.map.get(key)?.expiresAt; }

  delete(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.map.delete(key); this.bytes -= entry.bytes;
    return true;
  }

  private sweep(): void {
    const now = this.now();
    // Oldest-first: evict expired entries, then least-recently-used ones until both budgets fit.
    for (const [key, entry] of this.map) {
      const overBudget = this.map.size > this.options.maxEntries || this.bytes > this.options.maxBytes;
      if (!overBudget && entry.expiresAt > now) break;
      this.delete(key);
    }
  }
}

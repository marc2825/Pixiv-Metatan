/** Tab-memory LRU. Size uses a conservative UTF-16 JSON estimate; no disk storage. */
export class MemoryCache<T> {
  private entries = new Map<string, { value: T; size: number; expires: number }>();
  private bytes = 0;
  constructor(private maxEntries: number, private maxBytes: number, private ttlMs: number, private now = Date.now) {}
  get(key: string): T | undefined {
    this.prune();
    const item = this.entries.get(key);
    if (!item) return;
    this.entries.delete(key); this.entries.set(key, item);
    return item.value;
  }
  set(key: string, value: T): void {
    this.prune(); this.remove(key);
    const size = JSON.stringify(value).length * 2;
    if (size > this.maxBytes) return;
    this.entries.set(key, { value, size, expires: this.now() + this.ttlMs }); this.bytes += size;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) this.remove(this.entries.keys().next().value!);
  }
  prune(): void {
    for (const [key, item] of this.entries) if (item.expires <= this.now()) this.remove(key);
  }
  clear(): void { this.entries.clear(); this.bytes = 0; }
  private remove(key: string): void {
    const item = this.entries.get(key);
    if (item) { this.bytes -= item.size; this.entries.delete(key); }
  }
}

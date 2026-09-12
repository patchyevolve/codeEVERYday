/**
 * Response Cache — LRU in-memory cache for AI responses.
 *
 * Design spec §19: cache AI responses keyed by (taskType, model, messageHash).
 * Reduces redundant API calls for identical requests.
 *
 * Features:
 *   - LRU eviction with configurable max size
 *   - TTL-based expiration
 *   - Hash-based key generation
 *   - Thread-safe via synchronous operations
 */

export interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

export interface CacheConfig {
  maxSize: number;
  defaultTtlMs: number;
}

const DEFAULT_CONFIG: CacheConfig = {
  maxSize: 500,
  defaultTtlMs: 5 * 60 * 1000, // 5 minutes
};

export class ResponseCache {
  private cache = new Map<string, CacheEntry>();
  private config: CacheConfig;

  constructor(config?: Partial<CacheConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.config.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    const ttl = ttlMs ?? this.config.defaultTtlMs;
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
      createdAt: Date.now(),
    });
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  /**
   * Generate a cache key from request parameters.
   */
  static buildKey(taskType: string, model: string, messages: unknown[]): string {
    const messageHash = ResponseCache.hashMessages(messages);
    return `${taskType}:${model}:${messageHash}`;
  }

  /**
   * Simple hash for messages — not cryptographic, just fast.
   */
  private static hashMessages(messages: unknown[]): string {
    const str = JSON.stringify(messages);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return hash.toString(36);
  }

  /**
   * Clean up expired entries.
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        pruned++;
      }
    }
    return pruned;
  }
}

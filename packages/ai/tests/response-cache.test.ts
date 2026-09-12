import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResponseCache } from "../src/gateway/response-cache.js";

describe("ResponseCache", () => {
  let cache: ResponseCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new ResponseCache({ maxSize: 5, defaultTtlMs: 1000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and retrieves values", () => {
    cache.set("key1", { data: "hello" });
    expect(cache.get("key1")).toEqual({ data: "hello" });
  });

  it("returns null for missing keys", () => {
    expect(cache.get("missing")).toBeNull();
  });

  it("respects TTL expiration", () => {
    const shortCache = new ResponseCache({ defaultTtlMs: 1 });
    shortCache.set("key1", "value1");
    // Wait for expiration
    vi.advanceTimersByTime(10);
    expect(shortCache.get("key1")).toBeNull();
  });

  it("evicts LRU entries when at capacity", () => {
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("d", 4);
    cache.set("e", 5);
    // Cache is full (5), adding one more should evict "a"
    cache.set("f", 6);
    expect(cache.get("a")).toBeNull();
    expect(cache.get("f")).toBe(6);
  });

  it("moves accessed items to end (LRU)", () => {
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("d", 4);
    cache.set("e", 5);
    // Access "a" to move it to end
    cache.get("a");
    // Adding "f" should evict "b" (now oldest)
    cache.set("f", 6);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeNull();
  });

  it("has() works correctly", () => {
    cache.set("key1", "value1");
    expect(cache.has("key1")).toBe(true);
    expect(cache.has("missing")).toBe(false);
  });

  it("delete() removes entries", () => {
    cache.set("key1", "value1");
    expect(cache.delete("key1")).toBe(true);
    expect(cache.get("key1")).toBeNull();
    expect(cache.delete("missing")).toBe(false);
  });

  it("clear() empties the cache", () => {
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("size reflects current entries", () => {
    expect(cache.size).toBe(0);
    cache.set("a", 1);
    expect(cache.size).toBe(1);
    cache.set("b", 2);
    expect(cache.size).toBe(2);
  });

  it("prune() removes expired entries", () => {
    const shortCache = new ResponseCache({ defaultTtlMs: 1 });
    shortCache.set("a", 1);
    shortCache.set("b", 2);
    vi.advanceTimersByTime(10);
    const pruned = shortCache.prune();
    expect(pruned).toBe(2);
    expect(shortCache.size).toBe(0);
  });

  it("buildKey() generates consistent keys", () => {
    const key1 = ResponseCache.buildKey("TUTOR", "gpt-4", [{ role: "user", content: "hi" }]);
    const key2 = ResponseCache.buildKey("TUTOR", "gpt-4", [{ role: "user", content: "hi" }]);
    expect(key1).toBe(key2);
  });

  it("buildKey() generates different keys for different inputs", () => {
    const key1 = ResponseCache.buildKey("TUTOR", "gpt-4", [{ role: "user", content: "hi" }]);
    const key2 = ResponseCache.buildKey("TUTOR", "gpt-4", [{ role: "user", content: "hello" }]);
    expect(key1).not.toBe(key2);
  });

  it("respects custom TTL per entry", () => {
    const customCache = new ResponseCache({ defaultTtlMs: 10000 });
    customCache.set("short", "value", 1);
    customCache.set("long", "value", 10000);
    vi.advanceTimersByTime(10);
    expect(customCache.get("short")).toBeNull();
    expect(customCache.get("long")).toBe("value");
  });
});

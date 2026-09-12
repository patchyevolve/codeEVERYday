import { describe, it, expect, vi, beforeEach } from "vitest";
import { RateLimiter } from "../src/gateway/rate-limiter.js";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  it("allows requests within rate limit", () => {
    const result = limiter.checkRateLimit("provider-1", 60, 100000);
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);
  });

  it("records requests and tracks usage", () => {
    limiter.recordRequest("provider-1", 100);
    limiter.recordRequest("provider-1", 200);
    const usage = limiter.getUsage("provider-1");
    expect(usage.rpm).toBe(2);
    expect(usage.tpm).toBe(300);
  });

  it("reset clears all state", () => {
    limiter.recordRequest("provider-1", 100);
    limiter.recordRequest("provider-2", 200);
    expect(limiter.getUsage("provider-1").rpm).toBe(1);
    expect(limiter.getUsage("provider-2").rpm).toBe(1);

    limiter.reset();

    expect(limiter.getUsage("provider-1").rpm).toBe(0);
    expect(limiter.getUsage("provider-2").rpm).toBe(0);
  });

  it("returns isolated state per provider", () => {
    limiter.recordRequest("provider-1", 100);
    limiter.recordRequest("provider-2", 200);
    expect(limiter.getUsage("provider-1").tpm).toBe(100);
    expect(limiter.getUsage("provider-2").tpm).toBe(200);
  });
});

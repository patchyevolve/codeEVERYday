import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CircuitBreaker } from "../src/gateway/circuit-breaker.js";

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker;

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 100 });
  });

  describe("CLOSED state", () => {
    it("allows execution when closed", () => {
      expect(breaker.canExecute("openai")).toBe(true);
    });

    it("starts with zero consecutive failures", () => {
      expect(breaker.getState("openai").consecutiveFailures).toBe(0);
    });

    it("records failures but stays closed below threshold", () => {
      breaker.recordFailure("openai");
      breaker.recordFailure("openai");
      expect(breaker.getState("openai").state).toBe("CLOSED");
      expect(breaker.getState("openai").consecutiveFailures).toBe(2);
    });
  });

  describe("OPEN state", () => {
    it("opens after reaching failure threshold", () => {
      breaker.recordFailure("openai");
      breaker.recordFailure("openai");
      breaker.recordFailure("openai");
      expect(breaker.getState("openai").state).toBe("OPEN");
    });

    it("blocks execution when open", () => {
      for (let i = 0; i < 3; i++) breaker.recordFailure("openai");
      expect(breaker.canExecute("openai")).toBe(false);
    });

    it("transitions to HALF_OPEN after cooldown", () => {
      for (let i = 0; i < 3; i++) breaker.recordFailure("openai");
      expect(breaker.canExecute("openai")).toBe(false);

      vi.advanceTimersByTime(101);
      expect(breaker.canExecute("openai")).toBe(true);
      expect(breaker.getState("openai").state).toBe("HALF_OPEN");
    });
  });

  describe("HALF_OPEN state", () => {
    it("allows one probe when half-open", () => {
      for (let i = 0; i < 3; i++) breaker.recordFailure("openai");
      vi.advanceTimersByTime(101);

      expect(breaker.canExecute("openai")).toBe(true);
      // Second call should be blocked (probe in flight)
      expect(breaker.canExecute("openai")).toBe(false);
    });

    it("closes on successful probe", () => {
      for (let i = 0; i < 3; i++) breaker.recordFailure("openai");
      vi.advanceTimersByTime(101);

      breaker.canExecute("openai"); // enter half-open
      breaker.recordSuccess("openai");
      expect(breaker.getState("openai").state).toBe("CLOSED");
      expect(breaker.getState("openai").consecutiveFailures).toBe(0);
    });

    it("reopens on failed probe", () => {
      for (let i = 0; i < 3; i++) breaker.recordFailure("openai");
      vi.advanceTimersByTime(101);

      breaker.canExecute("openai"); // enter half-open
      breaker.recordFailure("openai");
      expect(breaker.getState("openai").state).toBe("OPEN");
    });
  });

  describe("success resets state", () => {
    it("resets failure count on success", () => {
      breaker.recordFailure("openai");
      breaker.recordFailure("openai");
      breaker.recordSuccess("openai");
      expect(breaker.getState("openai").consecutiveFailures).toBe(0);
      expect(breaker.getState("openai").state).toBe("CLOSED");
    });
  });

  describe("reset", () => {
    it("resets provider to initial state", () => {
      for (let i = 0; i < 5; i++) breaker.recordFailure("openai");
      breaker.reset("openai");
      expect(breaker.getState("openai").state).toBe("CLOSED");
      expect(breaker.getState("openai").consecutiveFailures).toBe(0);
    });
  });

  describe("loadFromDB", () => {
    it("restores state from database records", () => {
      breaker.loadFromDB([
        { providerId: "openai", breakerState: "OPEN", consecutiveFailures: 7, breakerOpenedAt: new Date() },
      ]);
      expect(breaker.getState("openai").state).toBe("OPEN");
      expect(breaker.getState("openai").consecutiveFailures).toBe(7);
    });
  });

  describe("provider isolation", () => {
    it("tracks each provider independently", () => {
      breaker.recordFailure("openai");
      breaker.recordFailure("openai");
      breaker.recordFailure("openai"); // openai opens

      breaker.recordSuccess("anthropic"); // anthropic stays closed
      expect(breaker.canExecute("anthropic")).toBe(true);
      expect(breaker.getState("openai").state).toBe("OPEN");
    });
  });
});

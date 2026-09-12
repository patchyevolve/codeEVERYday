/**
 * Tests for the DI container.
 *
 * Verifies that createContainer produces a consistent object graph
 * with lazy initialization and that singleton references are stable.
 */

import { describe, it, expect, vi } from "vitest";
import { createContainer, type Container } from "../src/container.js";

// Mock DB — we only need the type, not actual queries
const mockDb = {} as Parameters<typeof createContainer>[0];

describe("createContainer", () => {
  it("returns a container with all expected properties", () => {
    const c = createContainer(mockDb);
    expect(c.db).toBe(mockDb);
    expect(c.provider).toBeDefined();
    expect(c.registry).toBeDefined();
    expect(c.breaker).toBeDefined();
    expect(c.quota).toBeDefined();
    expect(c.rateLimiter).toBeDefined();
    expect(c.retryPolicy).toBeDefined();
    expect(c.usageTracker).toBeDefined();
    expect(c.gateway).toBeDefined();
    expect(c.orchestrator).toBeDefined();
    expect(c.contentService).toBeDefined();
    expect(c.tutorEngine).toBeDefined();
    expect(c.contextCompiler).toBeDefined();
    expect(c.memorySystem).toBeDefined();
    expect(c.sessionController).toBeDefined();
    expect(c.jobQueue).toBeDefined();
    expect(c.providerStateRepo).toBeDefined();
    expect(c.contentRepository).toBeDefined();
  });

  it("returns the same instance on repeated access (lazy singleton)", () => {
    const c = createContainer(mockDb);
    expect(c.breaker).toBe(c.breaker);
    expect(c.quota).toBe(c.quota);
    expect(c.rateLimiter).toBe(c.rateLimiter);
    expect(c.retryPolicy).toBe(c.retryPolicy);
    expect(c.registry).toBe(c.registry);
  });

  it("gateway receives injected dependencies", () => {
    const c = createContainer(mockDb);
    // The gateway should be an AIGatewayImpl — just verify it has the expected interface
    expect(typeof c.gateway.request).toBe("function");
    expect(typeof c.gateway.enqueue).toBe("function");
    expect(typeof c.gateway.getRawProvider).toBe("function");
  });

  it("orchestrator receives injected gateway", () => {
    const c = createContainer(mockDb);
    expect(typeof c.orchestrator.request).toBe("function");
    expect(typeof c.orchestrator.enqueue).toBe("function");
    expect(typeof c.orchestrator.generateStructured).toBe("function");
  });
});

import { describe, it, expect } from "vitest";
import {
  generateClarificationQuestion,
} from "../src/tutor-reasoning.js";
import type { Hypothesis } from "../src/contracts.js";

function makeHypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
  return {
    id: "h1",
    userId: "u1",
    subject: "subject",
    statement: "statement",
    confidence: 0.5,
    alternatives: [],
    supportingEvidence: [],
    contradictingEvidence: [],
    status: "ACTIVE",
    createdAt: new Date(),
    lastEvaluatedAt: null,
    ...overrides,
  };
}

describe("generateClarificationQuestion", () => {
  it("formats a question between two hypotheses", () => {
    const top = makeHypothesis({ statement: "A", confidence: 0.6 });
    const alt = makeHypothesis({ statement: "B", confidence: 0.45 });
    const q = generateClarificationQuestion(top, alt);
    expect(q).toContain("A");
    expect(q).toContain("B");
    expect(q).toContain("60%");
    expect(q).toContain("45%");
  });
});

describe("EvaluatorDeps type", () => {
  it("exports the EvaluatorDeps interface", async () => {
    const mod = await import("../src/evaluator.js");
    expect(typeof mod.evaluateSubmission).toBe("function");
    expect(typeof mod.completeSession).toBe("function");
    expect(typeof mod.debugAssist).toBe("function");
  });
});

describe("Repository exports", () => {
  it("exports all repository classes", async () => {
    const repos = await import("../src/repositories/index.js");
    expect(repos.NodeRepository).toBeDefined();
    expect(repos.SessionRepository).toBeDefined();
    expect(repos.UserRepository).toBeDefined();
    expect(repos.MemoryRepository).toBeDefined();
    expect(repos.ReasoningRepository).toBeDefined();
    expect(repos.SubmissionRepository).toBeDefined();
    expect(repos.StreakRepository).toBeDefined();
    expect(typeof repos.NodeRepository).toBe("function");
    expect(typeof repos.SubmissionRepository).toBe("function");
    expect(typeof repos.StreakRepository).toBe("function");
  });
});

describe("Container exports", () => {
  it("exports createContainer", async () => {
    const mod = await import("../src/container.js");
    expect(typeof mod.createContainer).toBe("function");
  });
});

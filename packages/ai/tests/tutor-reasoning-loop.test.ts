import { describe, it, expect, vi } from "vitest";
import {
  extractEvidenceFromMessage,
  decideAction,
  handleIncoming,
  type ReasoningLoopDeps,
  type IncomingContext,
} from "../src/tutor-reasoning-loop.js";
import type { TutorMessage, Hypothesis } from "../src/contracts.js";

/* ------------------------------------------------------------------ */
/* extractEvidenceFromMessage                                           */
/* ------------------------------------------------------------------ */

describe("extractEvidenceFromMessage", () => {
  const baseContext: IncomingContext = {
    userId: "u1",
    sessionId: "s1",
    currentNodeKey: "cpp-variables",
  };

  it("classifies LEARNER_CLAIM messages", () => {
    const msg: TutorMessage = {
      type: "LEARNER_CLAIM",
      content: "I think the answer is 42",
      metadata: { verdict: "correct" },
    };
    const ev = extractEvidenceFromMessage(msg, baseContext);
    expect(ev.evidenceType).toBe("LEARNER_CLAIM");
    expect(ev.result).toBe("correct");
    expect(ev.concept).toBe("cpp-variables");
  });

  it("classifies LEARNER_CORRECTION messages", () => {
    const msg: TutorMessage = {
      type: "LEARNER_CORRECTION",
      content: "Oh wait, I made a mistake. It should be 5.",
      metadata: { previousAnswer: "3" },
    };
    const ev = extractEvidenceFromMessage(msg, baseContext);
    expect(ev.evidenceType).toBe("SELF_CORRECTION");
    expect(ev.result).toBe("correct");
  });

  it("classifies SYSTEM_EVENT messages", () => {
    const msg: TutorMessage = {
      type: "SYSTEM_EVENT",
      content: "Session timeout approaching",
      metadata: { issue: "timeout" },
    };
    const ev = extractEvidenceFromMessage(msg, baseContext);
    expect(ev.evidenceType).toBe("SESSION_BEHAVIOR");
  });

  it("detects confusion questions", () => {
    const msg: TutorMessage = {
      type: "LEARNER_MESSAGE",
      content: "I don't understand how pointers work",
    };
    const ev = extractEvidenceFromMessage(msg, baseContext);
    expect(ev.evidenceType).toBe("QUESTION");
  });

  it("detects hint requests", () => {
    const msg: TutorMessage = {
      type: "LEARNER_MESSAGE",
      content: "I'm stuck on this problem, can you help me?",
    };
    const ev = extractEvidenceFromMessage(msg, baseContext);
    expect(ev.evidenceType).toBe("HINT_REQUEST");
  });

  it("detects confident answers", () => {
    const msg: TutorMessage = {
      type: "LEARNER_MESSAGE",
      content: "I think my answer is correct, it should work",
    };
    const ev = extractEvidenceFromMessage(msg, baseContext);
    expect(ev.evidenceType).toBe("ANSWER");
    expect(ev.result).toBe("correct");
  });

  it("defaults to partial ANSWER for unrecognized messages", () => {
    const msg: TutorMessage = {
      type: "LEARNER_MESSAGE",
      content: "Hello there",
    };
    const ev = extractEvidenceFromMessage(msg, baseContext);
    expect(ev.evidenceType).toBe("ANSWER");
    expect(ev.result).toBe("partial");
  });
});

/* ------------------------------------------------------------------ */
/* decideAction                                                        */
/* ------------------------------------------------------------------ */

describe("decideAction", () => {
  const baseContext: IncomingContext = {
    userId: "u1",
    sessionId: "s1",
    currentNodeKey: "cpp-variables",
  };

  it("returns ASK when clarification is needed", () => {
    const hypotheses: Hypothesis[] = [
      { id: "h1", userId: "u1", subject: "cpp", statement: "A", confidence: 0.5, supportingEvidence: [], contradictingEvidence: [], alternatives: [], status: "ACTIVE", createdAt: new Date(), lastEvaluatedAt: new Date() },
      { id: "h2", userId: "u1", subject: "cpp", statement: "B", confidence: 0.45, supportingEvidence: [], contradictingEvidence: [], alternatives: [], status: "ACTIVE", createdAt: new Date(), lastEvaluatedAt: new Date() },
    ];
    const result = decideAction(hypotheses, baseContext, true);
    expect(result.action).toBe("ASK");
  });

  it("returns REEXPLAIN for strong misconception hypothesis", () => {
    const hypotheses: Hypothesis[] = [
      { id: "h1", userId: "u1", subject: "cpp", statement: "Learner has misconception about pointers", confidence: 0.8, supportingEvidence: [], contradictingEvidence: [], alternatives: [], status: "ACTIVE", createdAt: new Date(), lastEvaluatedAt: new Date() },
    ];
    const result = decideAction(hypotheses, baseContext, false);
    expect(result.action).toBe("REEXPLAIN");
  });

  it("returns REVIEW_PREREQUISITE for strong prerequisite hypothesis", () => {
    const hypotheses: Hypothesis[] = [
      { id: "h1", userId: "u1", subject: "cpp", statement: "Missing prerequisite knowledge of loops", confidence: 0.75, supportingEvidence: [], contradictingEvidence: [], alternatives: [], status: "ACTIVE", createdAt: new Date(), lastEvaluatedAt: new Date() },
    ];
    const result = decideAction(hypotheses, baseContext, false);
    expect(result.action).toBe("REVIEW_PREREQUISITE");
  });

  it("returns GIVE_HINT for strong debugging hypothesis", () => {
    const hypotheses: Hypothesis[] = [
      { id: "h1", userId: "u1", subject: "cpp", statement: "Debugging error in syntax", confidence: 0.7, supportingEvidence: [], contradictingEvidence: [], alternatives: [], status: "ACTIVE", createdAt: new Date(), lastEvaluatedAt: new Date() },
    ];
    const result = decideAction(hypotheses, baseContext, false);
    expect(result.action).toBe("GIVE_HINT");
  });

  it("returns EXPLAIN for strong general hypothesis", () => {
    const hypotheses: Hypothesis[] = [
      { id: "h1", userId: "u1", subject: "cpp", statement: "Learner lacks understanding of scope rules", confidence: 0.72, supportingEvidence: [], contradictingEvidence: [], alternatives: [], status: "ACTIVE", createdAt: new Date(), lastEvaluatedAt: new Date() },
    ];
    const result = decideAction(hypotheses, baseContext, false);
    expect(result.action).toBe("EXPLAIN");
  });

  it("returns DIAGNOSE for moderate confidence", () => {
    const hypotheses: Hypothesis[] = [
      { id: "h1", userId: "u1", subject: "cpp", statement: "Unclear confusion", confidence: 0.5, supportingEvidence: [], contradictingEvidence: [], alternatives: [], status: "ACTIVE", createdAt: new Date(), lastEvaluatedAt: new Date() },
    ];
    const result = decideAction(hypotheses, baseContext, false);
    expect(result.action).toBe("DIAGNOSE");
  });

  it("returns CONTINUE for weak hypothesis", () => {
    const hypotheses: Hypothesis[] = [
      { id: "h1", userId: "u1", subject: "cpp", statement: "Maybe related", confidence: 0.2, supportingEvidence: [], contradictingEvidence: [], alternatives: [], status: "ACTIVE", createdAt: new Date(), lastEvaluatedAt: new Date() },
    ];
    const result = decideAction(hypotheses, baseContext, false);
    expect(result.action).toBe("CONTINUE");
  });

  it("returns CONTINUE when no hypotheses", () => {
    const result = decideAction([], baseContext, false);
    expect(result.action).toBe("CONTINUE");
  });
});

/* ------------------------------------------------------------------ */
/* handleIncoming (mocked deps)                                         */
/* ------------------------------------------------------------------ */

describe("handleIncoming", () => {
  function createMockDeps(overrides?: {
    orchestratorResponse?: string;
    activeHypotheses?: Hypothesis[];
  }): ReasoningLoopDeps {
    const mockHypothesis: Hypothesis = {
      id: "h-new",
      userId: "u1",
      subject: "cpp",
      statement: "test hypothesis",
      confidence: 0.5,
      supportingEvidence: [],
      contradictingEvidence: [],
      alternatives: [],
      status: "ACTIVE",
      createdAt: new Date(),
      lastEvaluatedAt: new Date(),
    };

    return {
      reasoningRepo: {
        insertHypothesis: vi.fn().mockResolvedValue(mockHypothesis),
        findHypothesisById: vi.fn().mockResolvedValue(mockHypothesis),
        updateHypothesis: vi.fn().mockResolvedValue(mockHypothesis),
        findActiveHypotheses: vi.fn().mockResolvedValue(overrides?.activeHypotheses ?? []),
        supersedeHypothesis: vi.fn().mockResolvedValue(undefined),
        insertDecision: vi.fn().mockResolvedValue({
          id: "d1",
          sessionId: "s1",
          userId: "u1",
          observations: [],
          hypotheses: [],
          action: "EXPLAIN",
          confidence: 0.5,
          expectedOutcome: "test",
          verdict: "unknown",
          createdAt: new Date(),
        }),
        findDecisionsBySession: vi.fn().mockResolvedValue([]),
        findDecisionsByUser: vi.fn().mockResolvedValue([]),
        updateDecisionVerdict: vi.fn().mockResolvedValue(undefined),
        insertExperience: vi.fn().mockResolvedValue({}),
        findExperienceByConcept: vi.fn().mockResolvedValue([]),
        findDecisionsBySessionForReport: vi.fn().mockResolvedValue([]),
        findExperienceForStrategy: vi.fn().mockResolvedValue([]),
      } as never,
      memoryRepo: {
        insertEvidenceEvent: vi.fn().mockResolvedValue(undefined),
      } as never,
      orchestrator: {
        request: vi.fn().mockResolvedValue({
          ok: true,
          content: overrides?.orchestratorResponse ?? JSON.stringify({
            hypotheses: [{ statement: "Learner is confused", confidence: 0.6, alternatives: [] }],
          }),
          provider: "test",
          model: "test",
          latencyMs: 100,
          tokens: { in: 10, out: 10 },
          costUsd: 0,
          fromCache: false,
          fallbackUsed: false,
          retryCount: 0,
        }),
      } as never,
    };
  }

  const context: IncomingContext = {
    userId: "u1",
    sessionId: "s1",
    currentNodeKey: "cpp-variables",
    currentPhase: "TEACHING",
  };

  it("returns a valid TutorResponse", async () => {
    const deps = createMockDeps();
    const msg: TutorMessage = {
      type: "LEARNER_MESSAGE",
      content: "I don't understand this concept",
    };

    const response = await handleIncoming(deps, msg, context);

    expect(response).toHaveProperty("action");
    expect(response).toHaveProperty("content");
    expect(response).toHaveProperty("evidence");
    expect(typeof response.content).toBe("string");
    expect(response.content.length).toBeGreaterThan(0);
    expect(Array.isArray(response.evidence)).toBe(true);
  });

  it("generates at least one hypothesis", async () => {
    const deps = createMockDeps();
    const msg: TutorMessage = {
      type: "LEARNER_MESSAGE",
      content: "I'm confused about loops",
    };

    const response = await handleIncoming(deps, msg, context);
    expect(response.hypothesis).toBeDefined();
  });

  it("records a decision for each incoming message", async () => {
    const deps = createMockDeps();
    const msg: TutorMessage = {
      type: "LEARNER_MESSAGE",
      content: "What does this code do?",
    };

    await handleIncoming(deps, msg, context);

    const reasoningRepo = deps.reasoningRepo as unknown as { insertDecision: ReturnType<typeof vi.fn> };
    expect(reasoningRepo.insertDecision).toHaveBeenCalledOnce();
  });

  it("generates evidence events", async () => {
    const deps = createMockDeps();
    const msg: TutorMessage = {
      type: "LEARNER_MESSAGE",
      content: "I need a hint please",
    };

    const response = await handleIncoming(deps, msg, context);
    expect(response.evidence!.length).toBeGreaterThanOrEqual(1);
    expect(response.evidence![0].type).toBe("HINT_REQUEST");
  });

  it("handles orchestrator failure gracefully", async () => {
    const deps = createMockDeps({
      orchestratorResponse: undefined,
    });
    (deps.orchestrator.request as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: "PROVIDER_FAILURE",
      provider: "",
      model: "",
      latencyMs: 0,
      tokens: { in: 0, out: 0 },
      costUsd: 0,
      fromCache: false,
      fallbackUsed: false,
      retryCount: 0,
    });

    const msg: TutorMessage = {
      type: "LEARNER_MESSAGE",
      content: "Help me with this",
    };

    const response = await handleIncoming(deps, msg, context);
    expect(typeof response.content).toBe("string");
    expect(response.content.length).toBeGreaterThan(0);
  });
});

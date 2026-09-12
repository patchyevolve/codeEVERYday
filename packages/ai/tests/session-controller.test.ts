import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionController, SESSION_PHASES } from "../src/session-controller.js";
import type { SessionRepository } from "../src/repositories/session-repository.js";
import type { MemoryRepository } from "../src/repositories/memory-repository.js";
import type { ReasoningRepository } from "../src/repositories/reasoning-repository.js";
import type { NodeRepository } from "../src/repositories/node-repository.js";

function createMockRepos() {
  return {
    sessionRepo: {
      startSession: vi.fn().mockResolvedValue(undefined),
      updatePhase: vi.fn().mockResolvedValue(undefined),
      getCurrentPhase: vi.fn().mockResolvedValue("OPENING"),
      endSession: vi.fn().mockResolvedValue(undefined),
      findSessionWithDecision: vi.fn().mockResolvedValue({
        id: "s1",
        userId: "u1",
        decision: { objectiveNodeId: "n1" },
      }),
      findTasksBySession: vi.fn().mockResolvedValue([
        { id: "t1", title: "Task 1", status: "DONE", required: true },
        { id: "t2", title: "Task 2", status: "PENDING", required: true },
      ]),
    } as unknown as SessionRepository,
    memoryRepo: {
      findEvidenceBySession: vi.fn().mockResolvedValue([
        { id: "e1", concept: "cpp-variables", result: "correct", type: "CODE_SUBMISSION", payload: {} },
        { id: "e2", concept: "cpp-variables", result: "incorrect", type: "CODE_SUBMISSION", payload: { misconception: "off-by-one" } },
      ]),
      upsertSessionReport: vi.fn().mockResolvedValue(undefined),
      findLatestReportByUser: vi.fn().mockResolvedValue(null),
      findConceptStatesByUser: vi.fn().mockResolvedValue([]),
      findNodesByIds: vi.fn().mockResolvedValue([]),
    } as unknown as MemoryRepository,
    reasoningRepo: {
      findDecisionsBySession: vi.fn().mockResolvedValue([
        { action: "EXPLAIN", verdict: "correct", correction: null, confidence: 0.8, selectedHypothesis: "h1" },
      ]),
      findDecisionsBySessionForReport: vi.fn().mockResolvedValue([
        { action: "EXPLAIN", verdict: "correct", correction: null, confidence: 0.8, selectedHypothesis: "h1" },
      ]),
    } as unknown as ReasoningRepository,
    nodeRepo: {
      findLabelsByIds: vi.fn().mockResolvedValue([]),
    } as unknown as NodeRepository,
  };
}

describe("SessionController", () => {
  let controller: SessionController;
  let repos: ReturnType<typeof createMockRepos>;

  beforeEach(() => {
    repos = createMockRepos();
    controller = new SessionController(
      repos.sessionRepo,
      repos.memoryRepo,
      repos.reasoningRepo,
      repos.nodeRepo,
    );
  });

  describe("transitionPhase", () => {
    it("allows valid transitions", async () => {
      repos.sessionRepo.getCurrentPhase.mockResolvedValue("OPENING");
      await controller.transitionPhase("s1", "RECALL");
      expect(repos.sessionRepo.updatePhase).toHaveBeenCalledWith("s1", "RECALL");
    });

    it("rejects invalid transitions", async () => {
      repos.sessionRepo.getCurrentPhase.mockResolvedValue("OPENING");
      await expect(controller.transitionPhase("s1", "CLOSING")).rejects.toThrow("Invalid transition");
    });

    it("rejects transition when no current phase", async () => {
      repos.sessionRepo.getCurrentPhase.mockResolvedValue(null);
      await expect(controller.transitionPhase("s1", "RECALL")).rejects.toThrow("no current phase");
    });
  });

  describe("generateReport", () => {
    it("generates a report with correct fields", async () => {
      const report = await controller.generateReport("s1");
      expect(report.sessionId).toBe("s1");
      expect(report.userId).toBe("u1");
      expect(report.completed).toContain("Task 1");
      expect(report.incomplete).toContain("Task 2");
      expect(report.strengths).toContain("cpp-variables");
      expect(report.weaknesses).toContain("cpp-variables");
      expect(report.misconceptions).toContain("off-by-one");
    });

    it("throws for non-existent session", async () => {
      repos.sessionRepo.findSessionWithDecision.mockResolvedValue(null);
      await expect(controller.generateReport("nonexistent")).rejects.toThrow("not found");
    });
  });

  describe("endSession", () => {
    it("generates report, persists it, and ends session", async () => {
      const report = await controller.endSession("s1");
      expect(repos.memoryRepo.upsertSessionReport).toHaveBeenCalledOnce();
      expect(repos.sessionRepo.endSession).toHaveBeenCalledWith("s1");
      expect(report.sessionId).toBe("s1");
    });
  });

  describe("SESSION_PHASES", () => {
    it("has 11 phases", () => {
      expect(SESSION_PHASES).toHaveLength(11);
    });

    it("starts with OPENING and ends with CLOSING", () => {
      expect(SESSION_PHASES[0]).toBe("OPENING");
      expect(SESSION_PHASES[10]).toBe("CLOSING");
    });
  });
});

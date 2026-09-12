import type { SessionReport, StrategyOutcome } from "./contracts.js";
import type { SessionRepository } from "./repositories/session-repository.js";
import type { MemoryRepository } from "./repositories/memory-repository.js";
import type { ReasoningRepository } from "./repositories/reasoning-repository.js";
import type { NodeRepository } from "./repositories/node-repository.js";

export const SESSION_PHASES = [
  "OPENING",
  "RECALL",
  "DIAGNOSTIC",
  "TEACHING",
  "INTERACTION",
  "GUIDED_PRACTICE",
  "INDEPENDENT_PRACTICE",
  "TRANSFER",
  "ASSESSMENT",
  "REFLECTION",
  "CLOSING",
] as const;

export type SessionPhase = (typeof SESSION_PHASES)[number];

const TRANSITIONS: Record<SessionPhase, SessionPhase[]> = {
  OPENING: ["RECALL", "DIAGNOSTIC"],
  RECALL: ["DIAGNOSTIC", "TEACHING", "INTERACTION"],
  DIAGNOSTIC: ["TEACHING", "INTERACTION", "RECALL"],
  TEACHING: ["INTERACTION", "GUIDED_PRACTICE"],
  INTERACTION: ["TEACHING", "GUIDED_PRACTICE", "INDEPENDENT_PRACTICE", "RECALL"],
  GUIDED_PRACTICE: ["INDEPENDENT_PRACTICE", "ASSESSMENT", "INTERACTION"],
  INDEPENDENT_PRACTICE: ["ASSESSMENT", "TRANSFER", "INTERACTION"],
  TRANSFER: ["ASSESSMENT", "REFLECTION"],
  ASSESSMENT: ["REFLECTION", "TRANSFER"],
  REFLECTION: ["CLOSING", "ASSESSMENT"],
  CLOSING: [],
};

export class SessionController {
  constructor(
    private readonly sessionRepo: SessionRepository,
    private readonly memoryRepo: MemoryRepository,
    private readonly reasoningRepo: ReasoningRepository,
    private readonly nodeRepo: NodeRepository,
  ) {}

  async startSession(sessionId: string): Promise<void> {
    await this.sessionRepo.startSession(sessionId);
  }

  async transitionPhase(sessionId: string, targetPhase: SessionPhase): Promise<void> {
    const currentPhase = await this.sessionRepo.getCurrentPhase(sessionId);
    if (!currentPhase) {
      throw new Error(`Session ${sessionId} has no current phase`);
    }

    const allowed = TRANSITIONS[currentPhase as SessionPhase];
    if (!allowed || !allowed.includes(targetPhase)) {
      throw new Error(
        `Invalid transition: ${currentPhase} → ${targetPhase}. Allowed: [${allowed?.join(", ")}]`
      );
    }

    await this.sessionRepo.updatePhase(sessionId, targetPhase);
  }

  async getCurrentPhase(sessionId: string): Promise<string | null> {
    return this.sessionRepo.getCurrentPhase(sessionId);
  }

  async endSession(sessionId: string): Promise<SessionReport> {
    const report = await this.generateReport(sessionId);
    await this.persistReport(report);
    await this.sessionRepo.endSession(sessionId);
    return report;
  }

  async generateReport(sessionId: string): Promise<SessionReport> {
    const session = await this.sessionRepo.findSessionWithDecision(sessionId);

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const [tasks, evidence, decisions] = await Promise.all([
      this.sessionRepo.findTasksBySession(sessionId),
      this.memoryRepo.findEvidenceBySession(sessionId),
      this.reasoningRepo.findDecisionsBySessionForReport(sessionId),
    ]);

    const planned = tasks.map((t) => t.title);
    const completedTasks = tasks.filter((t) => t.status === "DONE");
    const incomplete = tasks.filter((t) => t.status !== "DONE" && t.required).map((t) => t.title);

    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const misconceptions: string[] = [];

    for (const ev of evidence) {
      const concept = ev.concept ?? "unknown";
      if (ev.result === "correct") {
        if (!strengths.includes(concept)) strengths.push(concept);
      } else if (ev.result === "incorrect") {
        if (!weaknesses.includes(concept)) weaknesses.push(concept);
        const payload = ev.payload as Record<string, unknown>;
        if (typeof payload.misconception === "string" && !misconceptions.includes(payload.misconception)) {
          misconceptions.push(payload.misconception);
        }
      }
    }

    const strategies: { strategy: string; outcome: StrategyOutcome }[] = [];
    const reviewsRequired: string[] = [];
    for (const dec of decisions) {
      const outcome: StrategyOutcome = dec.verdict === "correct" ? "effective" : dec.verdict === "incorrect" ? "ineffective" : "mixed";
      strategies.push({ strategy: dec.action, outcome });
      if (dec.verdict === "incorrect" && dec.correction) {
        reviewsRequired.push(dec.correction);
      }
    }

    const unresolvedHypotheses: string[] = [];
    for (const dec of decisions) {
      if (dec.confidence < 0.6 && dec.selectedHypothesis) {
        unresolvedHypotheses.push(dec.selectedHypothesis);
      }
    }

    const learnerQuestions = evidence
      .filter((e) => e.type === "QUESTION" || e.type === "HINT_REQUEST")
      .map((e) => (e.payload as Record<string, unknown>)?.content as string ?? "")
      .filter(Boolean);

    const environmentalIssues = evidence
      .filter((e) => e.type === "SESSION_BEHAVIOR")
      .map((e) => (e.payload as Record<string, unknown>)?.issue as string ?? "")
      .filter(Boolean);

    const hintsUsed = evidence.filter((e) => e.type === "HINT_REQUEST").length;
    const totalAttempts = evidence.filter(
      (e) => e.type === "CODE_SUBMISSION" || e.type === "ANSWER" || e.type === "EXERCISE_RESULT"
    ).length;
    const correctAttempts = evidence.filter(
      (e) => (e.type === "CODE_SUBMISSION" || e.type === "ANSWER" || e.type === "EXERCISE_RESULT") && e.result === "correct"
    ).length;

    const independentPerformance = totalAttempts > 0 ? correctAttempts / totalAttempts : 0;
    const hintDependency = totalAttempts > 0 ? hintsUsed / totalAttempts : 0;

    return {
      sessionId,
      userId: session.userId,
      objective: (session.decision as Record<string, unknown> | null)?.objectiveNodeId as string ?? "",
      planned,
      completed: completedTasks.map((t) => t.title),
      incomplete,
      evidenceSummary: `Total evidence events: ${evidence.length}, tasks: ${tasks.length}, decisions: ${decisions.length}`,
      strengths,
      weaknesses,
      misconceptions,
      unresolvedHypotheses,
      strategies,
      learnerQuestions,
      learnerContext: environmentalIssues,
      environmentalIssues,
      hintDependency,
      independentPerformance,
      retention: independentPerformance,
      decisionsRequiringReview: reviewsRequired,
      recommendedNext: [],
    };
  }

  async persistReport(report: SessionReport): Promise<void> {
    await this.memoryRepo.upsertSessionReport(report.sessionId, report.userId, report as unknown as Record<string, unknown>);
  }

  async buildHandoff(
    userId: string,
    currentDate: string
  ): Promise<{
    previousReport: SessionReport | null;
    curriculumState: Record<string, unknown>;
    learnerState: Record<string, unknown>;
  }> {
    const previousReportRow = await this.memoryRepo.findLatestReportByUser(userId);

    const previousReport: SessionReport | null = previousReportRow
      ? (previousReportRow.body as unknown as SessionReport)
      : null;

    const conceptStates = await this.memoryRepo.findConceptStatesByUser(userId);

    const nodeIds = conceptStates.map((c) => c.nodeId);
    const nodeLabels = await this.nodeRepo.findLabelsByIds(nodeIds);

    const labelMap = new Map(nodeLabels.map((n) => [n.id, { label: n.label, key: n.nodeKey }]));

    const curriculumState: Record<string, unknown> = {
      conceptStates: conceptStates.map((c) => {
        const meta = labelMap.get(c.nodeId);
        return {
          nodeId: c.nodeId,
          nodeKey: meta?.key ?? null,
          label: meta?.label ?? null,
          state: c.state,
          mastery: c.mastery,
          nextReviewAt: c.nextReviewAt,
        };
      }),
      previousReportDate: previousReportRow?.createdAt?.toISOString() ?? null,
    };

    const learnerState: Record<string, unknown> = {
      conceptStates,
      weakConcepts: conceptStates.filter((c) => c.mastery < 0.4).map((c) => c.nodeId),
      dueForReview: conceptStates
        .filter((c) => c.nextReviewAt !== null && new Date(c.nextReviewAt) <= new Date(currentDate))
        .map((c) => c.nodeId),
    };

    return { previousReport, curriculumState, learnerState };
  }
}

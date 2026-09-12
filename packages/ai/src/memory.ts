import { MemoryRepository } from "./repositories/memory-repository.js";
import type {
  MemorySystem,
  MemoryQuery,
  MemoryHit,
  SessionMemory,
  EvidenceEvent,
  TutorExperienceRecord,
} from "./contracts.js";

export class MemorySystemImpl implements MemorySystem {
  constructor(private readonly repo: MemoryRepository) {}

  /* ------------------------------------------------------------------ */
  /* Record methods                                                       */
  /* ------------------------------------------------------------------ */

  async recordSessionMemory(s: SessionMemory): Promise<void> {
    const tasks = await this.repo.findSessionTasks(s.sessionId);

    const completed = tasks.filter((t) => s.actual.includes(t.title)).map((t) => t.id);
    const incomplete = tasks.filter((t) => !s.actual.includes(t.title)).map((t) => t.id);

    await this.repo.insertSessionReport(s.sessionId, s.userId, {
      objective: s.objective,
      planned: s.planned,
      actual: s.actual,
      conceptsDiscussed: s.conceptsDiscussed,
      learnerQuestions: s.learnerQuestions,
      mistakes: s.mistakes,
      exercises: s.exercises,
      results: s.results,
      interventions: s.interventions,
      learnerClaims: s.learnerClaims,
      environmentalContext: s.environmentalContext,
      unfinishedWork: s.unfinishedWork,
      tutorDecisions: s.tutorDecisions,
      outcomes: s.outcomes,
      completed,
      incomplete,
    });

    await this.repo.updateSessionStatus(s.sessionId, "COMPLETED");
  }

  async recordHistorical(e: EvidenceEvent): Promise<void> {
    const existing = await this.repo.findEvidenceById(e.id);

    if (!existing) {
      await this.repo.insertEvidenceEvent({
        id: e.id,
        userId: e.userId,
        sessionId: e.sessionId ?? null,
        type: e.type,
        concept: e.concept ?? null,
        result: e.result ?? null,
        source: e.source,
        payload: e.payload,
        observedAt: e.observedAt,
      });
    }
  }

  async recordTutorExperience(x: TutorExperienceRecord): Promise<void> {
    await this.repo.insertTutorExperience({
      id: x.id,
      concept: x.concept,
      learnerProblem: x.learnerProblem,
      strategy: x.strategy,
      outcome: x.outcome,
      context: x.context,
      evidenceRefs: x.evidenceRefs,
      createdAt: x.createdAt,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Query methods                                                        */
  /* ------------------------------------------------------------------ */

  async query(q: MemoryQuery): Promise<MemoryHit[]> {
    switch (q.kind) {
      case "EXACT_DATE":
        return this.queryExactDate(q);
      case "CONCEPT_INDEX":
        return this.queryConceptIndex(q);
      case "SEMANTIC":
        // SEMANTIC retrieval requires vector embeddings which are not yet implemented.
        // Falls back to concept-index keyword search as a temporary measure.
        // Future: integrate pgvector or external embedding service for true semantic search.
        return this.queryConceptIndex(q);
      case "CURRENT_STATE":
        return this.queryCurrentState(q);
      default:
        return [];
    }
  }

  /* ------------------------------------------------------------------ */
  /* Private query helpers                                                */
  /* ------------------------------------------------------------------ */

  private async queryExactDate(q: MemoryQuery): Promise<MemoryHit[]> {
    const limit = q.limit ?? 20;

    const rows = await this.repo.findSessionsByUser(q.userId, q.date, limit);

    const reports = await this.repo.findReportsByUser(q.userId, limit);

    const reportMap = new Map(reports.map((r) => [r.sessionId, r.body]));

    return rows.map((row) => ({
      id: row.id,
      store: "session" as const,
      kind: "daily_session",
      data: {
        userId: row.userId,
        localDate: row.localDate,
        kind: row.kind,
        status: row.status,
        decision: row.decision,
        plannedMinutes: row.plannedMinutes,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        report: reportMap.get(row.id) ?? null,
      },
      score: 1.0,
      date: row.localDate,
    }));
  }

  private async queryConceptIndex(q: MemoryQuery): Promise<MemoryHit[]> {
    const limit = q.limit ?? 20;

    const rows = await this.repo.findEvidenceByUser(q.userId, q.concept, limit);

    return rows.map((row) => ({
      id: row.id,
      store: "historical" as const,
      kind: "evidence_event",
      data: {
        userId: row.userId,
        sessionId: row.sessionId,
        type: row.type,
        concept: row.concept,
        result: row.result,
        source: row.source,
        payload: row.payload,
        observedAt: row.observedAt,
      },
      score: 0.8,
    }));
  }

  private async queryCurrentState(q: MemoryQuery): Promise<MemoryHit[]> {
    const limit = q.limit ?? 50;

    const conceptStates = await this.repo.findConceptStatesByUser(q.userId, limit);

    const nodeIds = conceptStates.map((cs) => cs.nodeId);

    const nodes = await this.repo.findNodesByIds(nodeIds);

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const dimensions = await this.repo.findDimensionsByUser(q.userId, limit);

    const dimByNode = new Map<string, typeof dimensions>();
    for (const d of dimensions) {
      const key = d.nodeId;
      const arr = dimByNode.get(key) ?? [];
      arr.push(d);
      dimByNode.set(key, arr);
    }

    const conceptHits: MemoryHit[] = conceptStates.map((cs) => ({
      id: `${cs.userId}-${cs.nodeId}`,
      store: "learner" as const,
      kind: "concept_state",
      data: {
        userId: cs.userId,
        nodeId: cs.nodeId,
        nodeKey: nodeMap.get(cs.nodeId)?.nodeKey ?? null,
        label: nodeMap.get(cs.nodeId)?.label ?? null,
        state: cs.state,
        mastery: cs.mastery,
        recallStrength: cs.recallStrength,
        consecutiveSuccess: cs.consecutiveSuccess,
        consecutiveFail: cs.consecutiveFail,
        totalAttempts: cs.totalAttempts,
        lastPracticedAt: cs.lastPracticedAt,
        nextReviewAt: cs.nextReviewAt,
        dimensions: (dimByNode.get(cs.nodeId) ?? []).map((d) => ({
          dimension: d.dimension,
          value: d.value,
          confidence: d.confidence,
          evidenceRefs: d.evidenceRefs,
        })),
      },
      score: cs.mastery,
    }));

    const dimHits: MemoryHit[] = dimensions
      .filter((d) => !conceptStates.some((cs) => cs.nodeId === d.nodeId))
      .map((d) => ({
        id: `${d.userId}-${d.nodeId}-${d.dimension}`,
        store: "learner" as const,
        kind: "dimension",
        data: {
          userId: d.userId,
          nodeId: d.nodeId,
          dimension: d.dimension,
          value: d.value,
          confidence: d.confidence,
          evidenceRefs: d.evidenceRefs,
        },
        score: d.value,
      }));

    return [...conceptHits, ...dimHits].slice(0, limit);
  }
}

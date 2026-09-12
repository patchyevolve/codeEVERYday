/**
 * Memory Repository — encapsulates all memory-system DB queries.
 *
 * Extracts query logic from memory.ts into a reusable, testable seam.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import {
  dailySessions,
  dailyTasks,
  sessionReports,
  evidenceEvents,
  tutorExperience,
  learnerDimensions,
  userConceptState,
  domainNodes,
  type DB,
} from "@cpd/core";

export class MemoryRepository {
  constructor(private readonly db: DB) {}

  /* ------------------------------------------------------------------ */
  /* Session / Report helpers                                             */
  /* ------------------------------------------------------------------ */

  async findSessionTasks(
    sessionId: string,
  ): Promise<{ id: string; title: string }[]> {
    return this.db
      .select({ id: dailyTasks.id, title: dailyTasks.title })
      .from(dailyTasks)
      .innerJoin(dailySessions, eq(dailyTasks.sessionId, dailySessions.id))
      .where(eq(dailySessions.id, sessionId));
  }

  async insertSessionReport(
    sessionId: string,
    userId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .insert(sessionReports)
      .values({ sessionId, userId, body })
      .onConflictDoNothing();
  }

  async updateSessionStatus(
    sessionId: string,
    status: string,
  ): Promise<void> {
    await this.db
      .update(dailySessions)
      .set({ status: status as never })
      .where(eq(dailySessions.id, sessionId));
  }

  /* ------------------------------------------------------------------ */
  /* Evidence helpers                                                     */
  /* ------------------------------------------------------------------ */

  async findEvidenceById(
    evidenceId: string,
  ): Promise<{ id: string } | null> {
    const rows = await this.db
      .select({ id: evidenceEvents.id })
      .from(evidenceEvents)
      .where(eq(evidenceEvents.id, evidenceId));
    return rows[0] ?? null;
  }

  async insertEvidenceEvent(e: {
    id: string;
    userId: string;
    sessionId: string | null;
    type: string;
    concept: string | null;
    result: string | null;
    source: string;
    payload: Record<string, unknown>;
    observedAt: Date;
  }): Promise<void> {
    await this.db.insert(evidenceEvents).values({
      id: e.id,
      userId: e.userId,
      sessionId: e.sessionId,
      type: e.type,
      concept: e.concept,
      result: e.result,
      source: e.source,
      payload: e.payload,
      observedAt: e.observedAt,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Tutor experience helpers                                             */
  /* ------------------------------------------------------------------ */

  async insertTutorExperience(record: {
    id: string;
    concept: string;
    learnerProblem: string;
    strategy: string;
    outcome: string;
    context: Record<string, unknown>;
    evidenceRefs: string[];
    createdAt: Date;
  }): Promise<void> {
    await this.db.insert(tutorExperience).values(record);
  }

  /* ------------------------------------------------------------------ */
  /* Query helpers (for MemorySystem.query)                               */
  /* ------------------------------------------------------------------ */

  async findSessionsByUser(
    userId: string,
    date?: string,
    limit = 20,
  ): Promise<
    {
      id: string;
      userId: string;
      localDate: string;
      kind: string;
      status: string;
      decision: unknown;
      plannedMinutes: number;
      startedAt: Date | null;
      completedAt: Date | null;
    }[]
  > {
    return this.db
      .select({
        id: dailySessions.id,
        userId: dailySessions.userId,
        localDate: dailySessions.localDate,
        kind: dailySessions.kind,
        status: dailySessions.status,
        decision: dailySessions.decision,
        plannedMinutes: dailySessions.plannedMinutes,
        startedAt: dailySessions.startedAt,
        completedAt: dailySessions.completedAt,
      })
      .from(dailySessions)
      .where(
        date
          ? and(eq(dailySessions.userId, userId), eq(dailySessions.localDate, date))
          : eq(dailySessions.userId, userId),
      )
      .orderBy(desc(dailySessions.localDate))
      .limit(limit);
  }

  async findReportsByUser(
    userId: string,
    limit = 20,
  ): Promise<{ sessionId: string; body: Record<string, unknown> }[]> {
    return this.db
      .select({
        sessionId: sessionReports.sessionId,
        body: sessionReports.body,
      })
      .from(sessionReports)
      .where(eq(sessionReports.userId, userId))
      .orderBy(desc(sessionReports.createdAt))
      .limit(limit);
  }

  async findEvidenceByUser(
    userId: string,
    concept?: string,
    limit = 20,
  ): Promise<
    {
      id: string;
      userId: string;
      sessionId: string | null;
      type: string;
      concept: string | null;
      result: string | null;
      source: string;
      payload: Record<string, unknown>;
      observedAt: Date;
    }[]
  > {
    return this.db
      .select({
        id: evidenceEvents.id,
        userId: evidenceEvents.userId,
        sessionId: evidenceEvents.sessionId,
        type: evidenceEvents.type,
        concept: evidenceEvents.concept,
        result: evidenceEvents.result,
        source: evidenceEvents.source,
        payload: evidenceEvents.payload,
        observedAt: evidenceEvents.observedAt,
      })
      .from(evidenceEvents)
      .where(
        concept
          ? and(eq(evidenceEvents.userId, userId), eq(evidenceEvents.concept, concept))
          : eq(evidenceEvents.userId, userId),
      )
      .orderBy(desc(evidenceEvents.observedAt))
      .limit(limit);
  }

  async findConceptStatesByUser(
    userId: string,
    limit = 50,
  ): Promise<
    {
      userId: string;
      nodeId: string;
      state: string;
      mastery: number;
      recallStrength: number;
      consecutiveSuccess: number;
      consecutiveFail: number;
      totalAttempts: number;
      lastPracticedAt: Date | null;
      nextReviewAt: Date | null;
    }[]
  > {
    return this.db
      .select({
        userId: userConceptState.userId,
        nodeId: userConceptState.nodeId,
        state: userConceptState.state,
        mastery: userConceptState.mastery,
        recallStrength: userConceptState.recallStrength,
        consecutiveSuccess: userConceptState.consecutiveSuccess,
        consecutiveFail: userConceptState.consecutiveFail,
        totalAttempts: userConceptState.totalAttempts,
        lastPracticedAt: userConceptState.lastPracticedAt,
        nextReviewAt: userConceptState.nextReviewAt,
      })
      .from(userConceptState)
      .where(eq(userConceptState.userId, userId))
      .orderBy(desc(userConceptState.mastery))
      .limit(limit);
  }

  async findNodesByIds(
    nodeIds: string[],
  ): Promise<{ id: string; nodeKey: string; label: string }[]> {
    if (nodeIds.length === 0) return [];
    return this.db
      .select({ id: domainNodes.id, nodeKey: domainNodes.nodeKey, label: domainNodes.label })
      .from(domainNodes)
      .where(inArray(domainNodes.id, nodeIds));
  }

  async findEvidenceBySession(
    sessionId: string,
  ): Promise<
    {
      id: string;
      concept: string | null;
      result: string | null;
      type: string;
      payload: Record<string, unknown>;
    }[]
  > {
    return this.db
      .select({
        id: evidenceEvents.id,
        concept: evidenceEvents.concept,
        result: evidenceEvents.result,
        type: evidenceEvents.type,
        payload: evidenceEvents.payload,
      })
      .from(evidenceEvents)
      .where(eq(evidenceEvents.sessionId, sessionId));
  }

  async upsertSessionReport(
    sessionId: string,
    userId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .insert(sessionReports)
      .values({ sessionId, userId, body })
      .onConflictDoUpdate({
        target: sessionReports.sessionId,
        set: { body },
      });
  }

  async findLatestReportByUser(
    userId: string,
  ): Promise<{ sessionId: string; body: Record<string, unknown>; createdAt: Date } | null> {
    const row = await this.db
      .select({
        sessionId: sessionReports.sessionId,
        body: sessionReports.body,
        createdAt: sessionReports.createdAt,
      })
      .from(sessionReports)
      .where(eq(sessionReports.userId, userId))
      .orderBy(desc(sessionReports.createdAt))
      .limit(1)
      .then((r) => r[0]);
    return row ?? null;
  }

  async findDimensionsByUser(
    userId: string,
    limit = 50,
  ): Promise<
    {
      userId: string;
      nodeId: string;
      dimension: string;
      value: number;
      confidence: number;
      evidenceRefs: string[];
    }[]
  > {
    return this.db
      .select({
        userId: learnerDimensions.userId,
        nodeId: learnerDimensions.nodeId,
        dimension: learnerDimensions.dimension,
        value: learnerDimensions.value,
        confidence: learnerDimensions.confidence,
        evidenceRefs: learnerDimensions.evidenceRefs,
      })
      .from(learnerDimensions)
      .where(eq(learnerDimensions.userId, userId))
      .orderBy(desc(learnerDimensions.updatedAt))
      .limit(limit);
  }
}

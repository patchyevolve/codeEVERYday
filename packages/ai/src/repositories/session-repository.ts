/**
 * Session Repository — encapsulates all daily_sessions and daily_tasks queries.
 */

import { and, count, eq, inArray } from "drizzle-orm";
import {
  dailySessions,
  dailyTasks,
  contentItems,
  type DB,
  type TutorDecision,
} from "@cpd/core";

export class SessionRepository {
  constructor(private readonly db: DB) {}

  async findTodayRecovery(userId: string, localDate: string): Promise<{ id: string; status: string } | null> {
    const rows = await this.db
      .select({ id: dailySessions.id, status: dailySessions.status })
      .from(dailySessions)
      .where(
        and(
          eq(dailySessions.userId, userId),
          eq(dailySessions.localDate, localDate),
          eq(dailySessions.kind, "RECOVERY")
        )
      );
    return rows[0] ?? null;
  }

  async hasServedKind(userId: string, nodeId: string, kind: string): Promise<boolean> {
    const [row] = await this.db
      .select({ n: count() })
      .from(dailyTasks)
      .innerJoin(dailySessions, eq(dailySessions.id, dailyTasks.sessionId))
      .innerJoin(contentItems, eq(contentItems.id, dailyTasks.contentItemId))
      .where(
        and(
          eq(dailySessions.userId, userId),
          eq(contentItems.nodeId, nodeId),
          eq(contentItems.kind, kind as never)
        )
      );
    return (row?.n ?? 0) > 0;
  }

  async createSession(params: {
    userId: string;
    localDate: string;
    kind: string;
    decision: TutorDecision;
    plannedMinutes: number;
    dueAt: Date;
    deadlineAt: Date;
    sourceSessionId?: string | null;
  }): Promise<{ id: string }> {
    const [session] = await this.db
      .insert(dailySessions)
      .values({
        userId: params.userId,
        localDate: params.localDate,
        kind: params.kind as never,
        status: "SCHEDULED",
        decision: params.decision,
        plannedMinutes: params.plannedMinutes,
        dueAt: params.dueAt,
        deadlineAt: params.deadlineAt,
        sourceSessionId: params.sourceSessionId ?? null,
      })
      .returning();
    return { id: session!.id };
  }

  async addTask(params: {
    sessionId: string;
    position: number;
    kind: string;
    contentItemId: string;
    title: string;
    estMinutes: number;
    required: boolean;
  }): Promise<void> {
    await this.db.insert(dailyTasks).values({
      sessionId: params.sessionId,
      position: params.position,
      kind: params.kind as never,
      contentItemId: params.contentItemId,
      title: params.title,
      estMinutes: params.estMinutes,
      required: params.required,
    });
  }

  async updatePlannedMinutes(sessionId: string, minutes: number): Promise<void> {
    await this.db
      .update(dailySessions)
      .set({ plannedMinutes: minutes })
      .where(eq(dailySessions.id, sessionId));
  }

  async updatePhase(sessionId: string, phase: string): Promise<void> {
    await this.db
      .update(dailySessions)
      .set({ currentPhase: phase })
      .where(eq(dailySessions.id, sessionId));
  }

  async getCurrentPhase(sessionId: string): Promise<string | null> {
    const row = await this.db
      .select({ currentPhase: dailySessions.currentPhase })
      .from(dailySessions)
      .where(eq(dailySessions.id, sessionId))
      .then((r) => r[0]);
    return row?.currentPhase ?? null;
  }

  async findTasksBySession(
    sessionId: string,
  ): Promise<{ id: string; title: string; status: string; required: boolean }[]> {
    return this.db
      .select({
        id: dailyTasks.id,
        title: dailyTasks.title,
        status: dailyTasks.status,
        required: dailyTasks.required,
      })
      .from(dailyTasks)
      .where(eq(dailyTasks.sessionId, sessionId));
  }

  async findSessionWithDecision(
    sessionId: string,
  ): Promise<{ id: string; userId: string; decision: unknown; kind: string; status: string } | null> {
    const row = await this.db
      .select({
        id: dailySessions.id,
        userId: dailySessions.userId,
        decision: dailySessions.decision,
        kind: dailySessions.kind,
        status: dailySessions.status,
      })
      .from(dailySessions)
      .where(eq(dailySessions.id, sessionId))
      .then((r) => r[0]);
    return row ?? null;
  }

  async startSession(sessionId: string): Promise<void> {
    await this.db
      .update(dailySessions)
      .set({
        status: "IN_PROGRESS",
        startedAt: new Date(),
        currentPhase: "OPENING",
      })
      .where(eq(dailySessions.id, sessionId));
  }

  async endSession(sessionId: string): Promise<void> {
    await this.db
      .update(dailySessions)
      .set({
        status: "COMPLETED",
        completedAt: new Date(),
        currentPhase: null,
      })
      .where(eq(dailySessions.id, sessionId));
  }

  async findSessionByUserAndDate(userId: string, localDate: string): Promise<{ status: string; kind: string } | null> {
    const [row] = await this.db
      .select({ status: dailySessions.status, kind: dailySessions.kind })
      .from(dailySessions)
      .where(and(eq(dailySessions.userId, userId), eq(dailySessions.localDate, localDate)));
    return row ?? null;
  }
}

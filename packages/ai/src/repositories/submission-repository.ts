/**
 * Submission Repository — encapsulates submission, execution, and content-item
 * queries used by evaluator.ts.
 */

import { and, count, desc, eq, sql } from "drizzle-orm";
import {
  contentItems,
  dailySessions,
  dailyTasks,
  domainNodes,
  executions,
  submissions,
  userPreferences,
  type DB,
} from "@cpd/core";

export class SubmissionRepository {
  constructor(private readonly db: DB) {}

  async findTaskById(taskId: string) {
    const rows = await this.db
      .select({
        id: dailyTasks.id,
        sessionId: dailyTasks.sessionId,
        contentItemId: dailyTasks.contentItemId,
        title: dailyTasks.title,
        status: dailyTasks.status,
        required: dailyTasks.required,
        completedAt: dailyTasks.completedAt,
      })
      .from(dailyTasks)
      .where(eq(dailyTasks.id, taskId));
    return rows[0] ?? null;
  }

  async findSessionById(sessionId: string) {
    const rows = await this.db
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
      .where(eq(dailySessions.id, sessionId));
    return rows[0] ?? null;
  }

  async findContentItemById(itemId: string) {
    const rows = await this.db
      .select({
        id: contentItems.id,
        nodeId: contentItems.nodeId,
        kind: contentItems.kind,
        title: contentItems.title,
        difficulty: contentItems.difficulty,
        estMinutes: contentItems.estMinutes,
        payload: contentItems.payload,
        source: contentItems.source,
        status: contentItems.status,
        validation: contentItems.validation,
        generatedBy: contentItems.generatedBy,
        usageCount: contentItems.usageCount,
      })
      .from(contentItems)
      .where(eq(contentItems.id, itemId));
    return rows[0] ?? null;
  }

  async findNodeById(nodeId: string) {
    const rows = await this.db
      .select({
        id: domainNodes.id,
        nodeKey: domainNodes.nodeKey,
        label: domainNodes.label,
        depth: domainNodes.depth,
        difficulty: domainNodes.difficulty,
        languageKey: domainNodes.languageKey,
      })
      .from(domainNodes)
      .where(eq(domainNodes.id, nodeId));
    return rows[0] ?? null;
  }

  async countAttempts(userId: string, taskId: string, contentItemId: string) {
    const rows = await this.db
      .select({ n: count() })
      .from(submissions)
      .where(
        and(
          eq(submissions.userId, userId),
          eq(submissions.taskId, taskId),
          eq(submissions.contentItemId, contentItemId)
        )
      );
    return rows[0]!.n;
  }

  async insertSubmission(values: typeof submissions.$inferInsert) {
    const rows = await this.db
      .insert(submissions)
      .values(values)
      .returning({ id: submissions.id });
    return rows[0]!;
  }

  async insertExecution(values: typeof executions.$inferInsert) {
    await this.db.insert(executions).values(values);
  }

  async updateTaskStatus(
    taskId: string,
    status: "PENDING" | "DONE" | "SKIPPED"
  ) {
    await this.db
      .update(dailyTasks)
      .set({ status, ...(status === "DONE" ? { completedAt: new Date() } : {}) })
      .where(eq(dailyTasks.id, taskId));
  }

  async countOpenRequiredTasks(sessionId: string) {
    const rows = await this.db
      .select({ n: count() })
      .from(dailyTasks)
      .where(
        and(
          eq(dailyTasks.sessionId, sessionId),
          eq(dailyTasks.required, true),
          sql`${dailyTasks.status} != 'DONE'`
        )
      );
    return rows[0]!.n;
  }

  async findUserTimezone(userId: string) {
    const rows = await this.db
      .select({ timezone: userPreferences.timezone })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    return rows[0]?.timezone ?? "UTC";
  }

  async findSubmissionById(id: string, userId: string) {
    const rows = await this.db
      .select({
        id: submissions.id,
        userId: submissions.userId,
        contentItemId: submissions.contentItemId,
        sessionId: submissions.sessionId,
        taskId: submissions.taskId,
        kind: submissions.kind,
        code: submissions.code,
        language: submissions.language,
        answer: submissions.answer,
        status: submissions.status,
        score: submissions.score,
        results: submissions.results,
        hintsUsed: submissions.hintsUsed,
        durationMs: submissions.durationMs,
      })
      .from(submissions)
      .where(and(eq(submissions.id, id), eq(submissions.userId, userId)));
    return rows[0] ?? null;
  }

  async updateSessionStatus(
    sessionId: string,
    status: "IN_PROGRESS" | "COMPLETED"
  ) {
    await this.db
      .update(dailySessions)
      .set({
        status,
        ...(status === "IN_PROGRESS" ? { startedAt: new Date() } : {}),
        ...(status === "COMPLETED" ? { completedAt: new Date() } : {}),
      })
      .where(eq(dailySessions.id, sessionId));
  }

  async getRecentSubmissions(userId: string, limit = 20): Promise<{ nodeKey: string; passed: string; at: Date }[]> {
    return this.db
      .select({
        nodeKey: domainNodes.nodeKey,
        passed: submissions.status,
        at: submissions.createdAt,
      })
      .from(submissions)
      .innerJoin(contentItems, eq(contentItems.id, submissions.contentItemId))
      .innerJoin(domainNodes, eq(domainNodes.id, contentItems.nodeId))
      .where(eq(submissions.userId, userId))
      .orderBy(desc(submissions.createdAt))
      .limit(limit);
  }
}

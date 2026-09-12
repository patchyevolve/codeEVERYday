/**
 * Streak Repository — encapsulates streak, XP, daily-completions, and
 * concept-state queries used by evaluator.ts.
 */

import { and, eq } from "drizzle-orm";
import {
  conceptStateEnum,
  dailyCompletions,
  domainNodes,
  mistakes,
  streaks,
  userConceptState,
  xpLedger,
  type DB,
} from "@cpd/core";

export class StreakRepository {
  constructor(private readonly db: DB) {}

  async findStreak(userId: string) {
    const rows = await this.db
      .select({
        userId: streaks.userId,
        currentLength: streaks.currentLength,
        longestLength: streaks.longestLength,
        currentStart: streaks.currentStart,
        lastCompletedDate: streaks.lastCompletedDate,
        brokenAt: streaks.brokenAt,
      })
      .from(streaks)
      .where(eq(streaks.userId, userId));
    return rows[0] ?? null;
  }

  async upsertStreak(
    userId: string,
    values: {
      currentLength: number;
      longestLength: number;
      currentStart: string | null;
      lastCompletedDate: string | null;
    }
  ) {
    await this.db
      .insert(streaks)
      .values({ userId, ...values })
      .onConflictDoUpdate({
        target: streaks.userId,
        set: {
          currentLength: values.currentLength,
          longestLength: values.longestLength,
          currentStart: values.currentStart,
          lastCompletedDate: values.lastCompletedDate,
          brokenAt: null,
        },
      });
  }

  async insertXpLedger(
    userId: string,
    delta: number,
    reason: string,
    refType?: string,
    refId?: string
  ) {
    await this.db
      .insert(xpLedger)
      .values({ userId, delta, reason, refType: refType ?? null, refId: refId ?? null });
  }

  async insertDailyCompletion(
    userId: string,
    sessionId: string,
    localDate: string,
    criteria: {
      requiredTasksDone: number;
      requiredTasksTotal: number;
      exercisesPassed: number;
      assessmentPassed: boolean;
      lessonCompleted: boolean;
    }
  ) {
    await this.db
      .insert(dailyCompletions)
      .values({ userId, sessionId, localDate, criteria })
      .onConflictDoNothing();
  }

  async findConceptState(userId: string, nodeId: string) {
    const rows = await this.db
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
        reviewIntervalDays: userConceptState.reviewIntervalDays,
        reviewEase: userConceptState.reviewEase,
        reviewCount: userConceptState.reviewCount,
      })
      .from(userConceptState)
      .where(
        and(
          eq(userConceptState.userId, userId),
          eq(userConceptState.nodeId, nodeId)
        )
      );
    return rows[0] ?? null;
  }

  async upsertConceptState(
    userId: string,
    nodeId: string,
    values: {
      state: (typeof conceptStateEnum.enumValues)[number];
      mastery: number;
      recallStrength: number;
      consecutiveSuccess: number;
      consecutiveFail: number;
      totalAttempts: number;
      lastPracticedAt: Date;
      nextReviewAt: Date | null;
      reviewIntervalDays: number;
      reviewEase: number;
      reviewCount: number;
    }
  ) {
    await this.db
      .insert(userConceptState)
      .values({ userId, nodeId, ...values })
      .onConflictDoUpdate({
        target: [userConceptState.userId, userConceptState.nodeId],
        set: values,
      });
  }

  /** Aggregate active mistake counts grouped by nodeId (via domainNodes join). */
  async getMistakeHeat(userId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ nodeKey: domainNodes.nodeKey, count: mistakes.count })
      .from(mistakes)
      .innerJoin(domainNodes, eq(domainNodes.id, mistakes.nodeId))
      .where(and(eq(mistakes.userId, userId), eq(mistakes.active, true)));
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.nodeKey, (map.get(r.nodeKey) ?? 0) + r.count);
    return map;
  }

  async recordMistake(
    userId: string,
    nodeId: string,
    pattern: string,
    severity: "LOW" | "MEDIUM" | "HIGH",
    description: string | null,
    submissionId: string | null,
    contentItemId: string | null
  ) {
    const existing = await this.db
      .select({ id: mistakes.id, count: mistakes.count })
      .from(mistakes)
      .where(
        and(
          eq(mistakes.userId, userId),
          eq(mistakes.nodeId, nodeId),
          eq(mistakes.pattern, pattern)
        )
      );
    if (existing[0]) {
      await this.db
        .update(mistakes)
        .set({
          count: existing[0].count + 1,
          lastAt: new Date(),
          active: true,
          severity,
          description,
        })
        .where(eq(mistakes.id, existing[0].id));
    } else {
      await this.db.insert(mistakes).values({
        userId,
        nodeId,
        contentItemId,
        submissionId,
        pattern,
        severity,
        description,
      });
    }
  }
}

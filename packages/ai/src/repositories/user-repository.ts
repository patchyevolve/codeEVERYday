/**
 * User Repository — encapsulates user_goals, user_learning_path, user_concept_state queries.
 */

import { and, eq, inArray } from "drizzle-orm";
import {
  userGoals,
  userLearningPath,
  userConceptState,
  userPreferences,
  users,
  mistakes,
  domainNodes,
  type DB,
} from "@cpd/core";

export class UserRepository {
  constructor(private readonly db: DB) {}

  async getUser(userId: string): Promise<{ id: string; level: number; totalXp: number } | null> {
    const [row] = await this.db
      .select({ id: users.id, level: users.level, totalXp: users.totalXp })
      .from(users)
      .where(eq(users.id, userId));
    return row ?? null;
  }

  async getPrefs(userId: string): Promise<{ timezone: string; languageKey: string; dailyMinutes: number; difficultyPref: number } | null> {
    const [row] = await this.db
      .select({
        timezone: userPreferences.timezone,
        languageKey: userPreferences.languageKey,
        dailyMinutes: userPreferences.dailyMinutes,
        difficultyPref: userPreferences.difficultyPref,
      })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    return row ?? null;
  }

  async getGoals(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ domain: userGoals.domain })
      .from(userGoals)
      .where(eq(userGoals.userId, userId));
    return rows.map((r) => r.domain);
  }

  async getPath(userId: string): Promise<
    { nodeId: string; nodeKey: string; position: number; status: string }[]
  > {
    return this.db
      .select({
        nodeId: userLearningPath.nodeId,
        nodeKey: domainNodes.nodeKey,
        position: userLearningPath.position,
        status: userLearningPath.status,
      })
      .from(userLearningPath)
      .innerJoin(domainNodes, eq(domainNodes.id, userLearningPath.nodeId))
      .where(eq(userLearningPath.userId, userId));
  }

  async addToPath(params: {
    userId: string;
    nodeId: string;
    position: number;
    status: "PLANNED" | "ACTIVE" | "COMPLETED" | "BLOCKED";
    reason: string;
  }): Promise<void> {
    await this.db
      .insert(userLearningPath)
      .values(params)
      .onConflictDoNothing();
  }

  async getNodeStates(userId: string): Promise<Map<string, { state: string; mastery: number }>> {
    const rows = await this.db
      .select({
        nodeKey: domainNodes.nodeKey,
        state: userConceptState.state,
        mastery: userConceptState.mastery,
      })
      .from(userConceptState)
      .innerJoin(domainNodes, eq(domainNodes.id, userConceptState.nodeId))
      .where(eq(userConceptState.userId, userId));
    return new Map(rows.map((r) => [r.nodeKey, { state: r.state, mastery: r.mastery }]));
  }

  async getUserConceptStates(userId: string): Promise<
    { nodeId: string; nodeKey: string; label: string; state: string; mastery: number; nextReviewAt: Date | null }[]
  > {
    return this.db
      .select({
        nodeId: domainNodes.id,
        nodeKey: domainNodes.nodeKey,
        label: domainNodes.label,
        state: userConceptState.state,
        mastery: userConceptState.mastery,
        nextReviewAt: userConceptState.nextReviewAt,
      })
      .from(userConceptState)
      .innerJoin(domainNodes, eq(domainNodes.id, userConceptState.nodeId))
      .where(eq(userConceptState.userId, userId));
  }

  async getActiveMistakes(userId: string): Promise<{ nodeKey: string; pattern: string; count: number }[]> {
    return this.db
      .select({
        nodeKey: domainNodes.nodeKey,
        pattern: mistakes.pattern,
        count: mistakes.count,
      })
      .from(mistakes)
      .innerJoin(domainNodes, eq(domainNodes.id, mistakes.nodeId))
      .where(and(eq(mistakes.userId, userId), eq(mistakes.active, true)));
  }

  async getOpenedDomainKeys(
    userId: string,
    languageKey: string,
    domainKeys: string[]
  ): Promise<{ nodeKey: string }[]> {
    return this.db
      .select({ nodeKey: domainNodes.nodeKey })
      .from(userLearningPath)
      .innerJoin(domainNodes, eq(domainNodes.id, userLearningPath.nodeId))
      .where(
        and(
          eq(userLearningPath.userId, userId),
          eq(domainNodes.languageKey, languageKey),
          inArray(domainNodes.nodeKey, domainKeys)
        )
      );
  }
}
